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
