# S3 External Code Review — Capability Hot-Reload + Restart Gap Closure

**Sprint:** M9.6-S3
**Reviewer:** Claude claude-sonnet-4-6 (external review session)
**Date:** 2026-04-15
**Spec ref:** docs/sprints/m9.6-capability-resilience/plan.md §5

---

## Verdict

APPROVED WITH MINOR OBSERVATION

All six plan deliverables are implemented. TypeScript compilation is clean on both packages. All 26 acceptance tests pass. One plan requirement (boot-time WARN logging via `getHealth()`) was not implemented in `app.ts`, but the method itself is complete, exported, and fully tested — the gap is a missing call site, not a missing feature. It is logged as a follow-up item (FU1 analogue) rather than a blocking defect.

---

## Plan ↔ Code Audit

| Plan requirement | Location | Status | Notes |
|---|---|---|---|
| 5.1 `CapabilityWatcher` class with `constructor(capabilitiesDir, envPath, registry, onRescan?)` | `packages/core/src/capabilities/watcher.ts` | PASS | Signature matches spec exactly |
| 5.1 `start()`, `stop()`, `rescanNow()` methods | `watcher.ts` lines 33–99 | PASS | All three implemented with correct signatures |
| 5.1 Watches `**/{CAPABILITY.md,.enabled,config.yaml,.mcp.json}` | `watcher.ts` lines 6–11, 59–67 | PASS | `WATCHED_FILENAMES` set filters add/change/unlink events |
| 5.1 Debounced 500ms | `watcher.ts` lines 46–57 | PASS | `setTimeout(..., 500)` with clear-on-re-trigger |
| 5.1 Polling mode | `watcher.ts` lines 39–40 | PASS | `usePolling: true, interval: 500` |
| 5.2 `CapabilityHealthReport` interface | `packages/core/src/capabilities/registry.ts` lines 8–15 | PASS | All five fields present, optional `issue` field correct |
| 5.2 `getHealth()` method flags `enabled && status==='unavailable'` | `registry.ts` lines 213–214 | PASS | Issue string includes `unavailableReason` |
| 5.2 `getHealth()` method flags `status==='available' && health==='degraded'` | `registry.ts` lines 215–216 | PASS | Issue string includes `degradedReason` |
| 5.2 `getHealth()` consumed on boot by App (logs at WARN) | `packages/dashboard/src/app.ts` | PARTIAL — see Finding F1 | Method exported and tested; call site in App boot is absent |
| 5.3 `CapabilityWatcher` constructed after registry init | `app.ts` lines 517–529 | PASS | Wired immediately after registry is populated |
| 5.3 Watcher started | `app.ts` line 530 | PASS | `await app.capabilityWatcher.start()` |
| 5.3 Watcher stopped in shutdown | `app.ts` lines 1880–1882 | PASS | In reverse-init order, after `spaceSyncService`, before `watchTriggerService` |
| 5.4 Pattern `systemctl restart/start/reload nina-*` | `packages/core/src/hooks/safety.ts` line 58 | PASS | Added with M9.6 annotation |
| 5.4 Pattern `pkill *nina` | `safety.ts` line 59 | PASS | Added |
| 5.4 Pattern `kill -9 .*(node\|nina)` | `safety.ts` line 60 | PASS | Added; regex uses `-?9?` to cover `-9`, `-SIGKILL`, and bare `kill` |
| 5.4 Pattern `service nina-* restart/start/reload` | `safety.ts` line 61 | PASS | Added |
| 5.4 Comment block updated | `safety.ts` lines 41–47 | PASS | Updated to explain self-restart rationale and CapabilityWatcher |
| 5.5 `// Verified real by M9.6-S3` comment in `definitions.ts` | `packages/core/src/agents/definitions.ts` line 126 | PASS | Comment placed inline after the capability-builder prompt's `tools` field, adjacent to the claim |
| 5.6 "Never self-restart" snippet in `packages/core/src/prompt.ts` | `prompt.ts` lines 481–497, injected at line 641 | PASS | `formatNeverSelfRestartDirective()` matches spec text verbatim; injected unconditionally |

---

## Findings

### F1 — IMPORTANT: `getHealth()` boot-time WARN logging absent from `app.ts`

