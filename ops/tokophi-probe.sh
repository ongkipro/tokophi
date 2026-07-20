#!/usr/bin/env bash
# TokoΦ L2 external probe — the WITNESS. See specs/docs/BACKLOG.md (P1.8) + specs/docs/DEPLOY.md.
#
# ⚠️ THIS MUST NOT RUN ON THE VPS. A watchdog on a dead box is worthless — on 2026-07-18 the box
# itself was the thing that failed (disk 100% → Postgres crash-loop → the SSR storefront 503'd for
# ~2 HOURS while its container cheerfully reported `Up (unhealthy)`). Run it from a laptop, a
# second cheap VPS, or any machine with `curl` + `ssh` access. Everything is env-driven.
#
# WHAT L1 CANNOT SEE (and why this exists):
#   L1 (`ops/tokophi-watchdog.sh`) restarts containers in `created`/`exited`. It deliberately leaves
#   `running` alone. Failure shape #4 was a container that was RUNNING and UNHEALTHY — L1 structurally
#   cannot heal it and never even logs it. L1b (`ops/tokophi-docker-cleanup.sh`) shipped the broom for
#   the disk; nothing shipped the witness. This is the witness.
#
# THE FOUR CHECKS, each aimed at an observed failure shape:
#   1. HTTP on the 5 public surfaces          → shapes #1, #2 (site down / stale-failed deploy)
#   2. POST /api/public/ongkir {op:"search"}  → shapes #3, #4 (a 200 from a container whose DB is gone)
#   3. Disk % + free GB over ssh              → shape #4, BEFORE it becomes an outage
#   4. L1 watchdog heartbeat freshness        → "who watches the watchdog"
#
# USAGE
#   ops/tokophi-probe.sh                # one pass; exit 0 = all healthy, 1 = something is failing
#   TOKOPHI_PROBE_SKIP_SSH=1 ops/tokophi-probe.sh    # HTTP-only (no ssh key on this machine)
# Install (on the OFF-BOX machine, NOT the VPS) — every 5 minutes:
#   */5 * * * * /usr/local/bin/tokophi-probe.sh >> /var/log/tokophi-probe.log 2>&1
#
set -uo pipefail

# ---------------------------------------------------------------------------- config (all via env)
SSH_TARGET="${TOKOPHI_SSH_TARGET:-root@45.77.33.112}"
SSH_KEY="${TOKOPHI_SSH_KEY:-$HOME/.ssh/tokophi_dev}"
STATE_DIR="${TOKOPHI_PROBE_STATE:-${XDG_CACHE_HOME:-$HOME/.cache}/tokophi-probe}"
CURL_TIMEOUT="${TOKOPHI_PROBE_TIMEOUT:-15}"

# ── Threshold: consecutive failures before we page a human ──────────────────────────────────────
# A PROBE THAT CRIES WOLF GETS IGNORED. This repo has already lived the alternative: `verify-rls`
# was red for weeks, everybody learned to scroll past it, and two real tenant leaks shipped straight
# through an alarm that was technically on. An alarm that is always on is an alarm that is off.
#
# 3 consecutive failures × a 5-minute cron = ~15 minutes of SUSTAINED failure before anyone is woken.
# That is deliberate and it is cheap: the outage we are defending against lasted 2 HOURS, so 15
# minutes of latency costs ~12% of the detection win and buys immunity to the routine blips —
# a Coolify container swap mid-deploy, a Cloudflare hiccup, a flaky hotel wifi on the probing
# machine. Every single failing pass still prints to stdout immediately; only the PAGE is delayed.
FAIL_THRESHOLD="${TOKOPHI_PROBE_FAIL_THRESHOLD:-3}"

# ── Threshold: disk ─────────────────────────────────────────────────────────────────────────────
# This is the actual leading indicator of the 2026-07-18 outage and NOTHING currently watches it.
# Two thresholds, because percent alone lies on a big disk and free-space alone lies on a small one:
#
#   DISK_PCT_MAX=80   — the same number `tokophi-docker-cleanup.sh` uses to switch into aggressive
#                       pruning. Crossing it means the daily broom has already gone to its strongest
#                       setting and the disk is STILL filling: the safety-net is losing, which is
#                       exactly the moment a human should hear about it — not at 95%, when there is
#                       no room left to even build the fix.
#   DISK_FREE_MIN_GB=15 — a deploy BUILDS on this box, and the images are ~1.7 GB each (DEPLOY.md
#                       gotcha #8) before build cache. Under ~15 GB there is not room for one clean
#                       deploy, so the box has quietly lost the ability to ship its own repair. Note
#                       what happened last time: with the disk full you cannot redeploy your way out,
#                       because a redeploy needs the disk it does not have.
#
# Both are advisory-early on purpose: at 100% Postgres PANICs mid-checkpoint and every surface that
# reads it 503s. We want to be shouting long before that line.
DISK_PCT_MAX="${TOKOPHI_PROBE_DISK_PCT:-80}"
DISK_FREE_MIN_GB="${TOKOPHI_PROBE_DISK_FREE_GB:-15}"

