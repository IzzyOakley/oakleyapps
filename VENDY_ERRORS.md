# Vendy — Known Errors & Fixes

A running log of production errors encountered, what was tried, and what fixed them.
Update this file whenever a new error is diagnosed and resolved.

---

## ERR-001 · Bid generator returns 403 Forbidden

**First seen:** 2026-05-20  
**Status:** ✅ Resolved (two-part fix required)

### Symptom
- Bids page shows "Bid generator offline" banner
- Project bid pages display raw HTML: `403 Forbidden — Your client does not have permission to get URL bids/project/...`
- Firebase App Hosting runtime logs show `GET 403` on all `/api/vendy/bids/*` endpoints
- Takeoff endpoints (`/api/vendy/*`) work fine — only bids endpoints fail

### Root Cause
Two separate problems, both required:

**Part 1 — Missing `Authorization` header in bid proxy**  
`apps/web/src/app/api/vendy/bids/[...path]/route.ts` was not fetching a Google identity token before calling the bid-generator Cloud Run service. Both Cloud Run services use `--no-allow-unauthenticated`, which requires every upstream request to carry `Authorization: Bearer <Google OIDC token>`. The takeoff-agent proxy (`/api/vendy/[...path]/route.ts`) already had this logic via `getGoogleIdentityToken()` — the bid proxy was simply never given it.

**Part 2 — Missing IAM binding on bid-generator Cloud Run**  
Even with the token present, Cloud Run's IAM layer checks that the service account backing the token has `roles/run.invoker` on the specific service. The Firebase App Hosting compute SA (`firebase-app-hosting-compute@oakley-apps.iam.gserviceaccount.com`) had this binding on `takeoff-agent` (added manually when that service was set up) but **never had it added on `bid-generator`** when that service was deployed later.

### What Was Tried That Did Not Work
1. Adding `getGoogleIdentityToken()` to the bid proxy alone — token IS sent, but IAM rejects it because the SA isn't in the policy → still 403
2. Waiting for the new Firebase App Hosting deployment — confirmed the fix was deployed but 403 persisted (IAM was still missing)

### Fix Applied
**Step 1 — Code fix** (commit `800b2bd`):  
Added `getGoogleIdentityToken()` function and identity token injection to `apps/web/src/app/api/vendy/bids/[...path]/route.ts`, mirroring the pattern already in the takeoff-agent proxy.

**Step 2 — IAM fix** (one-time `gcloud` command — run once manually):
```bash
gcloud run services add-iam-policy-binding bid-generator \
  --member="serviceAccount:firebase-app-hosting-compute@oakley-apps.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1 \
  --project=oakley-apps
```

**Step 3 — CI/CD fix** (commit `<sha>` in `bid-generator.yml`):  
Added the `add-iam-policy-binding` step to the deploy job in `.github/workflows/bid-generator.yml` so the binding is re-applied on every future deploy — no manual steps needed.

### Prevention
If a new Cloud Run service is added, always:
1. Add `getGoogleIdentityToken()` + token injection to its Next.js proxy
2. Add `gcloud run services add-iam-policy-binding` for `firebase-app-hosting-compute@oakley-apps.iam.gserviceaccount.com` to the service's CI/CD workflow

---

## ERR-002 · Firebase App Hosting build fails (unused import)

**First seen:** 2026-05-20  
**Status:** ✅ Resolved

### Symptom
Firebase App Hosting rollout fails to build. Local `next build` succeeds with a warning.

### Root Cause
Firebase App Hosting's build environment treats `@typescript-eslint/no-unused-vars` as a build-blocking error. Local Next.js builds surface it only as a warning. In this case, `CheckCircle` was imported in `BidReviewClient.tsx` but never used.

### Fix Applied
Removed unused import (commit `a07dc68`). Always run `pnpm --filter web build` locally before pushing — a clean build (zero warnings) is required.

