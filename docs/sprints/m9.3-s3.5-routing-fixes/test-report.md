# M9.3-S3.5: Routing & Session Fixes — Test Report

**Date:** 2026-04-08
**Branch:** `sprint/m9.3-s3.5-routing-fixes`

---

## Unit Tests

| Package | Passed | Skipped | Failed |
|---------|--------|---------|--------|
| Core | 273 | 7 | 0 |
| Dashboard | 1136 | 12 | 0 |
| **Total** | **1409** | **19** | **0** |

New tests: 8 auto-resume predicate tests (`tests/unit/automations/auto-resume.test.ts`)

---

## Live Validation

### Test 1: Worker no longer crashes (T7.2 env var fix)

- Fired `smoke-test-generic-e2e` after dashboard restart
- Worker started at 11:15:05, completed at 11:16:38
- **Zero `ProcessTransport` errors**
- **PASS**

### Test 2: Interruption → Auto-resume (T7.3 + session ID fix)

- Fired `smoke-test-generic-e2e`, waited 35s for SDK session to establish
- Restarted dashboard mid-execution (`systemctl --user restart`)
- Recovery log: `once=true, autonomy=full, session=true, canAutoResume=true`
- `[Recovery] 1 auto-resumed, 0 interrupted`
- `[AutomationExecutor] Resuming job ... (session: 5a273651-...)`
- `[AutomationExecutor] Job ... resumed -> completed`
- **Zero WhatsApp notifications**
- **PASS**

### Test 3: Session ID persistence (discovered issue)

Initial interruption tests showed `session=false` — the `sdk_session_id` was only persisted when the job completed (step 10 of executor). Fix: persist immediately on capture from SDK init message. Verified in Test 2 (session=true after 35s).

### Test 4: Non-resumable jobs still notify (regression check)

Earlier test with `session=false` (10s window, session not yet captured): `0 auto-resumed, 1 interrupted`. Job correctly fell through to the interrupt+notify path. **PASS**

---

## Verification Checklist

- [x] Workers don't crash alongside Claude Code (env vars cleared)
- [x] Safe ad-hoc jobs auto-resume on restart (once:true + full autonomy + has session)
- [x] Auto-resumed job completes successfully
- [x] Non-resumable jobs fall through to interrupt+notify
- [x] sourceChannel carried through all 5 enqueue paths
- [x] Heartbeat passes sourceChannel to ci.alert()
- [x] All unit tests pass, no regressions
- [x] TypeScript compiles clean
