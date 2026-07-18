#!/usr/bin/env bash
# Safety-net against Coolify's per-deploy image churn filling the disk.
#
# On 2026-07-18 the disk hit 100% (204 per-deploy images / ~129 GB), which put
# Postgres into an end-of-recovery checkpoint crash-loop
# (`PANIC: could not write ... No space left on device`) → every query returned
# "the database system is in recovery mode" → the SSR storefront 503'd for ~2h
# while it sat `Up (unhealthy)` (the L2/L3 gap the watchdog cannot heal).
#
# Conservative by design: removes ONLY build cache + UNUSED images. It NEVER
# touches volumes (Postgres data lives there) or any image attached to a
# running/stopped container. Install: see DEPLOY.md "L1b disk-cleanup safety-net".
#   /etc/cron.d/tokophi-docker-cleanup:  30 3 * * * root /usr/local/bin/tokophi-docker-cleanup.sh
set -uo pipefail
LOG=/var/log/tokophi-docker-cleanup.log
{
  echo "=== $(date -u +%FT%TZ) cleanup ==="
  df -h / | tail -1
  # Keep 48h of rollback history normally; prune everything unused only when tight.
  USE=$(df / | awk 'NR==2{gsub("%","",$5);print $5}')
  if [ "${USE:-0}" -ge 80 ]; then
    docker builder prune -af 2>&1 | tail -1
    docker image prune -af 2>&1 | tail -1
    echo "(aggressive: disk was ${USE}%)"
  else
    docker builder prune -af --filter 'until=48h' 2>&1 | tail -1
    docker image prune -af --filter 'until=48h' 2>&1 | tail -1
  fi
  df -h / | tail -1
} >> "$LOG" 2>&1
