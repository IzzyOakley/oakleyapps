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
| 2 | Cloud Run Deployment | ✅ Complete |
| 3 | Bid Generator | ✅ Complete |
| 4 | Vendor Intelligence | ✅ Complete |
| 5 | Bid Lifecycle | ✅ Complete — live in production |
| 6 | Analytics & Reporting | ✅ Complete — live in production |
| 7 | Service Scaffold & Airtable Integration | ✅ Complete — deployed to Cloud Run |
| 8 | Project Creation — Both Sources | ✅ Complete |
| 9 | DXF Pre-Processor | ✅ Complete |

After every change to shared files, verify that the hub page, blueprint upload, takeoff generation, PM review, and approval flow still work end-to-end.

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
│   │   ├── takeoffs/                        # ⚠ EXISTING — do not break
│   │   │   ├── page.tsx
│   │   │   ├── TakeoffHubClient.tsx
│   │   │   └── [project_id]/
│   │   │       ├── page.tsx
│   │   │       ├── ProjectDetailClient.tsx
│   │   │       └── review/[job_id]/
│   │   │           ├── page.tsx
│   │   │           └── ReviewClient.tsx
│   │   ├── bids/                            # Bid generator UI
│   │   │   ├── page.tsx
│   │   │   ├── BidsHubClient.tsx            # Hub: Needs Review / In Progress / Completed
│   │   │   └── [project_id]/
│   │   │       ├── page.tsx
│   │   │       ├── ProjectBidsClient.tsx    # Vendor selection + bid generation
│   │   │       └── [bid_id]/
│   │   │           ├── page.tsx
│   │   │           └── BidReviewClient.tsx  # Line item review, action bar, comms log
│   │   └── analytics/                       # Analytics dashboard (management/admin only)
│   │       ├── page.tsx                     # Server component — role gate (management/admin)
│   │       └── AnalyticsClient.tsx          # 4 stat cards + 3 charts + cost-vs-budget table
│   ├── app/api/vendy/[...path]/route.ts     # ⚠ EXISTING proxy — extend, don't replace
│   ├── app/api/vendy/bids/[...path]/route.ts  # Proxy to bid-generator Cloud Run
│   └── lib/vendy/
│       ├── api.ts                           # ⚠ EXISTING — add functions, don't remove
│       ├── types.ts                         # ⚠ EXISTING — add types, don't remove
│       ├── bids-api.ts                      # Bid-specific fetch helpers (downloadBidPdf etc.)
│       └── analytics-api.ts                 # Analytics fetch helpers (4 endpoints)
│
├── services/takeoff-agent-v2/               # NEW Python FastAPI — v2 multi-agent system (Phase 7+)
│   ├── main.py                              # FastAPI app — all v2 endpoints
│   ├── schemas.py                           # Pydantic models — V2Project, SharedParams, etc.
│   ├── firestore_client.py                  # v2 Firestore helpers (project CRUD, preprocess, run log)
│   ├── gcs_client.py                        # GCS project folder listing, DXF download/upload
│   ├── airtable_client.py                   # Airtable REST client — Contract Signed projects + estimate lines
│   ├── estimate_parser.py                   # pdfplumber PDF estimate parser — cost_code/final_cost pairs
│   ├── dxf_config.py                        # Layer name config for DXF extraction (update in Phase 16)
│   ├── dxf_processor.py                     # DXFProcessor — LWPOLYLINE/HATCH area + block counts
│   ├── agent_registry.py                    # AGENT_REGISTRY — all 49 cost codes → agent type + config
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── start-dev.sh                         # Port 8003
│   └── tests/
│       ├── test_airtable_client.py
│       ├── test_estimate_parser.py
│       ├── test_project_creation.py
│       └── test_dxf_processor.py
│
├── services/takeoff-agent/                  # ⚠ EXISTING Python FastAPI on Cloud Run
│   ├── main.py                              # Add new endpoints here
│   ├── extractor.py                         # Claude API call for takeoff extraction
│   ├── firestore_client.py                  # Add new Firestore functions here
│   ├── gcs_client.py                        # GCS operations
│   ├── pubsub_client.py                     # Pub/Sub publish
│   ├── schemas.py                           # Add new Pydantic models here
│   ├── prompts/takeoff_v1.md                # Claude system prompt for takeoff
│   ├── requirements.txt
│   ├── Dockerfile
│   └── start-dev.sh
│
├── services/bid-generator/                  # Python FastAPI on Cloud Run — bid generation
│   ├── main.py                              # FastAPI app, lifespan startup, all endpoints
│   ├── bid_builder.py                       # Pricing logic, generate_bid orchestration
│   ├── firestore_client.py                  # Bid CRUD, vendor/cost_code queries, log_run
│   ├── generator.py                         # Claude API call for bid generation
│   ├── pubsub_subscriber.py                 # Streaming pull from takeoff-events-bid-generator
│   ├── pdf_client.py                        # ReportLab PDF generation
│   ├── schemas.py                           # Pydantic models
│   ├── prompts/bid_gen_v1.md                # Claude system prompt for bid generation
│   ├── requirements.txt
│   ├── Dockerfile
│   └── tests/test_bid_builder.py            # Unit tests — 4 pricing tiers
│
├── services/bigquery/
│   └── setup_views.sql                      # Run once in BigQuery console to create views
├── services/cloud-functions/
│   ├── on_bid_outcome/                      # GCP Cloud Function (gen2) — buildertrend-pipeline
│   │   ├── main.py                          # Entry: on_bid_outcome — writes bid_ledger + updates price_book
│   │   ├── requirements.txt
│   │   └── tests/test_price_book.py
│   └── bid_ledger_to_bigquery/              # Scheduled Cloud Function (nightly 02:00 UTC)
│       ├── main.py                          # HTTP trigger — exports bid_ledger docs to BigQuery
│       └── requirements.txt
└── .github/workflows/
    ├── takeoff-agent.yml                    # CI/CD for takeoff-agent Cloud Run service
    ├── bid-generator.yml                    # CI/CD for bid-generator Cloud Run service
    ├── on-bid-outcome.yml                   # CI/CD for on_bid_outcome Cloud Function (gen2)
    └── bid-ledger-to-bigquery.yml           # CI/CD for bid_ledger_to_bigquery + Cloud Scheduler
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

