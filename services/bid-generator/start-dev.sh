#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    export "$line"
  done < "$SCRIPT_DIR/.env"
fi

if [ -f "$SCRIPT_DIR/.venv/bin/activate" ]; then
  source "$SCRIPT_DIR/.venv/bin/activate"
fi

cd "$SCRIPT_DIR"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8090}" --reload
