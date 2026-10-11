#!/usr/bin/env bash
# Nightly backup (cron 03:30, installed as /usr/local/bin/rbola-backup). Runs on the server as root.
#  - /srv/backups/YYYY-MM-DD/{prod,staging}-data.tar.gz   app data only (no keys, no env)
#  - /srv/backups/secrets/secrets-YYYY-MM-DD.tar.gz      prod keys + env, root-only
# Keeps 14 days of each. Hourly: `rbola-backup ledger` (see below). Cron output ->
# /var/log/rbola-backup.log. Local to this server only — no off-server copy yet.
set -euo pipefail
umask 077
B=/srv/backups

# `rbola-backup ledger` (cron hourly): snapshot the prod race ledger to
# /srv/backups/ledger/races-YYYYMMDD-HH.json (dir 700, files 600), keep 7 days.
if [ "${1:-}" = ledger ]; then
  L=$B/ledger
  SRC=/srv/rbola/data/state/races.json
  mkdir -p "$L" && chmod 700 "$B" "$L"
  if [ -f "$SRC" ]; then
    OUT="$L/races-$(date +%Y%m%d-%H).json"
    cp "$SRC" "$OUT.tmp" && chmod 600 "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
  fi
  find "$L" -maxdepth 1 -type f -name 'races-*.json' -mmin +$((7 * 24 * 60)) -delete
  exit 0
fi

DAY=$(date +%F)
KEEP_DAYS=14

mkdir -p "$B/$DAY" "$B/secrets"
chmod 700 "$B" "$B/$DAY" "$B/secrets"

tar -czf "$B/$DAY/prod-data.tar.gz.tmp"    -C /srv/rbola         data
mv "$B/$DAY/prod-data.tar.gz.tmp" "$B/$DAY/prod-data.tar.gz"
if [ -d /srv/rbola-staging/data ]; then
  tar -czf "$B/$DAY/staging-data.tar.gz.tmp" -C /srv/rbola-staging data
  mv "$B/$DAY/staging-data.tar.gz.tmp" "$B/$DAY/staging-data.tar.gz"
fi
tar -czf "$B/secrets/secrets-$DAY.tar.gz.tmp" -C /srv/rbola keys env
mv "$B/secrets/secrets-$DAY.tar.gz.tmp" "$B/secrets/secrets-$DAY.tar.gz"
chmod 600 "$B/$DAY"/*.tar.gz "$B/secrets"/*.tar.gz

# retention
find "$B" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' -mtime +$((KEEP_DAYS - 1)) -exec rm -rf {} +
find "$B/secrets" -maxdepth 1 -type f -name 'secrets-*.tar.gz' -mtime +$((KEEP_DAYS - 1)) -delete

echo "$(date -Is) backup ok: $(du -sh "$B/$DAY" | cut -f1) in $B/$DAY"
