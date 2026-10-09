#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 box (Hetzner CX22). Run as root.
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
mkdir -p /srv/rbola/{app,data/catches,data/state,keys}
chown -R rbola:rbola /srv/rbola
chmod 700 /srv/rbola/keys

ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
echo "provisioned"
