#!/usr/bin/env bash
# Safety-net against Coolify's per-deploy image churn filling the disk.
#
# On 2026-07-18 the disk hit 100% (204 per-deploy images / ~129 GB), which put
# Postgres into an end-of-recovery checkpoint crash-loop. On 2026-08-05, 17
# main-branch commits created 90 TokoPhi images in nine hours and grew the disk
# from 15% to 74%. A daily age-only sweep is not fast enough for that shape.
#
# This removes ONLY build cache and UNUSED images. It NEVER passes --volumes,
# so Postgres, uploads, and backups are outside its deletion scope. Install and
# recovery details live in DEPLOY.md, "L1b disk-cleanup safety-net".
set -euo pipefail

LOG="${TOKOPHI_CLEANUP_LOG:-/var/log/tokophi-docker-cleanup.log}"
LOCK="${TOKOPHI_CLEANUP_LOCK:-/var/lock/tokophi-docker-cleanup.lock}"
AGGRESSIVE_PCT="${TOKOPHI_CLEANUP_AGGRESSIVE_PCT:-70}"
MIN_FREE_GB="${TOKOPHI_CLEANUP_MIN_FREE_GB:-25}"

# Cron and a manual recovery must never prune concurrently.
exec 9>"$LOCK"
if ! flock -n 9; then
  printf '%s\n' "=== $(date -u +%FT%TZ) skipped: cleanup already running ===" >> "$LOG"
  exit 0
fi

disk_used_pct() {
  df -P / | awk 'NR==2 { gsub("%", "", $5); print $5 }'
}

disk_free_gb() {
  df -Pk / | awk 'NR==2 { print int($4 / 1024 / 1024) }'
}

under_pressure() {
  local used free
  used="$(disk_used_pct)"
  free="$(disk_free_gb)"
  [ "$used" -ge "$AGGRESSIVE_PCT" ] || [ "$free" -lt "$MIN_FREE_GB" ]
}

{
  echo "=== $(date -u +%FT%TZ) cleanup ==="
  df -h / | tail -1

  if under_pressure; then
    echo "pressure: pruning all unused build cache"
    docker builder prune -af 2>&1 | tail -1

    # Cache is disposable; rollback images are not. Delete the latter only if
    # reclaiming cache did not restore enough headroom.
    if under_pressure; then
      echo "pressure persists: pruning all unused images"
      docker image prune -af 2>&1 | tail -1
    else
      echo "pressure cleared: retained unused rollback images"
    fi
  else
    # Hourly sweep, deliberately asymmetric: cache is cheap to rebuild, while
    # 48 hours of unused images preserves a short local rollback window.
    docker builder prune -af --filter 'until=24h' 2>&1 | tail -1
    docker image prune -af --filter 'until=48h' 2>&1 | tail -1
  fi

  df -h / | tail -1
} >> "$LOG" 2>&1
