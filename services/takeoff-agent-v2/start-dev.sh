#!/bin/bash
# Start takeoff-agent-v2 locally for development.
# Run this from the services/takeoff-agent-v2 directory.

set -e

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    export "$line"
  done < .env
fi

# ── Activate venv ─────────────────────────────────────────────────────────────
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt --quiet
else
  source venv/bin/activate
fi

# ── Start the server ──────────────────────────────────────────────────────────
echo ""
echo "Starting takeoff-agent-v2 on http://localhost:${PORT:-8003}"
uvicorn main:app --host 0.0.0.0 --port "${PORT:-8003}" --reload
