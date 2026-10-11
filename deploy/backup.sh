#!/usr/bin/env bash
# Nightly backup (cron 03:30, installed as /usr/local/bin/rbola-backup). Runs on the server as root.
#  - /srv/backups/YYYY-MM-DD/{prod,staging}-data.tar.gz   app data only (no keys, no env)
#  - /srv/backups/secrets/secrets-YYYY-MM-DD.tar.gz      prod keys + env, root-only
# Keeps 14 days of each. Local to this server only — no off-server copy yet.
set -euo pipefail
umask 077
B=/srv/backups
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
