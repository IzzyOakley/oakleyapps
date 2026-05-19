# Vendy — Claude Code Context

> **Copy this file to the root of the oakleyapps repo before starting any session.**
> Claude Code reads CLAUDE.md automatically on every session. This is your persistent codebase brief.

---

## What This Is

Vendy is a bid management platform for Oakley Home Builders. It automates construction bidding:
blueprint upload → AI takeoff extraction → bid generation per vendor → bid lifecycle management.

**This is an existing production app on Firebase App Hosting, connected to GitHub.**
Do NOT scaffold a new project. Do NOT run `create-next-app` or any project initializer.
Work entirely within the existing monorepo.

---

## Build Status

| Phase | Name | Status |
|-------|------|--------|
| 0 | Foundation | ✅ Complete |
| 1 | Takeoff Feature | ✅ Complete — live in production |
| 2 | Cloud Run Deployment | 🔄 In progress |
| 3 | Bid Generator | ⬜ Not started |
| 4 | Vendor Intelligence | ⬜ Not started |
| 5 | Bid Lifecycle | ⬜ Not started |
| 6 | Analytics & Reporting | ⬜ Not started |

**The takeoff feature is live.** After every change to shared files, verify that the hub page,
blueprint upload, takeoff generation, PM review, and approval flow still work end-to-end.

---

## Two GCP Projects

| GCP Project | Services |
|-------------|----------|
| `buildertrend-pipeline` | Cloud Firestore (default database), Cloud Storage (`oakley-documents`), Pub/Sub (`takeoff-events`) |
| `oakley-apps` | Firebase Auth, Cloud Run (`takeoff-agent`), Secret Manager, Artifact Registry |

---

## Repo Structure

```
oakleyapps/
├── firestore.indexes.json                   # Composite indexes for buildertrend-pipeline Firestore
├── apps/web/src/
│   ├── app/(authenticated)/vendy/
│   │   ├── page.tsx                         # Vendy landing — 3 feature tiles
│   │   └── takeoffs/                        # ⚠ EXISTING — do not break
│   │       ├── page.tsx
│   │       ├── TakeoffHubClient.tsx
│   │       └── [project_id]/
│   │           ├── page.tsx
│   │           ├── ProjectDetailClient.tsx
│   │           └── review/[job_id]/
│   │               ├── page.tsx
│   │               └── ReviewClient.tsx
│   ├── app/api/vendy/[...path]/route.ts     # ⚠ EXISTING proxy — extend, don't replace
│   └── lib/vendy/
│       ├── api.ts                           # ⚠ EXISTING — add functions, don't remove
│       └── types.ts                         # ⚠ EXISTING — add types, don't remove
│
└── services/takeoff-agent/                  # ⚠ EXISTING Python FastAPI on Cloud Run
    ├── main.py                              # Add new endpoints here
    ├── extractor.py                         # Claude API call for takeoff extraction
    ├── firestore_client.py                  # Add new Firestore functions here
    ├── gcs_client.py                        # GCS operations
    ├── pubsub_client.py                     # Pub/Sub publish
    ├── schemas.py                           # Add new Pydantic models here
    ├── prompts/takeoff_v1.md                # Claude system prompt for takeoff
    ├── requirements.txt
    ├── Dockerfile
    └── start-dev.sh
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 App Router, TypeScript, Tailwind CSS |
| Design system | Dark sidebar `#18151F`, page bg `#EAEAED`, white cards, violet primary `#7C3AED` |
| Backend agent | Python 3.11, FastAPI, Uvicorn — deployed on Cloud Run (oakley-apps) |
| AI model | `claude-opus-4-6` via Anthropic SDK — PDF docs passed as base64 |
| Database | Cloud Firestore, Native mode, project: `buildertrend-pipeline`, database: `(default)` |
| File storage | Cloud Storage, bucket: `oakley-documents` (buildertrend-pipeline) |
| Events | Cloud Pub/Sub, topic: `takeoff-events` (buildertrend-pipeline) |
| Auth | Firebase Authentication (oakley-apps) + Next.js session cookie proxy |

---

## Authentication Model

All browser requests go through the Next.js proxy at `/api/vendy/[...path]/route.ts`.

The proxy:
1. Validates the Firebase session cookie via Firebase Admin SDK
2. Extracts `email` and `role` from the decoded token
3. Forwards to `TAKEOFF_AGENT_URL` with three injected headers

| Header | Value |
|--------|-------|
| `X-User-Email` | Verified user email |
| `X-User-Role` | `admin` / `management` / `pm` / `staff` |
| `X-Internal-Secret` | Shared secret — must match `INTERNAL_SERVICE_SECRET` on agent |

The takeoff-agent trusts these headers directly. Requests missing or failing `X-Internal-Secret` return 401.
**The Cloud Run URL is never exposed to the browser.**

---

## Roles

| Role | Permissions |
|------|-------------|
| `admin` | read, write, delete, manage_users, manage_vendors |
| `management` | read, write, approve_bids, approve_change_orders |
| `pm` | read, write, create_takeoffs, submit_bids |
| `staff` | read only |

Enforced at both Next.js middleware and the FastAPI `require_pm` dependency.

