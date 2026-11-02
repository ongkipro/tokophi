#!/usr/bin/env bash
# TokoΦ L1 self-healing watchdog — see specs/docs/BACKLOG.md (P1.8) + specs/docs/DEPLOY.md.
#
# Installed on the production VPS as /usr/local/bin/tokophi-watchdog.sh, run every minute from
# /etc/cron.d/tokophi-watchdog. It needs NO credentials and touches NO network — it only reads
# `docker ps` and, when needed, runs `docker start`.
#
# WHY IT EXISTS: on 2026-07-14 production went down and the site 503'd because Coolify BUILT the app
# containers, left them in state `created`, and moved on — nothing started them, and nothing told us.
# The recovery was a plain `docker start`. This is that recovery, on a timer, so it happens with no
# human awake. (`landing` stayed up that day because it has no deps — that design held; this covers the
# other three, and landing too.)
#
# DELIBERATELY NARROW — it does exactly one safe thing:
#  - Only the 5 always-on app services (admin, super-admin, storefront, landing, docs). It NEVER touches
#    postgres / backup / coolify / cron, and NEVER `migrate` — migrate is SUPPOSED to sit at
#    `exited (0)` after it applies migrations, and starting it would re-run them.
#  - Only acts on `created` / `exited`. A `running` container (even an unhealthy one) or a `restarting`
#    crash-loop is LEFT ALONE — restarting a live container is a different, riskier decision that belongs
#    to L2 (external probe) / L3 (deploy-failure alarm), not here.
#
# Container names: on the dedicated host (since 2026-11-01) `<service>-<APP_UUID>` exactly; on the old
# `volumdev` host `<service>-<APP_UUID>-<hash>` (the hash changed every deploy). The match accepts both,
# anchored on `^<service>-<APP_UUID>` so `admin` can never match `super-admin`. A container compose is
# REPLACING is renamed `<id>_<name>` during the swap, so it never matches either.
set -euo pipefail

APP_UUID="${TOKOPHI_APP_UUID:-qbd85i0yfaugxctv8pb15djw}"  # Coolify resource UUID — stable across deploys
SERVICES="admin super-admin storefront landing docs"
LOG="${TOKOPHI_WATCHDOG_LOG:-/var/log/tokophi-watchdog.log}"
HEARTBEAT="${TOKOPHI_WATCHDOG_HEARTBEAT:-/var/run/tokophi-watchdog.last}"
DOCKER="${DOCKER:-/usr/bin/docker}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" >> "$LOG"; }

# A Coolify deploy runs in a `coolify-helper` container. While one is up, containers are being stopped
# and replaced ON PURPOSE — starting one in the middle of that fights the deploy. Skip the run (the
# heartbeat below still ticks, so this is not mistaken for a dead watchdog).
if "$DOCKER" ps --format '{{.Image}}' 2>/dev/null | grep -q 'coolify-helper'; then
  date '+%Y-%m-%dT%H:%M:%S%z' > "$HEARTBEAT" 2>/dev/null || true
  exit 0
fi

for svc in $SERVICES; do
  # Anchored on `^${svc}-${APP_UUID}-` so `admin` can never match `super-admin`.
  line="$("$DOCKER" ps -a --format '{{.Names}}'$'\t''{{.State}}' 2>/dev/null \
          | grep -E "^${svc}-${APP_UUID}(-[^[:space:]]*)?"$'\t' | head -1 || true)"
  if [ -z "$line" ]; then
    log "WARN ${svc}: no container found (deploy in progress, or renamed?)"
    continue
  fi
  name="${line%%$'\t'*}"
  state="${line##*$'\t'}"
  case "$state" in
    created|exited)
      if "$DOCKER" start "$name" >/dev/null 2>&1; then
        log "HEAL ${svc}: was '${state}' -> started ${name}"
      else
        log "FAIL ${svc}: '${state}', 'docker start ${name}' failed"
      fi
      ;;
    running) : ;;                                   # healthy — stay quiet (no log spam)
    *) log "NOTE ${svc}: state='${state}' (left for L2/L3)" ;;
  esac
done

# Heartbeat: an observable "the watchdog ran" signal, updated EVERY minute even when it heals nothing
# (the log stays quiet on a healthy box, so it cannot prove the cron is alive — this file can). L2 / a
# human can read its mtime: if it is stale by minutes, the watchdog itself is down.
date '+%Y-%m-%dT%H:%M:%S%z' > "$HEARTBEAT" 2>/dev/null || true

# The cron writes forever; keep the log bounded. Trim only when it grows past ~5000 lines.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 3000 "$LOG" > "${LOG}.tmp" 2>/dev/null && mv "${LOG}.tmp" "$LOG"
fi