# ── Threshold: L1 heartbeat staleness ───────────────────────────────────────────────────────────
# `ops/tokophi-watchdog.sh` rewrites /var/run/tokophi-watchdog.last EVERY minute, healing or not.
# 10 minutes = 10 missed cron ticks: no longer a blip, either cron is dead or the box is.
HEARTBEAT_MAX_AGE_S="${TOKOPHI_PROBE_HEARTBEAT_AGE:-600}"

# ── The 5 public surfaces (confirmed against DEPLOY.md, not from memory) ─────────────────────────
# `rich.tokophi.com` answers 307 — the super-admin middleware redirects an anonymous visitor to
# /login. That is CORRECT BEHAVIOUR, not a failure; a probe that demanded 200 there would be red
# forever and would train everyone to ignore it. Format: "<url>|<accepted codes, pipe-separated>".
SURFACES=(
  "https://tokophi.com|200"                       # landing (apex, static Astro)
  "https://app.tokophi.com/login|200"             # Seller — merchant panel
  "https://rich.tokophi.com|307|200"              # Super Admin — 307 → /login is HEALTHY
  "https://toko.tokophi.com|200"                  # demo storefront (reserved label)
  "https://batik-nusantara.tokophi.id|200"        # per-merchant storefront (canonical .id)
)

# The DB-touching probe. `op:"search"` needs NO storeSlug — only `op:"rates"` was made fatal on a
# missing slug by 7cc1ecc, and mimicking `rates` here would 400 on tenant resolution and be misread
# as "down". `op:"search"` runs resolveArea() → an ILIKE over `kiriminaja_areas` (7.030 rows). If
# Postgres is gone the query throws, the route's wrapper returns 500, and we see it. THIS IS THE
# WHOLE POINT: a container can be `healthy` and serve a static 200 while the database behind it is
# in recovery — that is precisely what 503'd the storefront for two hours.
DB_PROBE_URL="${TOKOPHI_PROBE_DB_URL:-https://app.tokophi.com/api/public/ongkir}"
DB_PROBE_BODY='{"op":"search","q":"Semarang"}'

# ---------------------------------------------------------------------------- plumbing
mkdir -p "$STATE_DIR" 2>/dev/null || true
TS() { date -u '+%FT%TZ'; }
say() { printf '%s %s\n' "$(TS)" "$1"; }

ALERTS=()      # human-readable lines for checks that have crossed FAIL_THRESHOLD this pass
CONTEXT=()     # diagnostic lines attached to any alert (never alert on their own)
EXIT=0

# notify() — ⚠️ STUB. THE ALERT CHANNEL IS AN UNMADE DECISION (BACKLOG P1.8: "Blocked on ONE
# decision from the user: where do alerts go?"). Do NOT hard-code Telegram or SMTP here; pick one,
# uncomment it, and set the env on the machine that runs the cron.
#
# Config comes from the ENVIRONMENT — e.g. `~/.config/ai-local/secrets.env`, sourced by the cron
# wrapper. NEVER commit a bot token, an app password, or a chat id to this repo.
#
# Until a channel is chosen this function prints and returns success, so the probe is already useful
# (`>> /var/log/tokophi-probe.log`) — it just cannot wake anybody.
notify() {
  local subject="$1" body="$2"
  printf '\n=== ALERT: %s ===\n%s\n=================\n' "$subject" "$body"

  case "${TOKOPHI_ALERT_CHANNEL:-none}" in
    telegram)
      # OPTION A — Telegram. Fastest path to a phone; a @BotFather bot, no mail server, no
      # deliverability roulette. Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
      # curl -sS --max-time 10 \
      #   "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      #   --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      #   --data-urlencode "text=[TokoΦ] ${subject}
      # ${body}" >/dev/null
      say "NOTE notify: channel=telegram selected but the call is still commented out"
      ;;
    smtp)
      # OPTION B — email/SMTP. Survives a Telegram outage and leaves a searchable record, but is
      # slower to a phone and can land in spam. Needs ALERT_EMAIL_TO + a working `mail`/`msmtp`
      # (msmtp reads its own ~/.msmtprc — do not put the password here).
      # printf 'Subject: [TokoΦ] %s\n\n%s\n' "$subject" "$body" | msmtp "${ALERT_EMAIL_TO}"
      say "NOTE notify: channel=smtp selected but the call is still commented out"
      ;;
    none|*)
      say "NOTE notify: no alert channel configured (TOKOPHI_ALERT_CHANNEL unset) — stdout only"
      ;;
  esac
}

