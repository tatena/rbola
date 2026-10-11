#!/usr/bin/env bash
# Health monitor (cron */5, installed as /usr/local/bin/rbola-monitor). Runs on the server as root.
# Checks: systemd units, public HTTP, and (once /srv/rbola/mainnet-live exists) mainnet SOL balances.
# Always logs to /var/log/rbola-monitor.log. Alerts via Telegram if /srv/rbola/alert.env defines
# TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID — only when the failure set changes (no 5-min spam),
# plus a recovery message.
set -uo pipefail
LOG=/var/log/rbola-monitor.log
STATE=/var/lib/rbola-monitor.last
RPC=${RPC:-https://api.mainnet-beta.solana.com}
URL=https://app.rbola.fun/
# public addresses only (no secrets): mainnet payer + race wallets
PAYER=9cFma7rbA9Sztu4vyxeSNvrPKA6MUpioZhmNHFS2Fvrp
RACE=8CPRLVdGJixiyQw7eFDvhZyAsgxr3ZaGB6dZVf8G2vNT
PAYER_MIN=20000000   # 0.02 SOL in lamports
RACE_MIN=10000000    # 0.01 SOL

fails=()
for u in rbola rbola-staging; do
  s=$(systemctl is-active "$u" 2>/dev/null); [ "$s" = active ] || fails+=("unit $u is $s")
done

code=$(curl -sL -o /dev/null -m 20 -w '%{http_code}' "$URL" || echo 000)
[ "$code" = 200 ] || fails+=("$URL -> HTTP $code")

balance() { # prints lamports or empty
  curl -s -m 20 -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$1\"]}" "$RPC" \
    | grep -o '"value":[0-9]*' | head -1 | cut -d: -f2
}
if [ -f /srv/rbola/mainnet-live ]; then
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

prev=$(cat "$STATE" 2>/dev/null || echo OK)
if [ "$summary" != "$prev" ] && [ -f /srv/rbola/alert.env ]; then
  # shellcheck disable=SC1091
  . /srv/rbola/alert.env
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    if [ "$summary" = OK ]; then msg="RBOLA recovered: all checks OK"; else msg="RBOLA ALERT: $summary"; fi
    curl -s -m 20 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$msg" \
      || echo "$now telegram send failed" >> "$LOG"
  fi
fi
echo "$summary" > "$STATE"