All browser requests go through one of two Next.js proxies:

| Proxy | Upstream service |
|-------|-----------------|
| `app/api/vendy/[...path]/route.ts` | `takeoff-agent` Cloud Run (`TAKEOFF_AGENT_URL`) |
| `app/api/vendy/bids/[...path]/route.ts` | `bid-generator` Cloud Run (`BID_GENERATOR_URL`) |
| `app/api/vendy/takeoffs-v2/[...path]/route.ts` | `takeoff-agent-v2` Cloud Run (`TAKEOFF_AGENT_V2_URL`) |

Both proxies:
1. Validate the Firebase session cookie via Firebase Admin SDK (returns 401 if missing/invalid)
2. Extract `email` and `role` from the decoded token
3. Fetch a **Google OIDC identity token** from the GCE metadata server (production only — `https://` URLs)
4. Forward to the upstream Cloud Run with four headers

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <Google identity token>` — required by Cloud Run IAM (`--no-allow-unauthenticated`) |
| `X-User-Email` | Verified user email |
| `X-User-Role` | `admin` / `management` / `pm` / `staff` |
| `X-Internal-Secret` | Shared secret — must match `INTERNAL_SERVICE_SECRET` on the service |

The Cloud Run services trust the `X-*` headers when the internal secret is valid.
**The Cloud Run URL is never exposed to the browser.**

### Cloud Run IAM requirement
Both Cloud Run services use `--no-allow-unauthenticated`. The Firebase App Hosting compute SA must have `roles/run.invoker` on **each** service:
```bash
gcloud run services add-iam-policy-binding <service-name> \
  --member="serviceAccount:firebase-app-hosting-compute@oakley-apps.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1 --project=oakley-apps