# record <key> <ok|fail> <message>
# Per-check consecutive-failure counter in its own state file, so a recovering HTTP surface never
# resets the disk trend (and vice versa). Alerts fire on the EXACT pass that reaches the threshold,
# not on every pass after it — a repeating page is a page you mute.
record() {
  local key="$1" status="$2" msg="$3"
  # ⚠️ `f` MUST be assigned on its own line. `local key="$1" f="$STATE_DIR/$key"` looks right and is
  # not: bash expands every argument BEFORE the `local` builtin runs, so `$key` there is the value
  # from the enclosing scope — i.e. the PREVIOUS check's key. Every check then read and wrote its
  # neighbour's counter: nothing ever reached the threshold, and an OK check deleted someone else's
  # failure history. Found only by running it against a dead port four times in a row; `bash -n`,
  # and a single green pass against production, both said it was fine.
  local f="$STATE_DIR/$key" n=0
  [ -f "$f" ] && n="$(cat "$f" 2>/dev/null || echo 0)"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac

  if [ "$status" = "ok" ]; then
    say "OK   $key — $msg"
    if [ "$n" -ge "$FAIL_THRESHOLD" ]; then
      # It had already paged. Say so explicitly: silence after an alert is indistinguishable from
      # a probe that died, and the person who was woken deserves to know it is over.
      ALERTS+=("RECOVERED $key — $msg (was failing $n consecutive passes)")
    fi
    rm -f "$f" 2>/dev/null || true
    return 0
  fi

  n=$((n + 1))
  printf '%s' "$n" > "$f" 2>/dev/null || true
  EXIT=1
  say "FAIL $key ($n/$FAIL_THRESHOLD) — $msg"
  if [ "$n" -eq "$FAIL_THRESHOLD" ]; then
    ALERTS+=("$key — $msg (failed $n consecutive passes)")
  fi
  return 1
}

# ---------------------------------------------------------------------------- 1. public surfaces
say "--- probe start (threshold: ${FAIL_THRESHOLD} consecutive, disk ${DISK_PCT_MAX}% / ${DISK_FREE_MIN_GB}GB)"

for entry in "${SURFACES[@]}"; do
  url="${entry%%|*}"
  accepted="${entry#*|}"                      # e.g. "307|200"
  key="http_$(printf '%s' "$url" | tr -c 'a-zA-Z0-9' '_')"
  # -o /dev/null: we only judge the status line. No -L: a redirect is data, not something to follow
  # (following would hide the 307 that proves the super-admin middleware is alive).
  # No `|| echo 000` fallback: curl ALREADY prints `000` for a connection it never made, so the
  # fallback concatenated onto it and reported the memorable non-status `000000`.
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$url" 2>/dev/null)"
  code="${code:-000}"
  if printf '%s' "|$accepted|" | grep -qF "|$code|"; then
    record "$key" ok "$url → $code"
  else
    record "$key" fail "$url → $code (expected $accepted)"
  fi
done

# ---------------------------------------------------------------------------- 2. Postgres, for real
# Judged on the BODY, not the status code. The route answers 200 with {ok:false,"Shipping belum
# dikonfigurasi."} when KIRIMINAJA_API_KEY is unset — a 200 that means "misconfigured", which is
# still worth knowing about but is NOT the same emergency as "the database is gone". Both are
# failures here; the message distinguishes them so whoever is paged knows which runbook to open.
db_body="$(curl -sS --max-time "$CURL_TIMEOUT" -X POST "$DB_PROBE_URL" \
  -H 'Content-Type: application/json' -d "$DB_PROBE_BODY" 2>/dev/null || true)"
db_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" -X POST "$DB_PROBE_URL" \
  -H 'Content-Type: application/json' -d "$DB_PROBE_BODY" 2>/dev/null)"
db_code="${db_code:-000}"

if [ "$db_code" != "200" ]; then
  # A 500 here is the signature of shape #3/#4: the app is answering, the query is not.
  record db_ongkir fail "POST /api/public/ongkir op=search → HTTP $db_code — the app answered but the QUERY did not (check: ssh <box> 'df -h /' + docker logs postgres)"
elif printf '%s' "$db_body" | grep -q '"ok":true' && printf '%s' "$db_body" | grep -q '"id"'; then
  record db_ongkir ok "POST /api/public/ongkir op=search → 200 with rows (kiriminaja_areas is readable)"
