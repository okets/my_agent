---
sprint: m9.6-s10
reviewer: External auditor (dev-contracted)
date: 2026-04-17
recommended: CONDITIONAL
---

# S10 External Auditor Review

## Verdict

CONDITIONAL — the core deliverables (CapabilityInvoker, exec-bit validation, classifySttError removal, invoker wiring in chat-service and reverify) are correctly implemented and the 6-symptom matrix is sound; two issues must be resolved before merge: (1) multi-instance capability types are silently broken at runtime due to `listByProvides()[0]` picking the first cap regardless of which is preferred; (2) a missing test for the timeout detection via the `killed` flag means the spec-required timeout path is only partially exercised.

---

## Spec compliance

Per plan-phase2-coverage.md §2.2 (S10 section):

| Requirement | Status |
|---|---|
| `CapabilityInvoker` class with `run(opts): Promise<InvokeResult>` | Met |
| Constructor takes `{cfr, registry, originFactory}` | Met |
| not-installed: registry returns no plug → `{kind:"failure", symptom:"not-installed"}` + emit | Met |
| not-enabled: `cap.enabled === false` → `not-enabled` | Met |
| status != available → `execution-error` | Met |
| execFile timeout → `timeout` | Met |
| execFile rejects otherwise → `execution-error` | Met |
| `expectJson === true`, stdout invalid JSON → `validation-failed` | Met |
| All failure paths emit via `cfr.emitFailure(failure, triggeringInput)` | Met |
| `execFile` direct (not `bash` wrapper) | Met — see D5 |
| `validateScriptExecBits()` in test-harness.ts | Met |
| Exec-bit check uses `fs.statSync(p).mode & 0o111` | Met — uses `statSync().mode` and `& 0o111` (line 408 of test-harness.ts) |
| Scanner integrates exec-bit check, marks plug `invalid` | Met — scanner.ts lines 183–189 |
| `classifySttError` removed from failure-symptoms.ts | Met |
| `classifySttError` removed from index.ts and lib.ts exports | Met |
| No remaining call sites for `classifySttError` | Met — grep confirms only a comment in the tombstone line |
| `transcribeAudio()` routes through invoker, old emit calls collapse | Met |
| `synthesizeAudio()` NOT refactored, TODO marker present | Met — deferred per §2.2 |
| `reverifyAudioToText` uses invoker when available; bash fallback kept | Met |
| `recovery-orchestrator.ts` passes invoker to reverify | Met (line 439) |
| App wires `capabilityInvoker` on boot | Met (app.ts lines 539–547) |

---

## Correctness findings

### C1 — Multi-instance capability selection is silent first-pick (moderate)

**File:** `packages/core/src/capabilities/invoker.ts`, line 73–77.

```ts
const allCaps = registry.listByProvides(capabilityType);
if (allCaps.length === 0) {
  return emit("not-installed", ...);
}
const cap = allCaps[0];
```

`listByProvides` returns all caps of the type, including disabled ones, in map-insertion order. For a multi-instance type (`browser-control`, `desktop-control`) with two registered instances where the first happens to be disabled, the invoker picks `allCaps[0]` and then correctly emits `not-enabled` — but it does so for an instance the caller never intended to invoke and silently ignores the healthy second instance.

This matters for the installed-plug set today: `browser-control` is declared `multi_instance: true` in the template and S11 may register multiple instances. The S14 spec also references multi-instance ack disambiguation, implying the invoker must eventually pick a specific named instance.

The spec §2.2 says callers provide `capabilityType`. It does not specify which instance is selected when multiple exist. The safest fix for S10 is to pick the first *enabled, available* instance rather than the first insertion. A `capabilityName` parameter to `InvokeOptions` for explicit selection would be cleaner and avoids implicit precedence — but that's a design extension for a later sprint to propose. The immediate fix (prefer first available/enabled) should be in-sprint.

**Severity:** moderate — doesn't affect current installed set (audio-to-text is single-instance) but will silently misfire as soon as any multi-instance type has >1 registered instance.

---

### C2 — Timeout test does not exercise the `killed` detection path (minor)

**File:** `packages/core/tests/capabilities/invoker.test.ts`, lines 149–167.

The timeout test runs a real `sleep 9999` script with `timeoutMs: 50`. This exercises the ETIMEDOUT code/killed-flag path and will pass. However, `invoker.ts` lines 113–115 branch on three conditions: `killed`, `code === "ETIMEDOUT"`, and string-contains `"etimedout"/"timeout"`. The test only hits one of these. No test simulates a message-only timeout error (e.g. `new Error("timeout exceeded")` with no code/killed flag) to exercise the string-match fallback. This is belt-and-suspenders code, so the gap is minor, but a unit test with a mocked `execFile` that throws `new Error("Request timeout")` would confirm the fallback.

---

### C3 — `reverifyAudioToText` fallback still calls `execFile("bash", [scriptPath, ...])` — exec-bit guarantee not enforced on the fallback path (documented gap)

**File:** `packages/core/src/capabilities/reverify.ts`, lines 176–183.

The fallback path (no invoker) calls `execFile("bash", [scriptPath, ...])`, which bypasses the exec-bit guarantee that D5 specifically put in place. D3 and FU-2 document this as intentional (legacy test compat), but the comment at line 160 says "when exec-bit validation is guaranteed (S10 wired), the bash wrapper can be dropped in S13." This is accurate — worth verifying at S13 that no test continues to rely on this path unexpectedly.

**Not a blocking issue for S10** — the gap is acknowledged in DECISIONS.md D3 and FOLLOW-UPS FU-2. Flagging for completeness.

---

### C4 — `originFactory` is dead code in S10 and not called anywhere (minor, documented)

**File:** `packages/core/src/capabilities/invoker.ts`, `InvokerDeps.originFactory`.

