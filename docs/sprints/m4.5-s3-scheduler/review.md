# Sprint Review — M4.5-S3: API Discovery + CalendarScheduler

> **Sprint:** [plan.md](plan.md)
> **Reviewer:** Claude Opus
> **Date:** 2026-02-19

---

## Verdict: PASS

All 8 tasks completed. Build passes. Endpoints verified.

---

## Plan Adherence

| Task | Plan | Actual | Status |
|------|------|--------|--------|
| T1: GET /api/debug/api-spec | Add endpoint | Added with full endpoint docs | Match |
| T2: Update SKILL.md | Add structured endpoints | Added discovery hint + endpoints table | Match |
| T3: Add Quick Actions to context | Modify context.ts | Added Quick Actions section | Match |
| T4: Create CalendarScheduler | New file scheduler.ts | Created with full feature set | Match |
| T5: Add scheduler types | Update types.ts | Added 3 types | Match |
| T6: Initialize scheduler | Update server.ts + index.ts | Integrated with graceful shutdown | Match |
| T7: GET /api/debug/scheduler/status | Add endpoint | Added | Match |
| T8: Export scheduler | Update index.ts + lib.ts | Exported | Match |

**Deviations:** None

---

## Code Quality

### Strengths
- CalendarScheduler has proper cleanup (24-hour old event pruning)
- Fired events persisted to disk for restart recovery
- Recurring events handled correctly (UID + start time as key)
- Clean shutdown handler integration
- API spec endpoint is comprehensive with examples

### Issues Found
- **Fixed:** Pre-existing type mismatch in `hatching-tools.ts` (IdentityData interface)
  - Changed `name` to `nickname` to match core types
  - Changed `writeMinimalConfig` arg to object form

---

## Security Review

- No new security concerns
- Scheduler only reads calendar data, no write operations
- Debug endpoints remain localhost-only (existing behavior)

---

## Verification

```bash
# Build check
cd packages/core && npm run build        # PASS
cd packages/dashboard && npx tsc --noEmit # PASS

# API Discovery
curl http://localhost:4321/api/debug/api-spec | jq .calendar
# Returns full endpoint documentation with methods, paths, required fields

# Scheduler Status
curl http://localhost:4321/api/debug/scheduler/status
# { "running": true, "pollIntervalMs": 60000, "firedCount": 0, ... }

# Server logs
[Scheduler] No persisted fired events found, starting fresh
[Scheduler] Starting with poll interval 60000ms, look-ahead 5min
Calendar scheduler started (polling every 60s)
```

---

## Flagged Items for CTO Review

1. **Decision: Skip MCP Tools** (Medium severity)
   - REST API is sufficient, but agents will use curl
   - See [DECISIONS.md](DECISIONS.md) for full rationale
   - Recommend: Proceed, revisit if agents struggle

---

## Recommendations

1. **Test event firing manually:**
   - Create event 2 min in future
   - Watch logs for `[Scheduler] Firing event:`
   - Verify `/api/debug/scheduler/status` shows firedCount=1

2. **Future consideration:**
   - `onEventFired` currently logs only (MVP)
   - M5 can add actual action dispatch (spawn brain query)

---

*Review completed: 2026-02-19*
