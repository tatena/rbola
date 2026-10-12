#!/usr/bin/env bash
# Ship COMMITTED web/ (git HEAD) to the server as a new release, build it there, switch, restart.
# Never ships the working tree: uncommitted work from a parallel session must not reach a server.
#
# Usage: deploy/deploy.sh <server-ip> <prod|staging>                 deploy HEAD
#        deploy/deploy.sh <server-ip> <prod|staging> rollback [name]  point current/ at the previous
#                                                                     (or named) release + restart
#        FRESH=1 deploy/deploy.sh <server-ip> <prod|staging>         deploy with a clean npm ci
#                                                                     (default reuses node_modules when
#                                                                     the lockfile is unchanged)
#
# Server layout (per target ROOT = /srv/rbola | /srv/rbola-staging):
#   ROOT/                 711 runtime-user  (traverse only: others can't list it)
#   ROOT/env              600 runtime-user  secrets — never readable by the build user
#   ROOT/keys/ ROOT/data/ 700 runtime-user
#   ROOT/releases/        711 root
#   ROOT/releases/<ts>-<rev>/   root:<runtime> dirs 750 / files 640: runtime reads via group, can't write
#     web/.next/cache     <runtime>-owned (Next writes its image cache there at runtime)
#   ROOT/current -> releases/<ts>-<rev>   (systemd WorkingDirectory = ROOT/current/web)
#
# Build isolation: `npm ci --ignore-scripts` and `next build` run as the `rbola-build` user, which
# cannot read keys/env/data, with a scrubbed environment holding ONLY the NEXT_PUBLIC_* lines of the
# target env (read here by root). When the build finishes the tree is re-owned by root, so neither
# the build user nor the app can modify a release afterwards. The last 3 releases are kept.
set -euo pipefail
export LC_ALL=C
USAGE="usage: deploy.sh <server-ip> <prod|staging> [rollback [release]]"
HOST="root@${1:?$USAGE}"
TARGET="${2:?$USAGE}"
case "$TARGET" in
  # separate users: a compromised (devnet) staging app can't read mainnet keys
  prod)    ROOT=/srv/rbola;         UNIT=rbola;         RUNAS=rbola;         PORT=3000 ;;
  staging) ROOT=/srv/rbola-staging; UNIT=rbola-staging; RUNAS=rbola-staging; PORT=3001 ;;
  *) echo "target must be prod or staging" >&2; exit 1 ;;
esac
SSH=(ssh -o ConnectTimeout=15 "$HOST")   # few connections: sshd is rate-limited (ufw limit)

# Remote: switch current -> $1 atomically, restart, smoke-test. Shared by deploy + rollback.
SWITCH='
switch_to() {
  ln -sfn "releases/$1" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
  systemctl restart "$UNIT"
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "http://127.0.0.1:$PORT/catch" || true)
    [ "$code" = 200 ] && break; sleep 1
  done
  echo "current -> $1 (REVISION $(cat "$ROOT/releases/$1/REVISION" 2>/dev/null)); local /catch -> HTTP $code"
  systemctl --no-pager --lines=5 status "$UNIT" || true
  [ "$code" = 200 ] || { echo "!! smoke test failed — roll back with: deploy.sh <ip> '"$TARGET"' rollback" >&2; exit 1; }
}'

if [ "${3:-}" = rollback ]; then
  "${SSH[@]}" "ROOT=$ROOT UNIT=$UNIT PORT=$PORT WANT='${4:-}' bash -s" <<REMOTE
set -euo pipefail
$SWITCH
cur=\$(basename "\$(readlink -f "\$ROOT/current")")
if [ -n "\$WANT" ]; then prev=\$WANT
else prev=\$(ls -1 "\$ROOT/releases" | grep -v '\.building$' | sort | grep -B1 -x "\$cur" | head -1); fi
[ -n "\$prev" ] && [ "\$prev" != "\$cur" ] && [ -d "\$ROOT/releases/\$prev/web" ] \
  || { echo "no release to roll back to (current: \$cur)"; ls -1 "\$ROOT/releases"; exit 1; }