`originFactory` is stored in `this.deps` but never read in `run()`. D1 documents this as intentional forward-compat for S12. The `app.ts` wiring (lines 542–546) provides a placeholder origin with empty `conversationId` and `turnNumber: 0`, which would produce a misleading CFR if the factory were ever called without being overridden. S12 must replace this placeholder with real per-session context. The current state is correct per spec; flagging so S12 doesn't inherit the placeholder silently.

---

## Security review

### S1 — `scriptPath` construction: `join(cap.path, "scripts", scriptName)` — path traversal bounded by registry (acceptable)

`scriptName` comes from the call site (e.g. `"transcribe.sh"`), not from user input. `cap.path` is the capability directory read from the scanner, which only admits paths under `capabilitiesDir` (one level deep via `globby('*/CAPABILITY.md', ...)`). A malicious `scriptName` containing `"../../etc/passwd"` would produce a path like `<capDir>/scripts/../../etc/passwd`, which would resolve outside the cap dir. However: (a) call sites in this sprint are all hardcoded string literals (`"transcribe.sh"`, `"synthesize.sh"`), not user-provided; (b) `InvokeOptions.scriptName` has no validation. If a future call site passes a caller-controlled string, traversal is possible.

**Recommendation (non-blocking for S10):** Add a guard in `invoker.ts`:
```ts
if (scriptName.includes("/") || scriptName.includes("..")) {
  return emit("execution-error", `Invalid scriptName: ${scriptName}`, cap.name);
}
```
This is defensive hardening, not an exploitable bug given current callers.

### S2 — `args` passed directly to `execFile` — no shell interpolation risk

`execFile` is used (not `exec` or `spawn` with shell), so `args` are passed as separate argv entries with no shell expansion. No command injection risk regardless of arg content.

### S3 — `process.env` spread into child — acceptable

`env: { ...process.env }` inherits all environment variables. This is the correct pattern for capability scripts that need env vars (e.g. `DEEPGRAM_API_KEY`). No additional secrets are injected beyond what the parent process already has.

---

## Test adequacy

**invoker.test.ts (9 tests):**

- 6-symptom matrix covered with real temp scripts for execution paths (timeout, validation-failed, success, exit-1) and registry fakes for pre-execution paths (not-installed, not-enabled, execution-error/status).
- triggeringInput forwarding test present.
- `cfr.emitFailure` call count and `symptom` field verified on every failure path.
- **Gap (C2 above):** No test for the message-string-only timeout fallback. Low priority.
- **Gap:** No test verifying that `cap.name` is passed as `capabilityName` to `cfr.emitFailure` for non-not-installed failures. The spec says `capabilityName: capName` — checking it wouldn't hurt.
- **Gap:** No test for `expectJson: false` with a multi-line stdout (current test uses single-line). Likely fine but worth noting.

**exec-bit-validator.test.ts (8 tests):**

- Full coverage of `validateScriptExecBits()` states: no scripts dir, empty dir, all-executable, one-non-executable, mixed, non-.sh files ignored.
- Two integration tests via `scanCapabilities()` confirming the end-to-end path marks caps invalid/available correctly.
- The tests write real temp files and set real file permissions — they exercise the actual `statSync` call, not a mock. This is the right approach.
- **Gap:** No test for a capability whose `interface` field is `"mcp"` — confirming that MCP-interface caps are NOT subjected to exec-bit validation (scanner.ts line 183 guards `if (data.interface === 'script')`). This is a positive-absence test that would prove the guard works, but it's minor.

**Regression gate:**
- The test report confirms 183 tests pass in `packages/core` and 35 in `packages/dashboard` with no new failures. The deleted `cfr-emit-stt-errors.test.ts` scenarios are subsumed by `invoker.test.ts`.

**Overall:** tests are adequate for the core deliverable. The gaps above are minor.

---

## Follow-up gaps

The three items in `s10-FOLLOW-UPS.md` (FU-1 TTS invoker wiring, FU-2 bash wrapper removal, FU-3 future script-type audit) correctly capture the known coverage holes.

One item not in FOLLOW-UPS that should be:

### Missing FU-4 — Multi-instance selection policy for invoker

`CapabilityInvoker.run()` picks `allCaps[0]` for all capability types. For single-instance types this is fine. For multi-instance types (`browser-control`, `desktop-control`), the "first insertion wins" policy will silently invoke the wrong instance if multiple are registered. The FOLLOW-UPS should name this with the receiving sprint (S12 or S14, whichever first wires multi-instance capable callers) so the gap isn't discovered in production. If C1 is addressed in-sprint by preferring the first *enabled+available* instance, FU-4 should still document the eventual `capabilityName` selection parameter as a Phase 3 item.

---

## Conditional requirements

The following must be addressed before merge:

1. **C1 — Multi-instance selection:** Change `const cap = allCaps[0]` to `const cap = allCaps.find(c => c.enabled && c.status === "available") ?? allCaps[0]`. This is a 1-line change in invoker.ts and ensures multi-instance types get the best available instance instead of first-by-insertion. Add a corresponding test in `invoker.test.ts` (2 caps, first disabled, second available → invoker uses second). Add FU-4 to `s10-FOLLOW-UPS.md` noting that a named-instance selection parameter is deferred to the sprint that first wires multi-instance callers.

2. **C2 — Timeout string fallback test (minor but spec-complete):** Add one test case: mock `execFile` to throw `new Error("timeout exceeded")` with no `killed` flag and no `ETIMEDOUT` code; assert symptom is `"timeout"`. This can be done with `vi.mock("node:child_process")` for the one test case.

No other items block merge. Items C3 and C4 are acknowledged in the dev's own DECISIONS/FOLLOW-UPS and are tracked correctly for S13 and S12 respectively.