```
This is automated in `bid-generator.yml` on every deploy. If a new Cloud Run service is added, add this step to its workflow and run it once manually.

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
apps/vendy/bids/{bid_id}               AI-generated bid drafts (written by bid-generator service)
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
  "updated_at": "<timestamp>",
  "generation_notes": "Explanation of pricing sources and gaps...",
  "approved_at": null,
  "approved_by": null,
  "pdf_gcs_path": null,
  "comms_log": [
    { "author": "elizabeth@oakleyhomebuilders.com", "timestamp": "<iso>", "body": "Called vendor, confirmed scope." }
  ],
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

**Valid `status` values:** `generating` → `needs_review` → `sent` → `confirmed` → `revised` → `awarded` / `not_awarded` / `rejected`. Also `failed`. Legacy `approved` treated as `sent`.

**Valid transitions** (enforced by `VALID_TRANSITIONS` dict in `services/bid-generator/main.py`):
- `needs_review` → `sent`
- `sent` → `confirmed`, `awarded`, `not_awarded`, `rejected`
- `confirmed` → `revised`, `awarded`, `not_awarded`, `rejected`
- `revised` → `confirmed`, `awarded`, `not_awarded`, `rejected`

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

Workflows live in `.github/workflows/`. Both services follow the same pattern:

- Triggers on push to `main` when files in the service directory change, plus `workflow_dispatch`
- Runs `ruff` lint + format check on PRs and main pushes
- On merge to main: builds Docker image, pushes to Artifact Registry, deploys to Cloud Run
- Cloud Run config: 2Gi RAM, 2 CPU, 300s timeout, 0–5 instances, `--no-allow-unauthenticated`
- All secrets (`ANTHROPIC_API_KEY`, `MODEL_VERSION`, `INTERNAL_SERVICE_SECRET`) are mounted from Secret Manager — never in the YAML
- Auth uses Workload Identity Federation via `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT_EMAIL` GitHub secrets
- `bid-generator.yml` runs `gcloud run services add-iam-policy-binding` after every deploy to keep the Firebase App Hosting SA's `roles/run.invoker` binding in place

| Workflow | Service | Image |
|----------|---------|-------|
| `takeoff-agent.yml` | `takeoff-agent` | `us-central1-docker.pkg.dev/oakley-apps/oakley-apps/takeoff-agent` |
| `bid-generator.yml` | `bid-generator` | `us-central1-docker.pkg.dev/oakley-apps/oakley-apps/bid-generator` |

### Pre-push checklist for frontend changes
Firebase App Hosting treats unused TypeScript imports as build errors. Always run before pushing:
```bash
pnpm --filter web build
```
A clean build must show **zero warnings**. Fix any `'X' is defined but never used` before pushing.

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
4. **`price_book` is written by `on_bid_outcome` Cloud Function only.** Never write it from FastAPI or the browser.
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

### services/bid-generator/.env (local dev — gitignored)

```
FIREBASE_PROJECT_ID=buildertrend-pipeline
GCS_BUCKET=oakley-documents
GCS_PROJECT=buildertrend-pipeline
PUBSUB_PROJECT=buildertrend-pipeline
PUBSUB_TOPIC=takeoff-events
ANTHROPIC_API_KEY=sk-ant-...
MODEL_VERSION=claude-opus-4-6
PROMPT_VERSION=v1
PORT=8002
ENVIRONMENT=development
INTERNAL_SERVICE_SECRET=oakley-internal-dev
GOOGLE_APPLICATION_CREDENTIALS=/path/to/buildertrend-pipeline-key.json
```

### services/takeoff-agent-v2/.env (local dev — gitignored)

```
FIREBASE_PROJECT_ID=buildertrend-pipeline
GCS_BUCKET=oakley-documents
GCS_PROJECT=buildertrend-pipeline
ANTHROPIC_API_KEY=sk-ant-...
MODEL_VERSION=claude-opus-4-6
PORT=8003
INTERNAL_SERVICE_SECRET=oakley-internal-dev
AIRTABLE_API_TOKEN=pat...
GOOGLE_APPLICATION_CREDENTIALS=/path/to/buildertrend-pipeline-key.json
```

### apps/web/.env.local (local dev — gitignored)

```
TAKEOFF_AGENT_URL=http://localhost:8001
BID_GENERATOR_URL=http://localhost:8002
TAKEOFF_AGENT_V2_URL=http://localhost:8003
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