---

## Firestore Collection Map

Everything lives under the `apps` top-level collection:

```
apps/vendy/vendors/{vendor_slug}       vendor profiles + pricing intelligence
  └── bid_ledger/{bid_id}              one doc per processed bid outcome (NEW)
apps/vendy/bids/{bid_id}               AI-generated bid drafts
apps/vendy/jobs/{job_id}               takeoff extraction jobs
apps/vendy/runs/{run_id}               AI agent audit log
apps/shared/projects/{project_id}      construction projects
apps/shared/takeoffs/{project_id}      approved takeoff snapshots
apps/shared/cost_codes/{full_code}     103 cost codes across 14 categories
apps/shared/users/{user_id}            user profiles
apps/shared/roles/{role_id}            role permission definitions
```

Composite indexes deployed — see [firestore.indexes.json](firestore.indexes.json). Deploy with:
`firebase deploy --only firestore:indexes --project buildertrend-pipeline`

**Document ID rule:** all IDs are slugs.
Python: `re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")`
TypeScript: `name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')`

---

## Key Document Schemas

### apps/vendy/vendors/{slug}

```json
{
  "name": "A&E Roofing & Siding",
  "trade": "Roofing",
  "contact_email": "contact@example.com",
  "active": true,
  "bid_format": "itemized",
  "created_at": "<timestamp>",
  "pricing_profile": { "...": "LEGACY — read-only, never write" },
  "price_book": {
    "last_updated": "2026-05-13T18:43:02Z",
    "bids_processed": 4,
    "categories": {
      "3500": {
        "GUTTERS: 5\" K-Style seamless...": {
          "cost_code_name": "Gutters",
          "awarded": {
            "unit_price": { "min": null, "max": null, "avg": null, "sample_count": 0 },
            "extension": { "min": 7700.0, "max": 7700.0, "avg": 7700.0, "sample_count": 1 },
            "last_seen": "2026-04-06"
          },
          "not_awarded": {
            "unit_price": { "min": null, "max": null, "avg": null, "sample_count": 0 },
            "extension": { "min": null, "max": null, "avg": null, "sample_count": 0 },
            "last_seen": null
          }
        }
      }
    }
  }
}
```

### apps/vendy/bids/{bid_id}

```json
{
  "bid_id": "0153e089-a5b5-4b58-90a4-53b6b8404144",
  "project_id": "701_hill_malesevic",
  "project_name": "701 Hill - Malesevic",
  "vendor_id": "energy_services",
  "vendor_name": "energy_services",
  "cost_code": "3700",
  "cost_code_name": "HVAC",
  "status": "needs_review",
  "subtotal": 44450.0,
  "generated_at": "<timestamp>",
  "generation_notes": "Explanation of pricing sources and gaps...",
  "approved_at": null,
  "approved_by": null,
  "pdf_gcs_path": null,
  "line_items": [
    {
      "description": "Mechanical System base price",
      "quantity": 1.0,
      "unit": "LS",
      "unit_price": 39550.0,
      "total": 39550.0,
      "source": "history",
      "notes": "Sourced from awarded price_book data.",
      "takeoff_ref": "17b8746d-...,c1afafa3-..."
    }
  ]
}
```

### apps/vendy/vendors/{slug}/bid_ledger/{bid_id}

```json
{
  "bid_id": "uuid",
  "project_id": "701_hill_malesevic",
  "project_name": "701 Hill - Malesevic",
  "cost_code": "3700",
  "cost_code_name": "HVAC",
  "outcome": "awarded",
  "bid_date": "2026-05-15",
  "subtotal": 44450.0,
  "line_items": [ "...full copy of line_items at time of outcome..." ],
  "created_at": "<timestamp>"
}
```

### apps/shared/projects/{project_id}

```json
{
  "job_name": "701 Hill - Malesevic",
  "address": "",
  "status": "open",
  "blueprint_gcs_path": null,
  "bt_job_id": "701_hill_malesevic",
  "flags": {},
  "created_at": "<timestamp>"
}
```

### apps/vendy/jobs/{job_id}

```json
{
  "project_ref": "apps/shared/projects/701_hill_malesevic",
  "status": "complete",
  "takeoff_data": { "summary": {}, "sections": [] },
  "blueprints": [],
  "flags": [],
  "created_by": "elizabeth@oakleyhomebuilders.com",
  "created_at": "<timestamp>",
  "updated_at": "<timestamp>",
  "error": null
}
```

### apps/shared/cost_codes/{full_code}

```json
{
  "full_code": "3500",
  "name": "Gutters",
  "category": "Exterior Finishes",
  "vendors": ["a_e_roofing_siding"],
  "flags": {
    "include_in_estimation": true,
    "biddable": true,
    "include_in_vendor_extraction": true
  },
  "is_profit_item": false,
  "app_settings": {}
}
```

---

## CI/CD

Workflows live in `.github/workflows/`. The `takeoff-agent.yml` workflow:

