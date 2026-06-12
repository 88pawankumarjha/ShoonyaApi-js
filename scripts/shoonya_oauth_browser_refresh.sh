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

cleanup_runtime_cache() {
  rm -rf /tmp/shoonya-oauth-browser-* /tmp/.org.chromium.Chromium.* /tmp/selenium-* 2>/dev/null || true

  local selenium_cache="${HOME:-/home/ubuntu}/.cache/selenium"
  [[ -d "$selenium_cache" ]] || return 0

  local free_kb cache_kb
  free_kb="$(df -Pk "$REPO_DIR" | awk 'NR==2 {print $4}')"
  cache_kb="$(du -sk "$selenium_cache" 2>/dev/null | awk '{print $1}')"

  if [[ "${free_kb:-0}" -lt 1048576 || "${cache_kb:-0}" -gt 614400 ]]; then
    echo "Cleaning Selenium cache before Shoonya OAuth refresh. free_kb=${free_kb:-unknown} cache_kb=${cache_kb:-unknown}"
    rm -rf "$selenium_cache"
  fi
}

cleanup_runtime_cache

VENV_DIR="${SHOONYA_OAUTH_BROWSER_VENV:-$REPO_DIR/.venv-shoonya-oauth}"
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade pip
  "$VENV_DIR/bin/pip" install "selenium>=4.15.0" "requests>=2.31.0"
fi

exec "$VENV_DIR/bin/python" "$REPO_DIR/scripts/shoonya_oauth_browser_refresh.py" "$@"
