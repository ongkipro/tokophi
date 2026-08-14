#!/usr/bin/env bash
# Runnable branch check for tokophi-docker-cleanup.sh. No real Docker resources
# are touched: PATH injects deterministic df/docker fakes into a temporary dir.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -r "$TMP"' EXIT

cat > "$TMP/df" <<'EOF'
#!/usr/bin/env bash
use="$FAKE_USE_BEFORE"
free_gb="$FAKE_FREE_BEFORE"
if grep -q '^builder prune -af$' "$FAKE_DOCKER_LOG" 2>/dev/null; then
  use="$FAKE_USE_AFTER"
  free_gb="$FAKE_FREE_AFTER"
fi
case "${1:-}" in
  -h) printf '/dev/fake 169G 1G %sG %s%% /\n' "$free_gb" "$use" ;;
  -Pk) printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/fake 1 1 %s %s%% /\n' "$((free_gb * 1024 * 1024))" "$use" ;;
  *) printf 'Filesystem 1K-blocks Used Available Use%% Mounted\n/dev/fake 1 1 %s %s%% /\n' "$((free_gb * 1024 * 1024))" "$use" ;;
esac
EOF

cat > "$TMP/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
printf 'Total reclaimed space: 1GB\n'
EOF
chmod +x "$TMP/df" "$TMP/docker"

run_case() {
  : > "$TMP/docker.log"
  PATH="$TMP:$PATH" \
    FAKE_DOCKER_LOG="$TMP/docker.log" \
    FAKE_USE_BEFORE="$1" FAKE_FREE_BEFORE="$2" \
    FAKE_USE_AFTER="$3" FAKE_FREE_AFTER="$4" \
    TOKOPHI_CLEANUP_LOG="$TMP/cleanup.log" \
    TOKOPHI_CLEANUP_LOCK="$TMP/cleanup.lock" \
    "$ROOT/ops/tokophi-docker-cleanup.sh"
}

# Pressure cleared by cache cleanup: preserve rollback images.
run_case 74 44 40 90
grep -qx 'builder prune -af' "$TMP/docker.log"
if grep -qx 'image prune -af' "$TMP/docker.log"; then
  echo 'FAIL: deleted rollback images after cache restored headroom' >&2
  exit 1
fi

# Persistent pressure: unused images are the second and final rung.
run_case 74 44 74 44
grep -qx 'builder prune -af' "$TMP/docker.log"
grep -qx 'image prune -af' "$TMP/docker.log"

# Normal mode: age cache more aggressively than rollback images.
run_case 40 90 40 90
grep -qx 'builder prune -af --filter until=24h' "$TMP/docker.log"
grep -qx 'image prune -af --filter until=48h' "$TMP/docker.log"

echo 'tokophi-docker-cleanup: branch checks passed'
