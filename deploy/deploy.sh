#!/usr/bin/env bash
# Ship COMMITTED web/ (git HEAD) to the server, build there, restart.
# Never ships the working tree: uncommitted work from a parallel session must not reach a server.
# Usage: deploy/deploy.sh <server-ip> <prod|staging>   (from anywhere in the repo)
set -euo pipefail
export LC_ALL=C
HOST="root@${1:?usage: deploy.sh <server-ip> <prod|staging>}"
case "${2:?usage: deploy.sh <server-ip> <prod|staging>}" in
  # separate users: a compromised (devnet) staging app can't read mainnet keys
  prod)    ROOT=/srv/rbola;         UNIT=rbola;         RUNAS=rbola ;;
  staging) ROOT=/srv/rbola-staging; UNIT=rbola-staging; RUNAS=rbola-staging ;;
  *) echo "target must be prod or staging" >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."

REV=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git archive HEAD web | tar -x -C "$TMP"
echo "deploying $REV -> $2 ($ROOT, unit $UNIT)"

# excludes protect runtime/server-only files that may live inside the target web/
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude '.env*' \
  --exclude public/catches --exclude data/races.json --exclude data/catalog-pending.json \
  --exclude data/faucet.json --exclude tsconfig.tsbuildinfo \
  "$TMP/web/" "$HOST:$ROOT/app/web/"

ssh "$HOST" "set -e
  echo $REV > $ROOT/app/REVISION
  chown -R $RUNAS:$RUNAS $ROOT/app
  cd $ROOT/app/web
  # install WITHOUT secrets in the environment (dependency install scripts
  # run here); only the build sees the env, to bake NEXT_PUBLIC_* in
  sudo -u $RUNAS bash -c 'npm install --no-audit --no-fund && set -a && . $ROOT/env && set +a && npm run build'
  systemctl restart $UNIT
  sleep 3; systemctl --no-pager --lines=5 status $UNIT"
