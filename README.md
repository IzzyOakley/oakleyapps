# Oakley Apps

Internal tooling platform for Oakley Home Builders — a role-based workspace that houses AI-powered apps for bidding automation, change order pricing, and project management.

## Monorepo Structure

```
oakleyapps/
├── apps/
│   ├── web/                    # Next.js 14 shell — main frontend
│   └── margo/                  # MargO app stub (Phase 2+)
├── shared/
│   ├── components/             # Shared UI component library (shadcn/ui base)
│   └── auth/                   # Firebase auth helpers and hooks
├── services/
│   ├── api-gateway/            # Python FastAPI — token validation + agent routing
│   └── functions/              # Firebase Cloud Functions (role management)
├── .github/workflows/          # CI/CD pipelines
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Prerequisites

- **Node.js** 20+ — [nvm](https://github.com/nvm-sh/nvm) recommended
- **pnpm** 9+ — `npm install -g pnpm`
- **Firebase CLI** — `npm install -g firebase-tools`
- **gcloud CLI** — [install guide](https://cloud.google.com/sdk/docs/install)
- **Python** 3.11+ (for api-gateway local dev)

## Local Dev Setup

```bash
# 1. Clone the repo
git clone https://github.com/IzzyOakley/oakleyapps.git
cd oakleyapps

# 2. Install dependencies
pnpm install

# 3. Configure environment variables
cp apps/web/.env.example apps/web/.env.local
# Fill in your Firebase config values (see Firebase Console → Project Settings → Your apps)

# 4. Start the dev server
pnpm dev
# Opens on http://localhost:3000
```

For the API gateway locally:
```bash
cd services/api-gateway
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in values
uvicorn main:app --reload --port 8080
```

## Required GitHub Secrets

Add these in **GitHub → Settings → Secrets and variables → Actions** before CI runs:

| Secret | Description |
|--------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase Admin SDK service account JSON, base64-encoded. Generate in Firebase Console → Project Settings → Service Accounts → Generate new private key, then `base64 < key.json` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Federation provider resource name — format: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `oakley-automation@oakley-apps.iam.gserviceaccount.com` |

## Deployment Overview

| App | Platform | Trigger |
|-----|----------|---------|
| `apps/web` | Firebase App Hosting | Push to `main` affecting `apps/web/**` or `shared/**` |
| `services/api-gateway` | Cloud Run (`us-central1`) | Push to `main` affecting `services/api-gateway/**` |
| Feature branches | Firebase preview channel | Push to `feature/*` or `fix/*` |

After first deploy, point `oakleyapps.com` DNS to the Firebase App Hosting URL in Cloudflare.

## Adding a New App

1. Create `apps/<appname>/` following the Next.js structure in `apps/web`
2. Add the app tile to `shared/components/src/AppTile` data and the role permission matrix in `apps/web/middleware.ts`
3. Add a CI workflow in `.github/workflows/<appname>.yml` mirroring `web.yml`

## Role Management

Roles are stored as Firebase custom claims. Available roles:

| Role | Label | Access |
|------|-------|--------|
| `admin` | Administrator | All routes + user management |
| `management` | Management | Vendy, MargO, Dashboard |
| `pm` | Project Manager | Vendy, MargO, Dashboard |
| `staff` | Staff | Dashboard only |
| `vendor` | Vendor | Dashboard only |

New users are auto-assigned `staff` on first sign-in. Admins can change roles at `/admin/users`.
