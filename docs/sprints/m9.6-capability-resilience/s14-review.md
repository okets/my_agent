---
sprint: m9.6-s14
date: 2026-04-18
reviewer: Senior Code Reviewer (claude-sonnet-4-6)
verdict: APPROVED WITH NOTES
---

# M9.6-S14 External Review — Friendly Names + Multi-Instance + Per-Type Fallback Copy

## Verdict: APPROVED WITH NOTES

The sprint goal is fully implemented and all tests pass. Two issues require attention before the next sprint ships code that depends on the automation-recovery path. Neither blocks merge; both are documented below with precise fix instructions.

---

## 1. Plan Alignment / Spec Coverage

### What was planned

| Task | Plan description | Status |
|---|---|---|
| T1 | `fallback_action` + `multi_instance` in types + scanner | Done |
| T2 | `isMultiInstance` + `getFallbackAction` in registry | Done |
| T3 | `createResilienceCopy` factory; delete `defaultCopy`; migrate test | Done |
| T3 update | Update `index.ts` + `lib.ts` exports | Done |
| T4 | `capabilityName?` on `InvokeOptions`; named-instance filter (FU-4) | Done |
| T5 | Wire `resilienceCopy` at boot; fix `emitAck` switch | Done |
| T6a | Universal-coverage gate (Layer 1 static + Layer 2 dynamic) | Done — see note |
| T6b | Multi-instance ack disambiguation tests | Done |
| T6c | Terminal-recovery ack per-type tests | Done |
| T7 | Sprint artifacts (DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report) | Done |

### Architect gap responses

- **G1 (dynamic coverage gate):** Implemented via a two-layer test. Layer 1 checks a hardcoded `REGISTERED_TYPES` array; Layer 2 dynamically scans `.my_agent/capabilities/` at test time. The dynamic layer ran and passed on this machine (picked up `browser-chrome`). The gate correctly skips in CI when `.my_agent/` is absent.

  One semantic difference from the architect's original G1 requirement: the plan spec asked for the dynamic test to assert `friendlyName(type) !== type` (raw-type detection), but the implemented test only asserts non-empty ack output. For well-known types this is equivalent (the ack template always produces a non-empty string regardless of whether the raw type leaked through). The gap matters only for a future unknown type — `"hold on — my-new-type isn't working right, fixing now."` would pass the length assertion. This is a minor softening of the gate. It is consistent with the plan's amended spec (the plan text was updated to match the implementation approach), so it does not constitute a deviation. Recorded below as a suggestion.

- **G2 (first-wins semantic):** Documented in D7 in DECISIONS.md. Option A chosen; rationale clear.

- **G3 (plug-level override):** Documented in D7.

- **G4 (boot-order fallback warn):** Implemented — `resilienceCopy` is pre-initialized with an empty-registry stub at field declaration (`createResilienceCopy(new CapabilityRegistry())`), so it is never null. The `const rc = app.resilienceCopy` pattern in the emitAck switch is safe. The architect's `console.warn` path is handled by the terminal `else` branch with `console.warn` on unhandled kinds. Adequate.

### DEV-1 (ack-delivery.ts widening)

The deviation is real and correctly documented. The type widening in `writeAutomationRecovery` and `buildRecoveryBody` is correct — `"terminal-fixed"` is a semantically distinct outcome and should flow through to `CFR_RECOVERY.md` frontmatter unchanged. No concerns.

---

## 2. Issues Found

### Issue 1 — Important: `isTerminalKind` in `ack-delivery.ts` does not include `"terminal-fixed"`

**File:** `packages/core/src/capabilities/ack-delivery.ts` line 126-128

**Current code:**
```typescript
function isTerminalKind(kind: AckKind | undefined): boolean {
  return kind === "surrender" || kind === "surrender-budget";
}
```

**What this means:** When the orchestrator emits `"terminal-fixed"` (the RESTORED_TERMINAL path wired in S13), `AckDelivery.deliver()` is called with `context.kind = "terminal-fixed"`. Because `isTerminalKind` returns `false`, the automation-origin branch exits early at line 197 (`if (!isTerminalKind(context?.kind)) return;`) and the `CFR_RECOVERY.md` file is never written for automation-origin capabilities that recover successfully.

The type widening in DEV-1 correctly updated the `writeAutomationRecovery` signature to accept `"terminal-fixed"`, but the `isTerminalKind` guard that gates that write was not updated.

**Impact:** Conversation-origin acks are unaffected (they route through the transport layer, not the automation branch). System-origin acks are log-only and unaffected. Only automation-origin capabilities that reach `RESTORED_TERMINAL` after the S13 reverify path are silently missing a recovery record.

**Fix:**
```typescript
function isTerminalKind(kind: AckKind | undefined): boolean {
  return kind === "surrender" || kind === "surrender-budget" || kind === "terminal-fixed";
}
```

**Also recommended:** `buildRecoveryBody` has an `if (outcome === "fixed")` branch and an `else` branch. `"terminal-fixed"` currently falls into the `else` branch, producing a surrender-style summary ("The fix loop exhausted...") for a successful recovery — incorrect. Add a second explicit match:
```typescript
if (outcome === "fixed" || outcome === "terminal-fixed") {
  const last = attempts[attempts.length - 1];
  summaryParagraph = last?.hypothesis ?? `The ${plugName} capability was recovered.`;
}
```

