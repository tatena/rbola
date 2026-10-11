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

# users + layout (see deploy.sh header for the full permission model)
# prod = /srv/rbola (port 3000, unit rbola, user rbola, mainnet); staging =
# /srv/rbola-staging (port 3001, unit rbola-staging, devnet, user rbola-staging
# — its own user, so staging can never read the mainnet keys or env).
# rbola-build runs npm ci + next build and can read neither keys, env nor data.
for U in rbola rbola-staging; do
  id $U >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin $U
done
id rbola-build >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/rbola-build \
  --create-home --shell /usr/sbin/nologin rbola-build
chmod 700 /var/lib/rbola-build
for ROOT in /srv/rbola /srv/rbola-staging; do
  U=$(basename $ROOT)
  mkdir -p $ROOT/{data/catches,data/state,keys}
  chown root:root $ROOT && chmod 711 $ROOT            # traverse only; runtime can't swap current/
  chown -R $U:$U $ROOT/data $ROOT/keys && chmod 700 $ROOT/data $ROOT/keys
  install -d -m 711 -o root -g root $ROOT/releases    # filled by deploy.sh
done
# env files (secrets) are created by hand: $ROOT/env, mode 600, owned by that
# root's user — after editing as root, chown it back or the app can't read it.
# staging env must point DATA_DIR/*_KEYPAIR_PATH into /srv/rbola-staging and set
# PORT=3001 SOLANA_CLUSTER=devnet NEXT_PUBLIC_SOLANA_CLUSTER=devnet

# backups (root-only)
mkdir -p /srv/backups/secrets /srv/backups/ledger && chmod 700 /srv/backups /srv/backups/secrets /srv/backups/ledger

# monitor config (root-only): mainnet-live flag enables balance checks; alert.env
# (TELEGRAM_BOT_TOKEN=/TELEGRAM_CHAT_ID=, parsed not sourced) is created by hand
install -d -m 700 -o root -g root /etc/rbola

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DEPLOY_DIR/rbola.service" ]; then
  install -m 644 "$DEPLOY_DIR/rbola.service" "$DEPLOY_DIR/rbola-staging.service" /etc/systemd/system/
  install -m 644 "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile
  install -m 755 "$DEPLOY_DIR/backup.sh" /usr/local/bin/rbola-backup
  install -m 755 "$DEPLOY_DIR/monitor.sh" /usr/local/bin/rbola-monitor
  install -m 644 "$DEPLOY_DIR/logrotate-rbola" /etc/logrotate.d/rbola
  # Caddyfile has `admin off`, so `systemctl reload caddy` can't work — always restart
  systemctl daemon-reload && systemctl enable rbola rbola-staging && systemctl restart caddy
  cat > /etc/cron.d/rbola <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root /usr/local/bin/rbola-backup >> /var/log/rbola-backup.log 2>&1
7 * * * * root /usr/local/bin/rbola-backup ledger >> /var/log/rbola-backup.log 2>&1
*/5 * * * * root /usr/local/bin/rbola-monitor
CRON
  chmod 644 /etc/cron.d/rbola
fi

# SSH: keys only, no forwarding; rate-limited + fail2ban (default sshd jail)
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
MaxAuthTries 3
LoginGraceTime 30
SSHD
sshd -t && systemctl reload ssh
apt-get install -y fail2ban
# security updates on, but never auto-reboot (reboots are manual)
echo 'Unattended-Upgrade::Automatic-Reboot "false";' > /etc/apt/apt.conf.d/52rbola-no-reboot

ufw limit OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
echo "provisioned"
