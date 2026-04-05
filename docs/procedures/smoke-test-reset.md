# Smoke Test & Reset Procedure

> **Purpose:** Repeatable testing of the agentic flow. Reset to a known baseline, run the same test, verify artifacts.
> **Created:** 2026-04-05 (M9.1 Agentic Flow Overhaul)

---

## When to use

- After implementing changes to the automation executor, todo system, hooks, or notification pipeline
- Sprint acceptance testing (run 3x consecutively to prove stability)
- Debugging a specific agentic flow failure (isolate by resetting to clean state)

## State locations

Everything that needs cleaning for a full reset:

| Component | Source of truth | Derived/cached |
|---|---|---|
| **Automations** | `.my_agent/automations/{id}.md` | `agent.db` → `automations` table |
| **Jobs** | `.my_agent/automations/{id}.jsonl` | `agent.db` → `jobs` table |
| **Job artifacts** | `.my_agent/automations/.runs/{id}/{jobId}/` | — |
| **SDK sessions** | `.my_agent/automations/.sessions/{id}.json` | — |
| **Conversations** | `.my_agent/conversations/conv-{id}.jsonl` | `agent.db` → `conversations` + `turns_fts` |
| **Notifications** | `.my_agent/notifications/pending/` + `delivered/` | — |
| **Capabilities** | `.my_agent/capabilities/{name}/` | `CapabilityRegistry` (in-memory) |
| **Memory index** | `notebook/` markdown files | `brain.db` (FTS5 + sqlite-vec) |

**Principle:** Delete the source of truth → restart dashboard → derived indexes rebuild automatically via `syncAll()` and `reindexAll()` on startup.

## Scripts

### `scripts/smoke-test-reset.sh`

Cleans test-prefixed artifacts and creates a known baseline capability. Safe for production — only touches `smoke-test-*` prefixed items.

### `scripts/smoke-test-run.sh`

Fires a real automation via admin API, polls for completion, verifies artifacts on disk (todos.json, deliverable.md, DECISIONS.md, notifications).

### Usage

```bash
# Single run
./scripts/smoke-test-reset.sh && ./scripts/smoke-test-run.sh

# Repeat until 3 consecutive passes
CONSECUTIVE=0
while [ "$CONSECUTIVE" -lt 3 ]; do
  ./scripts/smoke-test-reset.sh
  if ./scripts/smoke-test-run.sh; then
    CONSECUTIVE=$((CONSECUTIVE + 1))
    echo "Pass $CONSECUTIVE/3"
  else
    CONSECUTIVE=0
    echo "Failed — fix and retry"
    exit 1
  fi
done
```

## Selective reset

For targeted debugging, reset only what you need:

```bash
# Jobs only (keep automations, conversations, capabilities)
rm .my_agent/automations/*.jsonl
rm -rf .my_agent/automations/.runs
systemctl --user restart nina-dashboard.service

# Conversations only
rm .my_agent/conversations/conv-*.jsonl
systemctl --user restart nina-dashboard.service

# Notifications only
rm -rf .my_agent/notifications/pending/*
rm -rf .my_agent/notifications/delivered/*

# Full nuclear reset (everything except brain identity)
rm .my_agent/automations/*.md .my_agent/automations/*.jsonl
rm -rf .my_agent/automations/.runs .my_agent/automations/.sessions
rm .my_agent/conversations/conv-*.jsonl
rm -rf .my_agent/notifications
rm .my_agent/conversations/agent.db*
systemctl --user restart nina-dashboard.service
```

## Admin API shortcuts

```bash
DASHBOARD=http://localhost:4321

# Rebuild memory index from notebook files
curl -X POST $DASHBOARD/memory/rebuild -H "X-Confirm-Destructive: true"

# Delete a specific conversation
curl -X POST $DASHBOARD/conversation/{id}/delete

# Trigger automation sync from disk
curl -X POST $DASHBOARD/memory/sync
```

## After reset

Dashboard restart triggers:
1. **Empty conversation cleanup** — deletes turnCount=0 conversations
2. **Automation sync** — `syncAll()` re-reads markdown manifests, disables orphans
3. **Job reindex** — `reindexAll()` rebuilds jobs table from JSONL
4. **Capability scan** — `scanCapabilities()` discovers capabilities from disk
5. **Recovery sequence** (M9.1) — marks interrupted jobs, creates notifications, cleans stale automations
6. **Heartbeat start** (M9.1) — begins monitoring loop

---

*This procedure is reusable for any future milestone that modifies the agentic flow.*
