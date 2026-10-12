#!/usr/bin/env bash
# Health monitor (cron */5, installed as /usr/local/bin/rbola-monitor). Runs on the server as root.
# Checks: systemd units, public HTTP (prod + staging), app /api/health, disk usage, backup age,
# TLS cert expiry, and (once /etc/rbola/mainnet-live exists) mainnet SOL balances.
# Config lives in /etc/rbola (root:root 700) — never under an app user's tree, so a compromised
# app can't flip checks off or inject shell into this root script.
# Always logs to /var/log/rbola-monitor.log. Alerts via Telegram if /etc/rbola/alert.env defines
# TELEGRAM_BOT_TOKEN= and TELEGRAM_CHAT_ID= (plain KEY=value lines; parsed, never sourced) —
# only when the failure set changes (no 5-min spam), plus a recovery message.
set -uo pipefail
CONF=/etc/rbola
LOG=/var/log/rbola-monitor.log
STATE=/var/lib/rbola-monitor.last
RPC=${RPC:-https://api.mainnet-beta.solana.com}
URL=https://app.rbola.fun/
STAGING_URL=https://staging.rbola.fun/
HEALTH=https://app.rbola.fun/api/health
TLS_HOST=app.rbola.fun
DISK_MAX=85          # % used on /
BACKUP_MAX_H=48      # newest nightly backup must be younger than this
CERT_MIN_DAYS=14
# public addresses only (no secrets): mainnet payer + race wallets
PAYER=9cFma7rbA9Sztu4vyxeSNvrPKA6MUpioZhmNHFS2Fvrp
RACE=8CPRLVdGJixiyQw7eFDvhZyAsgxr3ZaGB6dZVf8G2vNT
PAYER_MIN=20000000   # 0.02 SOL in lamports
RACE_MIN=10000000    # 0.01 SOL

fails=()
for u in rbola rbola-staging caddy; do
  s=$(systemctl is-active "$u" 2>/dev/null); [ "$s" = active ] || fails+=("unit $u is $s")
done

for u in "$URL" "$STAGING_URL"; do
  code=$(curl -sL -o /dev/null -m 20 -w '%{http_code}' "$u" || echo 000)
  [ "$code" = 200 ] || fails+=("$u -> HTTP $code")
done

# app self-check: 404 = endpoint not deployed yet (ignored)
body=$(curl -s -m 20 -w '\n%{http_code}' "$HEALTH" || printf '\n000')
hcode=${body##*$'\n'}; hbody=${body%$'\n'*}
if [ "${hcode:0:1}" = 5 ] || [ "$hcode" = 000 ]; then fails+=("health -> HTTP $hcode")
elif printf '%s' "$hbody" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*false'; then
  fails+=("health ok:false")
fi

disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "${disk:-0}" -le "$DISK_MAX" ] || fails+=("disk / ${disk}% used")

newest=$(find /srv/backups -mindepth 2 -maxdepth 2 -path '/srv/backups/20??-??-??/prod-data.tar.gz' -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
if [ -z "$newest" ]; then fails+=("no nightly backup found")
elif [ $(( $(date +%s) - ${newest%.*} )) -gt $((BACKUP_MAX_H * 3600)) ]; then
  fails+=("newest backup older than ${BACKUP_MAX_H}h")
fi

notafter=$(echo | timeout 20 openssl s_client -connect "$TLS_HOST:443" -servername "$TLS_HOST" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -z "$notafter" ]; then fails+=("TLS cert check failed")
else
  days=$(( ($(date -d "$notafter" +%s) - $(date +%s)) / 86400 ))
  [ "$days" -ge "$CERT_MIN_DAYS" ] || fails+=("TLS cert expires in ${days}d")
fi

balance() { # prints lamports or empty
  curl -s -m 20 -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$1\"]}" "$RPC" \
    | grep -o '"value":[0-9]*' | head -1 | cut -d: -f2
}
if [ -f "$CONF/mainnet-live" ]; then
  for pair in "payer $PAYER $PAYER_MIN" "race $RACE $RACE_MIN"; do
    set -- $pair
    lam=$(balance "$2")
    if [ -z "$lam" ]; then fails+=("$1 balance: RPC error")
    elif [ "$lam" -lt "$3" ]; then
      fails+=("$1 wallet $2 low: $(awk "BEGIN{printf \"%.4f\", $lam/1e9}") SOL")
    fi
  done
fi

now=$(date -Is)
if [ ${#fails[@]} -eq 0 ]; then summary=OK; else summary=$(IFS='; '; echo "${fails[*]}"); fi
echo "$now $summary" >> "$LOG"

conf_get() { # KEY -> value of the last KEY=... line, optional quotes stripped
  sed -n "s/^[[:space:]]*$1=[\"']\{0,1\}\([^\"']*\)[\"']\{0,1\}[[:space:]]*$/\1/p" "$CONF/alert.env" | tail -1
}
prev=$(cat "$STATE" 2>/dev/null || echo OK)
if [ "$summary" != "$prev" ] && [ -f "$CONF/alert.env" ]; then
  TOKEN=$(conf_get TELEGRAM_BOT_TOKEN); CHAT=$(conf_get TELEGRAM_CHAT_ID)
  if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
    if [ "$summary" = OK ]; then msg="RBOLA recovered: all checks OK"; else msg="RBOLA ALERT: $summary"; fi
    curl -s -m 20 -o /dev/null "https://api.telegram.org/bot${TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${CHAT}" --data-urlencode "text=$msg" \
      || echo "$now telegram send failed" >> "$LOG"
  fi
fi
echo "$summary" > "$STATE"
