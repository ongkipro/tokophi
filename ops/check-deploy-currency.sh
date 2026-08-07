#!/bin/sh
# T-11 — is production running what `main` says it should?
#
# 🔴 WHY THIS EXISTS. On 2026-08-06 a deployment row sat `in_progress` from 21:17 and never
# finished. Coolify runs an application's queue SERIALLY, so every merge behind it simply waited —
# no build started, no image was produced, nothing was unhealthy, and ALL FOUR HOSTS STAYED GREEN
# for hours on the previous commit. Two merges shipped nothing and no signal anywhere said so.
#
# ⚠️ THE L1 WATCHDOG CANNOT SEE THIS. L1 asks "is a container running?" — it was, correctly, on old
# code. This asks "is it the RIGHT code?". Neither question answers the other; that is the whole
# point of adding a second one rather than extending the first.
#
# Deliberately reads only Coolify's own database on the box: no GitHub token, no network egress,
# nothing to expire. It therefore catches the failure that actually happened (a wedged queue) and
# does NOT claim to catch "main moved but nothing was ever queued" — say what you check, and no more.
set -u
STALE_MIN=${STALE_MIN:-30}
APP=${APP:-1}          # Coolify application_id for tokophi
DB=${DB:-coolify-db}
rc=0

q() { docker exec -i "$DB" psql -U coolify -d coolify -Atc "$1" 2>/dev/null; }

STUCK=$(q "select count(*) from application_deployment_queues
           where application_id='$APP' and status='in_progress'
             and created_at < now() - interval '$STALE_MIN minutes';")
QUEUED=$(q "select count(*) from application_deployment_queues
            where application_id='$APP' and status in ('queued','in_progress');")
LAST=$(q "select left(commit,7)||' '||status||' '||created_at::timestamp(0)
          from application_deployment_queues where application_id='$APP'
          order by created_at desc limit 1;")
C=$(docker ps --format '{{.Names}}' | grep -m1 '^admin-')
RUNNING=$(docker inspect -f '{{.Config.Image}}' "$C" 2>/dev/null | sed 's/.*://' | cut -c1-7)

echo "running=$RUNNING  last_queue=[$LAST]  queued=$QUEUED"

if [ "${STUCK:-0}" -gt 0 ]; then
  echo "ALARM: a deployment has been in_progress for over ${STALE_MIN}m — the queue is WEDGED."
  echo "  Every merge behind it is waiting and the site is serving OLD code while looking healthy."
  echo "  Inspect first, then clear only the stale row:"
  echo "    docker exec -i $DB psql -U coolify -d coolify -c \"update application_deployment_queues set status='failed', updated_at=now() where application_id='$APP' and status='in_progress' and created_at < now() - interval '${STALE_MIN} minutes';\""
  rc=1
fi
[ "${QUEUED:-0}" -gt 3 ] && { echo "ALARM: $QUEUED deployments queued — builds are not draining."; rc=1; }
[ "$rc" = "0" ] && echo "OK: no wedged or piled-up deployment."
exit $rc