echo "rolling back \$cur -> \$prev"
switch_to "\$prev"
REMOTE
  exit 0
fi

cd "$(dirname "$0")/.."
REV=$(git rev-parse --short HEAD)
NAME="$(date -u +%Y%m%d-%H%M%S)-$REV"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git archive HEAD web | tar -x -C "$TMP"
echo "deploying $REV -> $TARGET ($ROOT/releases/$NAME, unit $UNIT)"

B="$ROOT/releases/$NAME.building"
"${SSH[@]}" "set -e
  id rbola-build >/dev/null
  install -d -m 711 -o root -g root $ROOT/releases
  rm -rf $ROOT/releases/*.building          # leftovers of a failed deploy
  install -d -m 700 -o root -g root $B"

rsync -az --exclude '.env*' "$TMP/web/" "$HOST:$B/web/"

FRESH="${FRESH:-0}"
"${SSH[@]}" "ROOT=$ROOT UNIT=$UNIT RUNAS=$RUNAS PORT=$PORT NAME=$NAME REV=$REV B=$B bash -s" <<REMOTE
set -euo pipefail
$SWITCH
exec 9>/run/rbola-deploy-\$UNIT.lock; flock -n 9 || { echo "another deploy of \$UNIT is running"; exit 1; }
echo "\$REV" > "\$B/REVISION"
# dependency reuse: same package.json + lockfile as the live release → copy its node_modules
# (root-sealed, so untampered) instead of a full npm ci. A real copy, not hardlinks: the chown
# below must not touch the live release's files. FRESH=1 forces a clean install.
PREV="\$ROOT/current/web"
REUSE=0
if [ "$FRESH" != 1 ] && [ -d "\$PREV/node_modules" ] \
   && cmp -s "\$PREV/package-lock.json" "\$B/web/package-lock.json" \
   && cmp -s "\$PREV/package.json" "\$B/web/package.json"; then
  echo "deps unchanged since \$(cat "\$ROOT/current/REVISION" 2>/dev/null) — reusing node_modules"
  cp -a "\$PREV/node_modules" "\$B/web/node_modules"
  REUSE=1
fi
chown -R rbola-build:rbola-build "\$B"; chmod 700 "\$B"
cd "\$B/web"
BENV=(env -i PATH=/usr/bin:/bin HOME=/var/lib/rbola-build NEXT_TELEMETRY_DISABLED=1)

# install: no lifecycle scripts, no secrets in the environment (devDeps needed for the build)
[ \$REUSE = 1 ] || sudo -u rbola-build "\${BENV[@]}" npm ci --ignore-scripts --no-audit --no-fund

# build: only NEXT_PUBLIC_* from the target env (root reads the 600 env; build user never can)
mapfile -t PUB < <(sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}\(NEXT_PUBLIC_[A-Za-z0-9_]*\)=[\"']\{0,1\}\([^\"']*\)[\"']\{0,1\}[[:space:]]*\$/\2=\3/p" "\$ROOT/env")
echo "build env: \${#PUB[@]} NEXT_PUBLIC_* var(s)"
sudo -u rbola-build "\${BENV[@]}" NODE_ENV=production "\${PUB[@]}" npm run build

# seal: root owns the release; runtime user reads via group; only .next/cache stays writable
rm -rf .next/cache/turbopack               # build-only cache, GBs, useless to the next release
chown -R root:"\$RUNAS" "\$B"
chmod -R u=rwX,g=rX,o= "\$B"
install -d -m 750 -o "\$RUNAS" -g "\$RUNAS" .next/cache
chown -R "\$RUNAS":"\$RUNAS" .next/cache
cd /
mv "\$B" "\$ROOT/releases/\$NAME"
switch_to "\$NAME"

# keep the 3 newest releases (never the current one)
cur=\$(basename "\$(readlink -f "\$ROOT/current")")
ls -1 "\$ROOT/releases" | grep -v '\.building\$' | sort -r | tail -n +4 | while read -r old; do
  [ "\$old" = "\$cur" ] || { echo "pruning release \$old"; rm -rf "\$ROOT/releases/\$old"; }
done
REMOTE