Neither fix requires a type change. Both are small single-line corrections.

### Issue 2 — Suggestion: Dynamic coverage gate does not enforce "non-raw-type" copy

**File:** `packages/core/tests/capabilities/resilience-messages-coverage.test.ts` line 95

**Current:** asserts `copy.ack(f).length > 0` — which is always true.

**Plan spec (G1 response in s14-plan.md):** architect required `friendlyName(type) !== type` check.

**Impact:** If a future sprint adds a new capability type and omits a `FRIENDLY_NAMES` entry, the user would see "hold on — my-new-type isn't working right" in production but the coverage test would still pass.

**Fix option:** Add alongside the length assertion:
```typescript
expect(
  copy.ack(f),
  `${type}: ack must not use the raw type string`
).not.toMatch(new RegExp(`hold on — ${type} isn't working right`));
```
This matches the plan's original assertion verbatim. The dynamic layer already has access to the `type` variable in the loop.

This is a suggestion, not a blocker — the static Layer 1 catches all currently registered types.

---

## 3. Code Quality Notes

**Positive:**

- Factory pattern is cleanly consistent with S10/S12. No module-level state.
- `FRIENDLY_NAMES` is exported for tests only, with a clear "do not use outside tests" comment. Correct pattern.
- `instanceSuffix` is a pure function, properly separated from the factory closure.
- The `terminalAck` switch covers three named cases and falls back via `default` to a template using `friendlyName` — graceful degradation for future types.
- The boot-time pre-initialization of `resilienceCopy` (`createResilienceCopy(new CapabilityRegistry())`) eliminates the null-check pattern from the plan's G4 suggestion and is cleaner.
- The `emitAck` switch now covers all six `AckKind` values and has an explicit `else` with `console.warn` for future unknown kinds. This is correct and improves on the plan's original switch.
- `invoker.ts` named-instance selection: the two-step filter (`allCaps` then `candidates`) is readable. The `not-installed` error message includes the requested name, aiding debugging.

**Minor concerns:**

- `resilience-messages-coverage.test.ts` line 67: `const envPath = join(myAgentCapabilitiesDir, "..", ".env")` — this path resolves to `.my_agent/.env`, but the actual env file is at `packages/dashboard/.env`. When `.my_agent/.env` is absent, `scanCapabilities` receives a non-existent path. The scanner handles this gracefully (it checks existence before reading), but the path construction looks unintentional. The plan's spec template used `packages/dashboard/.env`. This has no practical impact today since `browser-chrome` does not declare any `requires.env` fields, but it would silently cause `unavailable` status for any plug that does.

---

## 4. Test Quality Notes

- 58 new targeted tests across 6 files. All pass.
- 290 total capability tests pass (2 pre-existing skips).
- Test stubs for `CapabilityRegistry` in `resilience-copy.test.ts` are minimal and correct — they satisfy only the interface methods called, without type-casting headaches.
- `registry-multi-instance.test.ts` has 23 tests. The coverage across `isMultiInstance` and `getFallbackAction` is thorough: known type, unknown type, frontmatter-set, no-frontmatter, empty registry.
- `invoker.test.ts` named-instance tests use real temp scripts (not mocks) — this tests the actual `execFile` path. Strong.
- `resilience-messages-terminal.test.ts` covers all 6 well-known types including the multi-instance `browser-control` case (single and multi). The "unknown type" case at the end is a good regression guard.

---

## 5. Architecture and Design Assessment

The factory pattern is the right call. `createResilienceCopy(registry)` is:
- Testable without mocking (stub registry is 3 lines)
- Boot-time wired without module-level state
- Consistent with `CapabilityInvoker` (S10) and `createMcpCapabilityCfrDetector` (S12)

The frontmatter-driven `fallback_action` + `multi_instance` scanner fields follow the "markdown is source of truth" principle correctly. The scanner change is minimal: two one-liners at the capability construction block.

`isMultiInstance`'s `WELL_KNOWN_MULTI_INSTANCE` safety net is sound. The comment in registry.ts documents the semantic clearly.

The `emitAck` bug fix (D5/D6) is justified and correctly scoped. Bundling a bug fix from S13 into S14 is appropriate when it was only surfaced by the S14 change (new `terminal-fixed` branch revealed the gap).

---

## 6. Summary of Required Actions Before Next Merge

| # | Priority | File | Change |
|---|---|---|---|
| 1 | Important | `ack-delivery.ts` | Add `"terminal-fixed"` to `isTerminalKind` |
| 1b | Important | `ack-delivery.ts` | Fix `buildRecoveryBody` to treat `"terminal-fixed"` as recovery (not surrender) |
| 2 | Suggestion | `resilience-messages-coverage.test.ts` | Add raw-type non-match assertion in dynamic loop |

Issue 1 is the only functional gap introduced in this sprint. It does not affect live user experience (conversation-origin acks are correct) but would cause silent data loss in automation job debrief records when a capability recovers via the reverify path.

---

*Review date: 2026-04-18*
*Branch: sprint/m9.6-s14-friendly-names*
*Reviewer model: claude-sonnet-4-6*
