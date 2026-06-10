#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

LOCK_FILE="${SHOONYA_OAUTH_BROWSER_LOCK_FILE:-/tmp/shoonya-oauth-browser-refresh.lock}"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Shoonya OAuth browser refresh is already running."
  exit 1
fi

VENV_DIR="${SHOONYA_OAUTH_BROWSER_VENV:-$REPO_DIR/.venv-shoonya-oauth}"
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade pip
  "$VENV_DIR/bin/pip" install "selenium>=4.15.0" "requests>=2.31.0"
fi

exec "$VENV_DIR/bin/python" "$REPO_DIR/scripts/shoonya_oauth_browser_refresh.py" "$@"
