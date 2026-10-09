#!/usr/bin/env bash
# Ship the working tree of web/ to the server, build there, restart.
# Usage: deploy/deploy.sh <server-ip>   (from rbola/)
set -euo pipefail
HOST="root@${1:?server ip}"
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules --exclude .next --exclude '.env*' \
  --exclude public/catches --exclude data/races.json --exclude data/catalog-pending.json \
  --exclude tsconfig.tsbuildinfo \
  web/ "$HOST:/srv/rbola/app/web/"

ssh "$HOST" 'set -e
  chown -R rbola:rbola /srv/rbola/app
  cd /srv/rbola/app/web
  sudo -u rbola bash -c "set -a; . /srv/rbola/env; set +a; npm install --no-audit --no-fund && npm run build"
  systemctl restart rbola
  sleep 3; systemctl --no-pager --lines=5 status rbola'
