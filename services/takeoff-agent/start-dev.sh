#!/bin/bash
# Start the takeoff-agent locally for development.
# Run this from the services/takeoff-agent directory.

set -e

# ── Load .env (handles values with spaces) ───────────────────────────────────
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip blank lines and comments
    [[ -z "$line" || "$line" == \#* ]] && continue
    # Export KEY=VALUE, preserving spaces in values
    export "$line"
  done < .env
fi

# ── Activate venv ────────────────────────────────────────────────────────────
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt --quiet
else
  source venv/bin/activate
fi

# ── Pull ANTHROPIC_API_KEY from Secret Manager if not already set ─────────────
if [ -z "$ANTHROPIC_API_KEY" ]; then
  GCP_SECRET_PROJECT="${GCP_SECRET_PROJECT:-buildertrend-pipeline}"
  echo "Fetching anthropic-api-key from Secret Manager (project: $GCP_SECRET_PROJECT)..."

  ANTHROPIC_API_KEY=$(python3 - <<PYEOF 2>/dev/null
import os
from google.cloud import secretmanager
project = "$GCP_SECRET_PROJECT"
client = secretmanager.SecretManagerServiceClient()
try:
    resp = client.access_secret_version(
        name=f"projects/{project}/secrets/anthropic-api-key/versions/latest"
    )
    print(resp.payload.data.decode("utf-8").strip())
except Exception as e:
    print("")
PYEOF
)

  if [ -n "$ANTHROPIC_API_KEY" ]; then
    export ANTHROPIC_API_KEY
    echo "✔  ANTHROPIC_API_KEY loaded from Secret Manager."
  else
    echo "⚠️  ANTHROPIC_API_KEY not found in Secret Manager — takeoff extraction won't work."
  fi
else
  echo "✔  ANTHROPIC_API_KEY set."
fi

# ── Start the server ─────────────────────────────────────────────────────────
echo ""
echo "Starting takeoff-agent on http://localhost:${PORT:-8001}"
uvicorn main:app --host 0.0.0.0 --port "${PORT:-8001}" --reload