- Triggers on push to `main` when `services/takeoff-agent/**` files change
- Runs `ruff` lint + format check on PRs and main
- On merge to main: builds Docker image, pushes to `us-central1-docker.pkg.dev/oakley-apps/oakley-apps/takeoff-agent`, deploys to Cloud Run
- Cloud Run config: 2Gi RAM, 2 CPU, 300s timeout, 0–5 instances, `--no-allow-unauthenticated`
- All secrets (`ANTHROPIC_API_KEY`, `MODEL_VERSION`, `INTERNAL_SERVICE_SECRET`) are mounted from Secret Manager — no secrets in the YAML
- Auth uses Workload Identity Federation via `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT_EMAIL` GitHub secrets

---

## Bid Generator — Pricing Source Priority

When building a bid line item for a vendor, check in this order:

1. `price_book.categories[cost_code][item_description].awarded` — if `sample_count > 0`, use `avg` as base price. Mark `source: "history"`.
2. `price_book.categories[cost_code][item_description].not_awarded` — use `avg` if awarded is empty. Mark `source: "history"`. Note in `generation_notes`: *"Based on non-awarded bids only — treat as directional."*
3. Legacy `pricing_profile.categories[cost_code][item_description]` — last resort. Mark `source: "history"`. Note in `generation_notes`: *"Sourced from legacy pricing history — pre-dates structured bid model."*
4. No data anywhere — mark `source: "generated"`. Flag for PM review in `generation_notes`.

---

## Bid Status Workflow

```
needs_review → sent → confirmed → revised → awarded
                                          → not_awarded
                                          → rejected
```

When a bid is marked `awarded`, all other bids for the same `project_id + cost_code` are automatically set to `not_awarded` in a Firestore batch write.

When a bid is marked `awarded` or `not_awarded`, a Cloud Function fires and writes to `bid_ledger` and updates `price_book`.

---

## Cloud Storage Layout

```
oakley-documents/
  projects/{Job Name}/
    blueprints/{filename}.pdf
    blueprint-pages/page_001.png, page_002.png ...
  vendors/{vendor_slug}/
    [legacy bid PDFs — DO NOT MODIFY this path or its Cloud Function]
```

Folder names under `projects/` must exactly match `job_name` in Firestore.

---

## Critical Rules

1. **Never scaffold a new project.** Existing production app — work within the monorepo.
2. **Never break the takeoff feature.** It is live. Test the full flow after every change to shared modules.
3. **Never write to `pricing_profile`.** It is frozen legacy data. Read-only fallback only.
4. **`price_book` is written by Cloud Functions only.** Never write it from FastAPI or the browser.
5. **`bid_ledger` is append-only.** Never edit or delete bid_ledger documents.
6. **Multi-document updates use batched writes.** Award flow, status cascades — always batch.
7. **Never expose the Cloud Run URL to the browser.** All requests go through the Next.js proxy.
8. **Slugs are the ID convention everywhere.** Use the slug function above consistently.
9. **Vendor `active: false` takes effect immediately.** No cache — deactivated vendors must not appear in bid generation.
10. **Log every Claude API call to `apps/vendy/runs`.** Token counts, model version, prompt version, duration, outcome.

---

## Environment Variables

### services/takeoff-agent/.env (local dev — gitignored)

```
FIREBASE_PROJECT_ID=buildertrend-pipeline
GCS_BUCKET=oakley-documents
GCS_PROJECT=buildertrend-pipeline
PUBSUB_PROJECT=buildertrend-pipeline
PUBSUB_TOPIC=takeoff-events
ANTHROPIC_API_KEY=sk-ant-...
MODEL_VERSION=claude-opus-4-6
PROMPT_VERSION=v1
PORT=8001
INTERNAL_SERVICE_SECRET=oakley-internal-dev
GOOGLE_APPLICATION_CREDENTIALS=/path/to/buildertrend-pipeline-key.json
```

### apps/web/.env.local (local dev — gitignored)

```
TAKEOFF_AGENT_URL=http://localhost:8001
INTERNAL_SERVICE_SECRET=oakley-internal-dev
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
FIREBASE_ADMIN_CLIENT_EMAIL=...
FIREBASE_ADMIN_PRIVATE_KEY=...
```

---

## Local Dev

```bash
# Start backend
cd services/takeoff-agent && bash start-dev.sh
# Starts Uvicorn on http://localhost:8001

# Start frontend
pnpm dev   # from monorepo root
# Next.js on http://localhost:3000

# Verify backend
curl http://localhost:8001/health
# → {"status":"ok","version":"0.1.0"}
```

---

## Reference Documents

All in the `03 - Vendy/` folder of the Oakley Apps Platform documents:

| Document | Contents |
|----------|----------|
| `Vendy_PRD_v1.0.docx` | Product requirements, feature list, user stories |
| `Vendy_TRD_v1.0.docx` | Technical requirements, constraints, integrations |
| `Vendy_AppFlow_v1.1.docx` | Navigation map, user journeys, screen flows |
| `Vendy_UIUXDesignBrief_v1.0.docx` | Wireframes, design system, component specs |
| `Vendy_BackendSchema_v1.0.docx` | Full Firestore schema, all field definitions |
| `Vendy_ImplementationPlan_v1.0.docx` | Phase-by-phase task list with acceptance criteria |