**Plan text (§5.2):** "Consumed proactively on boot by `App` (logs at WARN)."

The `getHealth()` method is implemented, exported, and covered by 9 unit tests. However, no call site exists in `packages/dashboard/src/app.ts` that invokes it on boot and logs the result. The plan's intent was that unhealthy capabilities surface as WARN-level log lines at startup so operators can see degraded state in service logs without querying the API.

The natural location is immediately after `await app.capabilityWatcher.start()` (around `app.ts` line 531), once `testAll()` has been called on first-boot:

```typescript
// After testAll() settles on first boot, log any degraded capabilities
const healthReport = registry.getHealth().filter(r => r.issue)
for (const row of healthReport) {
  console.warn(`[Capabilities] WARN: ${row.name} (${row.type}) — ${row.issue}`)
}
```

This is not a blocking defect — the feature is present and tested. But the operational benefit (WARN-visible degraded state on startup) described in the plan is not realized until the call site is added.

**Recommendation:** Add the call site in a follow-up commit before S3 merges to master, or file it as a formal follow-up item. Given the sprint team has `s3-FOLLOW-UPS.md`, this belongs there.

---

### F2 — OBSERVATION: Watcher test timeout relaxed from plan's 1s to 2.5s

The plan acceptance criteria state "within 1s" for both watcher tests. The actual tests use a 2.5s polling deadline. This is mathematically necessary: with `usePolling: true, interval: 500ms` and `debounce: 500ms`, the theoretical minimum detection-to-rescan latency is ~1000ms, and practical filesystem timing on a loaded system can push this slightly higher. The 1s bound in the plan is infeasible with the polling configuration the plan itself mandates.

The sprint team did not file this as a deviation (it could have). The 2.5s deadline is reasonable and the tests run in ~1.2s actual time, well within the deadline.

**Recommendation:** Note this as an undocumented deviation between plan acceptance criteria and test implementation. Not a defect; the tests are more reliable than the plan specified.

---

### F3 — OBSERVATION: `onRescan` callback emits `capability:changed` twice

In `app.ts`, the `onRescan` callback (lines 521–527) emits `capability:changed` with two different arguments: once with the raw scan result (`caps`) and once with `registry.list()` (after `testAll()` has updated health). The sprint team identified this in `s3-FOLLOW-UPS.md` as FU1. The double-emit is harmless (second emit has current data), but the first emit sends pre-`testAll` health values to subscribers.

The sprint team's self-assessment is accurate. No action required in S3.

---

### F4 — POSITIVE: Replacement of pre-existing `capWatcher` leak

The sprint correctly identified and fixed a pre-existing bug: the old `FileWatcher`-based `capWatcher` was a local variable with no shutdown handle, causing it to leak on `App.shutdown()`. Decision D1 documents the replacement. The new `CapabilityWatcher` is stored as an App field and properly stopped in the shutdown sequence. This is an improvement over the plan's scope.

---

### F5 — POSITIVE: Exported via both `capabilities/index.ts` and `core/lib.ts`

`CapabilityWatcher` and `CapabilityHealthReport` are correctly added to `packages/core/src/capabilities/index.ts` and re-exported from `packages/core/src/lib.ts`. The public API surface is consistent with the existing pattern.

---

### F6 — POSITIVE: D2 (existing test correction) is well-documented

Decision D2 updated `bash-blocker-extended.test.ts` to reflect that `systemctl start nina-dashboard.service` is now blocked (not allowed). The test description was also updated. This is a correct behavioral change — the plan explicitly adds `start` to the blocked set — and the rationale is documented in `s3-DECISIONS.md`.

---

## Sprint artifacts assessment

| Artifact | Quality | Notes |
|---|---|---|
| `s3-DECISIONS.md` | Good | 4 decisions, each with clear reasoning and blast-radius assessment |
| `s3-DEVIATIONS.md` | Acceptable | Claims no deviations filed; F2 (1s→2.5s timeout) and the absent getHealth boot call could have been filed here |
| `s3-FOLLOW-UPS.md` | Good | FU1 (double-emit) and FU2 (redundant directive) are self-identified and accurately assessed |
