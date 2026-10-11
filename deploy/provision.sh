#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 box (Hetzner CX22). Run as root,
# from a copy of deploy/ on the box (e.g. scp -r deploy root@<ip>:/root/) so units/Caddyfile/cron get installed.
set -euo pipefail

apt-get update -y && apt-get upgrade -y
apt-get install -y curl rsync ufw gnupg

# Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Caddy (automatic HTTPS) — from the Ubuntu archive
apt-get install -y caddy

# 2 GB swap — headroom for next build on 4 GB RAM
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# app user + layout: app/ is replaced on deploy; data/ and keys/ never are
id rbola >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin rbola
# prod = /srv/rbola (port 3000, unit rbola); staging = /srv/rbola-staging (port 3001, unit rbola-staging, devnet)
for ROOT in /srv/rbola /srv/rbola-staging; do
  mkdir -p $ROOT/{app,data/catches,data/state,keys}
  chown -R rbola:rbola $ROOT
  chmod 700 $ROOT/keys
done
# env files (secrets) are created by hand: $ROOT/env, mode 600, owner rbola.
# staging env must point DATA_DIR/*_KEYPAIR_PATH into /srv/rbola-staging and set
# PORT=3001 SOLANA_CLUSTER=devnet NEXT_PUBLIC_SOLANA_CLUSTER=devnet

# backups (root-only)
mkdir -p /srv/backups/secrets && chmod 700 /srv/backups /srv/backups/secrets

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DEPLOY_DIR/rbola.service" ]; then
  install -m 644 "$DEPLOY_DIR/rbola.service" "$DEPLOY_DIR/rbola-staging.service" /etc/systemd/system/
  install -m 644 "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile
  install -m 755 "$DEPLOY_DIR/backup.sh" /usr/local/bin/rbola-backup
  install -m 755 "$DEPLOY_DIR/monitor.sh" /usr/local/bin/rbola-monitor
  systemctl daemon-reload && systemctl enable rbola rbola-staging && systemctl reload caddy
  cat > /etc/cron.d/rbola <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root /usr/local/bin/rbola-backup >> /var/log/rbola-backup.log 2>&1
*/5 * * * * root /usr/local/bin/rbola-monitor
CRON
  chmod 644 /etc/cron.d/rbola
fi

ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
echo "provisioned"
