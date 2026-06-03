#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/2

/usr/bin/pm2 delete shoonya-oauth-listener >/dev/null 2>&1 || true
/usr/bin/pm2 start scripts/shoonya_oauth_listen.js \
  --name shoonya-oauth-listener \
  --interpreter node \
  --no-autorestart \
  --time