### Prevention
Before every push that touches TSX/TS files, run:
```bash
pnpm --filter web build
```
If you see any `Warning: '...' is defined but never used`, remove the import before pushing.

---

## ERR-003 · Takeoff agent runs forever then produces no output

**First seen:** 2026-05-21  
**Status:** ✅ Resolved

### Symptom
- User clicks "Run Takeoff" on a project — spinner shows "Processing"
- Job status stays at `processing` for 10–15 minutes with no progress
- No takeoff items are ever generated
- Job eventually silently disappears (badge resets to "none")
- App Hosting logs show repeated `GET 200` requests to `/api/vendy/projects/{id}` — frontend is polling but job never completes

### Root Cause
**Cloud Run CPU throttling kills the asyncio background task.**

`POST /projects/{id}/takeoff` fires `asyncio.create_task(_run_extraction(...))` and immediately returns `202 Accepted`. From Cloud Run's perspective, the HTTP request is done. Cloud Run's **default CPU allocation is request-based** — it throttles the instance's CPU to near-zero once no active requests are being handled.

The background task (download PDF from GCS → call Claude API → write results to Firestore) needs CPU to run, but the instance has no CPU allocated. The task is effectively frozen. After 15 minutes the `_derive_takeoff_status` function in `main.py` detects the stale job, marks it `failed`, and the UI resets to "none" — with no error shown to the user.

### What Was Tried That Did Not Work
Nothing was tried incorrectly — issue was identified directly from code inspection.

### Fix Applied
Added `--no-cpu-throttling` to the `gcloud run deploy` command in `.github/workflows/takeoff-agent.yml` (commit `f7b22bd`).

```yaml
gcloud run deploy ${{ env.SERVICE }} \
  ...
  --no-cpu-throttling \
  ...
```

This keeps CPU allocated for the lifetime of the instance (not just during request handling), allowing `asyncio.create_task` background work to execute normally between requests.

### Prevention
Any Cloud Run service that uses `asyncio.create_task` (fire-and-forget background work after returning an HTTP response) **must** include `--no-cpu-throttling`. Without it, the background task is starved of CPU the moment the response is sent.

Alternatively, refactor long-running background jobs to use Cloud Tasks (enqueue a new HTTP request) so work is tied to an active request rather than a background coroutine.

---

## ERR-004 · Takeoff fails on large blueprints — two-part fix required

**First seen:** 2026-05-22  
**Status:** ✅ Resolved (two-part fix required)

### Symptom
- Takeoff runs briefly, badge stays "processing", then disappears
- Cloud Run logs show only GET poll requests — no extraction logs visible
- Firestore job shows `status: "failed"`

### Part 1 — JSON parse error (`max_tokens` truncation)
**Error:** `"Expecting value: line 1533 column 11 (char 53868)"`  
`extractor.py` used `max_tokens=16000`. Large blueprints caused Claude's JSON response to be truncated mid-stream. `json.loads()` then failed on the incomplete JSON.  
**Fix (commit `32af243`):** Increased `max_tokens` to `32000`.

### Part 2 — Streaming required error
**Error:** `"Streaming is required for operations that may take longer than 10 minutes."`  
Even at 32,000 tokens, large blueprints cause Claude to estimate > 10 minutes of processing. The Anthropic SDK **blocks non-streaming calls** past this threshold.  
**Fix (commit `56ea129`):** Switched from `client.messages.create()` to `client.messages.stream()` + `stream.get_final_message()`. Streaming has no time limit. Response structure is identical so all downstream parsing is unchanged.

### Why errors were invisible in logs
1. The extractor has no `print`/`logging` statements
2. `_run_extraction` silently swallows re-raised exceptions (`except Exception: pass`)
3. Errors are only written to the Firestore job document — check there first

### Prevention
- Always use `client.messages.stream()` for Claude calls that process PDFs
- Always check `response.stop_reason` before parsing Claude output
- When diagnosing silent failures, check Firestore `apps/vendy/jobs/{job_id}` → `error` field

---