## API Endpoints

### takeoff-agent (proxied via `/api/vendy/[...path]`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/projects` | any | List all projects |
| POST | `/projects` | pm | Create project |
| GET | `/projects/{id}` | any | Project detail |
| GET | `/projects/{id}/blueprint-pages` | any | Blueprint page URLs |
| POST | `/projects/{id}/takeoff` | pm | Start takeoff extraction |
| GET | `/jobs/{job_id}` | any | Takeoff job status + data |
| PATCH | `/jobs/{job_id}/items/{item_id}` | pm | Override takeoff item |
| POST | `/jobs/{job_id}/approve` | pm | Approve takeoff → writes to `apps/shared/takeoffs` |
| GET | `/vendors` | any | List vendors (optional `?active=true`) — includes `cost_codes` array |
| GET | `/vendors/{slug}` | any | Full vendor profile with price_book + cost_codes |
| POST | `/vendors` | management | Create vendor |
| PATCH | `/vendors/{slug}` | management | Update vendor fields (name, email, active) |
| PUT | `/vendors/{slug}/cost-codes` | management | Replace vendor's cost code list |
| GET | `/vendors/{slug}/bid-ledger` | any | Paginated bid history (`?page=1&outcome=awarded`) |
| GET | `/cost-codes` | any | All cost codes with category + vendors array |

### bid-generator (proxied via `/api/vendy/bids/[...path]`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/bids` | any | List all bids |
| GET | `/bids/project/{id}` | any | Bids for a project |
| GET | `/bids/project/{id}/setup` | any | Vendor selection setup |
| GET | `/bids/project/{id}/notes-status` | any | Check if project notes PDF exists in GCS |
| POST | `/bids/project/{id}/notes` | pm | Upload project notes PDF to GCS |
| POST | `/bids/project/{id}/generate` | pm | Generate bids (with vendor selection) |
| GET | `/bids/{bid_id}` | any | Full bid with line items + comms_log |
| PATCH | `/bids/{bid_id}/line-items/{idx}` | pm | Override line item qty/price/notes |
| POST | `/bids/{bid_id}/send` | pm | Send bid to vendor (needs_review → sent) |
| POST | `/bids/{bid_id}/confirm` | pm | Mark vendor confirmed (sent → confirmed) |
| POST | `/bids/{bid_id}/revise` | pm | Mark vendor revised (confirmed → revised) |
| POST | `/bids/{bid_id}/award` | management | Award bid — cascades others to not_awarded |
| POST | `/bids/{bid_id}/decline` | management | Decline bid — body: `{"outcome":"not_awarded"\|"rejected"}` |
| POST | `/bids/{bid_id}/comms-log` | any | Add comms note — body: `{"body":"..."}` |
| POST | `/bids/{bid_id}/approve` | pm | Legacy — transitions needs_review → sent |
| GET | `/bids/{bid_id}/pdf` | any | Download bid PDF |
| GET | `/cost-codes` | any | Biddable cost codes with vendors |
| POST | `/process/{project_id}` | pm | Manual bid generation trigger |