elif printf '%s' "$db_body" | grep -q 'belum dikonfigurasi'; then
  record db_ongkir fail "shipping not configured (KIRIMINAJA_API_KEY unset) — the DB was never reached, so this proves NOTHING about Postgres"
else
  record db_ongkir fail "POST /api/public/ongkir op=search → 200 but no rows: $(printf '%s' "$db_body" | head -c 200)"
fi

# ---------------------------------------------------------------------------- 3+4. disk + heartbeat
if [ "${TOKOPHI_PROBE_SKIP_SSH:-0}" = "1" ]; then
  say "SKIP ssh checks (TOKOPHI_PROBE_SKIP_SSH=1) — disk and L1 heartbeat are NOT being watched"
else
  # ONE ssh round-trip for everything. `unhealthy` is collected as CONTEXT only — it never raises an
  # alert by itself (a container can be briefly unhealthy during a deploy), but when something else
  # is already red it is usually the line that tells you which thing broke.
  remote="$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
    "$SSH_TARGET" '
      df -P / | awk "NR==2{gsub(\"%\",\"\",\$5); print \"DISK_PCT \" \$5 \"\nDISK_AVAIL_KB \" \$4}"
      echo "HB_AGE $(( $(date +%s) - $(stat -c %Y /var/run/tokophi-watchdog.last 2>/dev/null || echo 0) ))"
      echo "UNHEALTHY $(docker ps --filter health=unhealthy --format "{{.Names}}" 2>/dev/null | tr "\n" "," )"
    ' 2>/dev/null || true)"

  if [ -z "$remote" ]; then
    # ssh itself failing is a first-class signal: the box may be gone, or the key/route may be. It
    # gets its own counter so a laptop that closed its lid does not look like a dead server forever.
    record ssh fail "ssh $SSH_TARGET unreachable (box down? key missing? network?) — disk + heartbeat UNKNOWN"
  else
    record ssh ok "ssh $SSH_TARGET reachable"

    pct="$(printf '%s\n' "$remote" | awk '/^DISK_PCT/{print $2}')"
    avail_kb="$(printf '%s\n' "$remote" | awk '/^DISK_AVAIL_KB/{print $2}')"
    hb_age="$(printf '%s\n' "$remote" | awk '/^HB_AGE/{print $2}')"
    unhealthy="$(printf '%s\n' "$remote" | sed -n 's/^UNHEALTHY //p' | tr -d ',')"

    avail_gb=$(( ${avail_kb:-0} / 1024 / 1024 ))
    if [ -n "${pct:-}" ] && { [ "$pct" -ge "$DISK_PCT_MAX" ] || [ "$avail_gb" -lt "$DISK_FREE_MIN_GB" ]; }; then
      record disk fail "root filesystem ${pct}% used, ${avail_gb}GB free (limits: ${DISK_PCT_MAX}% / ${DISK_FREE_MIN_GB}GB). THIS IS THE 2026-07-18 OUTAGE STARTING. Run /usr/local/bin/tokophi-docker-cleanup.sh; do NOT redeploy — a build needs the disk it does not have."
    elif [ -n "${pct:-}" ]; then
      record disk ok "root filesystem ${pct}% used, ${avail_gb}GB free"
    else
      record disk fail "could not read df output from the box"
    fi

    if [ -n "${hb_age:-}" ] && [ "$hb_age" -gt 0 ] && [ "$hb_age" -le "$HEARTBEAT_MAX_AGE_S" ]; then
      record watchdog ok "L1 heartbeat ${hb_age}s old"
    else
      record watchdog fail "L1 heartbeat is ${hb_age:-?}s old (max ${HEARTBEAT_MAX_AGE_S}s) — /etc/cron.d/tokophi-watchdog may be gone; self-healing is OFF"
    fi

    if [ -n "$unhealthy" ]; then
      # Shape #4 in one line. Context, not an alert — see the comment above.
      CONTEXT+=("unhealthy containers on the box: $unhealthy")
      say "NOTE unhealthy containers: $unhealthy"
    fi
  fi
fi

# ---------------------------------------------------------------------------- alert
if [ "${#ALERTS[@]}" -gt 0 ]; then
  body="$(printf '%s\n' "${ALERTS[@]}")"
  [ "${#CONTEXT[@]}" -gt 0 ] && body="$body

context:
$(printf '  %s\n' "${CONTEXT[@]}")"
  notify "$( [ "$EXIT" -eq 0 ] && echo recovered || echo "$(TS) production check failed" )" "$body"
fi

say "--- probe end (exit $EXIT)"
exit "$EXIT"
