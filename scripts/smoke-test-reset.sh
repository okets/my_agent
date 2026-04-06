#!/usr/bin/env bash
set -euo pipefail

# Smoke Test Reset — returns the system to a known baseline for M9.1-S8 testing.
# Safe to run repeatedly. Restarts the dashboard to sync state.

AGENT_DIR="${MY_AGENT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.my_agent}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:4321}"

echo "=== Smoke Test Reset ==="
echo "Agent dir: $AGENT_DIR"

# 1. Delete test automations, jobs, and run directories
echo "[reset] Cleaning test automations..."
find "$AGENT_DIR/automations" -name "smoke-test-*.md" -delete 2>/dev/null || true
find "$AGENT_DIR/automations" -name "smoke-test-*.jsonl" -delete 2>/dev/null || true
rm -rf "$AGENT_DIR/automations/.runs/smoke-test-"* 2>/dev/null || true
rm -rf "$AGENT_DIR/automations/.sessions/smoke-test-"* 2>/dev/null || true

# 2. Delete test notifications
echo "[reset] Cleaning test notifications..."
find "$AGENT_DIR/notifications/pending/" -name "*smoke-test*" -delete 2>/dev/null || true
find "$AGENT_DIR/notifications/delivered/" -name "*smoke-test*" -delete 2>/dev/null || true

# 3. Delete test capability (will be recreated)
echo "[reset] Cleaning test capability..."
rm -rf "$AGENT_DIR/capabilities/smoke-test-cap" 2>/dev/null || true

# 4. Create a known test capability to modify
echo "[reset] Creating baseline test capability..."
mkdir -p "$AGENT_DIR/capabilities/smoke-test-cap/scripts"
cat > "$AGENT_DIR/capabilities/smoke-test-cap/CAPABILITY.md" << 'CAPEOF'
---
name: Smoke Test Capability
provides: smoke-test
interface: script
requires:
  env: []
---

A dummy capability for smoke testing the agentic flow.
Script echoes input back with a prefix.
CAPEOF

cat > "$AGENT_DIR/capabilities/smoke-test-cap/scripts/process.sh" << 'SCRIPTEOF'
#!/usr/bin/env bash
echo '{"result": "smoke-test-echo: '"$1"'"}'
SCRIPTEOF
chmod +x "$AGENT_DIR/capabilities/smoke-test-cap/scripts/process.sh"

cat > "$AGENT_DIR/capabilities/smoke-test-cap/config.yaml" << 'CONFEOF'
language: en
format: json
CONFEOF

# 5. Initialize empty DECISIONS.md
cat > "$AGENT_DIR/capabilities/smoke-test-cap/DECISIONS.md" << 'DECEOF'
# Decisions
DECEOF

# 6. Restart dashboard to pick up clean state
echo "[reset] Restarting dashboard..."
systemctl --user restart nina-dashboard.service

# 7. Health check with retry (dashboard takes ~8s to start)
echo "[reset] Waiting for dashboard..."
for i in $(seq 1 10); do
  sleep 2
  if curl -sf "$DASHBOARD_URL/" > /dev/null 2>&1; then
    echo "[reset] Dashboard is healthy (${i}x2s)"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "[reset] WARNING: Dashboard health check failed after 20s"
    exit 1
  fi
done

echo "=== Reset Complete ==="
echo "Baseline: smoke-test-cap capability at $AGENT_DIR/capabilities/smoke-test-cap/"
echo "Ready for smoke test."