### takeoff-agent-v2 (proxied via `/api/vendy/takeoffs-v2/[...path]`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Returns `{status: ok, version: 2.0.0}` |
| GET | `/v2/airtable/projects` | pm | Contract Signed projects from Airtable, excluding existing Vendy projects |
| GET | `/v2/gcs/projects` | pm | GCS project folders with DXF/PDF flags, excluding existing Vendy projects |
| POST | `/v2/projects/from-airtable` | pm | Create v2 project from Airtable record — body: `{airtable_record_id}` |
| POST | `/v2/projects/from-gcs` | pm | Create v2 project from GCS folder — multipart: folder_name, estimate_pdf, corrected_lines |
| GET | `/v2/projects/{project_id}/dxf-status` | any | DXF presence + preprocess_status |
| POST | `/v2/projects/{project_id}/preprocess` | pm | Run DXF pre-processor — writes SharedParams to dxf_sections/shared_params |

### Cloud Functions (GCP — not proxied)

| Function | Trigger | Project | Description |
|----------|---------|---------|-------------|
| `on_bid_outcome` | Firestore onUpdate `apps/vendy/bids/{bid_id}` | buildertrend-pipeline | Writes `bid_ledger` entry + updates `price_book` rolling stats when status → `awarded` or `not_awarded` |

---

## BigQuery

**GCP project:** `buildertrend-pipeline` | **Dataset:** `vendy_analytics`

### Exported collections (via Firestore → BigQuery extension)
Install the `firebase/firestore-bigquery-export` extension in GCP console for each:

| Firestore collection | BQ table prefix | Raw tables created |
|---|---|---|
| `apps/vendy/bids` | `bids` | `bids_raw_changelog`, `bids_raw_latest` |
| `apps/vendy/vendors` | `vendors` | `vendors_raw_changelog`, `vendors_raw_latest` |
| `apps/vendy/runs` | `runs` | `runs_raw_changelog`, `runs_raw_latest` |
| `apps/shared/projects` | `projects` | `projects_raw_changelog`, `projects_raw_latest` |
| `apps/shared/takeoffs` | `takeoffs` | `takeoffs_raw_changelog`, `takeoffs_raw_latest` |
| `apps/shared/cost_codes` | `cost_codes` | `cost_codes_raw_changelog`, `cost_codes_raw_latest` |

### bid_ledger subcollection (manual export)
Subcollections are not handled by the extension. The `bid_ledger_to_bigquery` Cloud Function runs nightly (02:00 UTC via Cloud Scheduler) and incrementally exports all `apps/vendy/vendors/*/bid_ledger` docs to `vendy_analytics.bid_ledger`. Last-run state stored in `apps/vendy/analytics_config/bid_ledger_export`.

### Views (run `services/bigquery/setup_views.sql` once)
| View | Description |
|---|---|
| `bids_latest` | Deduped bid snapshots — one row per bid |
| `vendors_latest` | Deduped vendor snapshots with `bids_processed` |
| `projects_latest` | Deduped project snapshots with `total_budget` |
| `bid_ledger_flat` | bid_ledger rows with `line_items` unnested — one row per line item |

### Analytics API endpoints (in takeoff-agent, management role minimum)
| Method | Path | Description |
|---|---|---|
| GET | `/analytics/summary` | 4 stat card values: awarded YTD, bids processed, top cost code, top vendor win rate |
| GET | `/analytics/vendor-win-rates?cost_code=` | Per-vendor win rate (awarded/total), min 2 bids, sortable by cost code |
| GET | `/analytics/coverage` | Awarded count per cost code; `thin_coverage: true` when < 3 awarded |
| GET | `/analytics/cost-vs-budget` | Project awarded totals vs `total_budget` field on project docs |

All 4 endpoints: BigQuery primary, Firestore fallback if BigQuery unavailable, 5-minute server-side cache.

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
