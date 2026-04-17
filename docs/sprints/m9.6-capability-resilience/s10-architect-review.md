---
sprint: M9.6-S10
title: CapabilityInvoker + exec-bit validation — architect review
architect: Opus 4.7 (Phase 2 architect)
review_date: 2026-04-17
verdict: CONDITIONAL — one dev cleanup before merge
---

# S10 Architect Review

**Sprint:** M9.6-S10 — `CapabilityInvoker` + exec-bit validation
**Branch:** `sprint/m9.6-s10-capability-invoker`
**Implementer commits:** `3b337ba feat(m9.6-s10): CapabilityInvoker — single gate for script-plug invocations` + `59a6ff4 fix(m9.6-s10): address auditor conditions C1 + C2`
**External auditor:** dev-contracted, recommended CONDITIONAL with C1+C2 — both addressed in `59a6ff4` before architect review.
**Reviewed:** 2026-04-17
**Verdict:** **CONDITIONAL — one dev cleanup before merge.** Sprint work is sound; one mis-numbered TTS marker in chat-service.ts must be corrected by the dev. The dev wrote `TODO(S13/S17)` because they missed plan-correction `d17cb64`; correct value is `TODO(S15/S18)`. Trivial fix; see §7 for the exact change. After dev commits the fix, re-notify the architect for final approval and merge.

---

## 1. Sprint goal vs. delivered

**Goal (per `plan-phase2-coverage.md` §2.2):** single gate for script-plug invocation. Every script-plug call emits CFR automatically on failure. Drop the `bash` wrapper inherited from Phase 1 reverify. First sprint where the §0.1 universal-coverage rule starts biting.

**Delivered:** matches goal. `CapabilityInvoker.run()` implements the 6-symptom matrix end-to-end. `transcribeAudio()` routes through the invoker. `reverifyAudioToText()` uses the invoker when available with documented fallback path for legacy tests. Exec-bit validation lands in scanner via `test-harness.ts:validateScriptExecBits()`. `classifySttError` removed. App boot wires `app.capabilityInvoker`.

---

## 2. Independent verification gates

I re-ran every gate I committed to in S10 advice. All pass.

### TypeScript compilation

| Package | Command | Exit | Result |
|---------|---------|------|--------|
| `packages/core` | `npx tsc --noEmit` | 0 | PASS — zero errors |
| `packages/dashboard` | `npx tsc --noEmit` | 0 | PASS — zero errors |

### Tests

| Suite | Files | Tests | Passed | Skipped | Result |
|-------|-------|-------|--------|---------|--------|
| `packages/core/tests/capabilities` + `tests/conversations` | 31 | 187 | 185 | 2 (pre-existing) | PASS |
| `packages/dashboard/tests/cfr` | 4 | 35 | 35 | 0 | PASS |
| New: `invoker.test.ts` | 1 | 9 | 9 | 0 | PASS |
| New: `exec-bit-validator.test.ts` | 1 | 8 | 8 | 0 | PASS |
| New: `invoker-timeout-fallback.test.ts` (auditor C2 fix) | 1 | — | — | — | PASS (rolled into the 187 above) |

The 2 skipped tests are pre-existing (`orchestrator-reverify-integration.test.ts` — already skipped since S4 pending S13 invoker migration; FU-2 will close).

### Watchpoint checks (from S10 advice)

| Watchpoint | Check | Result |
|---|---|---|
| `originFactory` ambiguity resolved sensibly | Read invoker.ts + D1 | PASS — D1 documents the decision (factory carried in deps for S12 forward-compat; not called in S10 because callers pass `triggeringInput` with origin already populated). Acceptable; aligns with my pre-sprint guidance that either resolution is fine if documented. |
| Exec-bit validator doesn't break Phase 1 fixtures | All Phase 1 STT tests pass (regression gate above) | PASS — validator gates on `data.interface === 'script'` (scanner.ts:183), so MCP-interface caps are unaffected; installed STT plug ships with exec bit set. |
| TTS deferral named per §0.1 | Read `s10-FOLLOW-UPS.md` FU-1 | PASS — FU-1 names type, reason, and receiving sprint. Body explicitly invokes the §0.1 rule. |
| `classifySttError` removal — zero callers | `rg "classifySttError" packages/` | PASS — single hit is a "removed" tombstone comment in `failure-symptoms.ts:4`; zero code-level references. The dashboard `cfr-emit-stt-errors.test.ts` was deleted (D4); its scenarios are subsumed by `invoker.test.ts`. |
| `execFile("bash", ...)` removed from invoker code path | `rg 'execFile\\(["\\x60]bash' packages/core/src/capabilities/` | PASS in invoker.ts (uses direct `execFile(scriptPath, args)` per D5). Three remaining hits are documented or pre-existing: `reverify.ts:176` is the D3 fallback (FU-2 closes in S13); `test-harness.ts:76` and `:260` are the legacy `testCapability()` health-check path (pre-S10, not part of script-plug invocation chain — see §4.3 below). |
| TODO marker uses corrected `S15/S18` | `rg "TODO\\(S" packages/` | **FAIL — minor.** Marker at `chat-service.ts:1073` reads `TODO(S13/S17)`. Dev missed my `d17cb64` plan correction. Cleanup in this architect commit. |
| No drive-by in reverify.ts | Read diff of reverify.ts | PASS — only the invoker-aware path was added; legacy fallback preserved as planned per D3. No state-machine adjacent edits. |
| Process compliance (per §0.3) | Inspect commits + s10-review.md frontmatter | PASS — auditor artifact correctly named "External auditor (dev-contracted)" with `recommended: CONDITIONAL`; no premature `APPROVED` commits in branch history; dev addressed conditions before notifying CTO. **§0.3 took.** |

---

## 3. Auditor conditions (verified resolved)

The dev-contracted auditor flagged two conditions before merge:

### C1 — Multi-instance silent first-pick (resolved in `59a6ff4`)

**Verified:** `invoker.ts:79` reads `const cap = allCaps.find(c => c.enabled && c.status === "available") ?? allCaps[0];`. Granular checks (`cap.enabled === false → not-enabled`; `cap.status !== "available" → execution-error`) still emit the correct per-instance symptom by falling back to `allCaps[0]` when no enabled+available exists. Test added per spec (will verify against `invoker.test.ts` updates).

The auditor recommended adding **FU-4** (named-instance selection parameter `capabilityName?: string`) for future sprints. Dev added it. **See §6.1 below — I'm adding the deferred work to S14 plan per CTO deferral rule.**

### C2 — Timeout string-fallback test missing (resolved in `59a6ff4`)

**Verified:** `invoker-timeout-fallback.test.ts` exists (104 lines). Mocks `execFile` to throw a message-only timeout error (no `killed` flag, no `ETIMEDOUT` code) and asserts the symptom is correctly classified as `"timeout"` via the string-match fallback at `invoker.ts:117`.

Both conditions resolved before architect review. Auditor recommendation honored.

---

## 4. Code quality observations

### 4.1 D1 — `originFactory` carried-but-unused

Acceptable. The dev's reasoning matches my pre-sprint guidance: factory in the constructor surface lets S12 wire automation-origin without a class-interface change. Cost is one unused field; benefit is no migration churn. **Approved.**

The `app.ts:542-546` placeholder origin (`{kind: "conversation", channel: ..., conversationId: "", turnNumber: 0}`) is a flag for S12 — auditor C4 noted this. S12 must replace with real per-session context from the brain's session-manager view-context. I'll call this out in S12 advice.

### 4.2 D2 — TTS not wired (the §0.1 forced disclosure)

The disclosure in FU-1 is exactly the shape §0.1 prescribes: type, reason, receiving sprint. No silent skip. **The universal-coverage rule worked on its first real test.**

### 4.3 D3 + FU-2 — legacy bash wrapper in `reverify.ts:176` and `test-harness.ts:76,260`

Three `execFile("bash", ...)` call sites remain. Categorized:

- **`reverify.ts:176`** — the documented fallback for tests that don't wire the invoker. D3 + FU-2 explicitly track removal in S13 when reverify dispatcher migration completes. **Acceptable.**
- **`test-harness.ts:76`** — `bash detect.sh` for capability scanning at registry-load time. Pre-existing (Phase 1). Not part of script-plug *invocation* (`detect.sh` is part of capability *discovery*). Outside S10 scope. Could be folded into invoker as a hardening item but not required.
- **`test-harness.ts:260`** — `bash <scriptPath> <fixturePath>` in legacy `testCapability()` health-check loop. Pre-existing (Phase 1). Outside S10 scope.

I will **not** add a follow-up for `test-harness.ts` bash wrappers — they're outside the "every script-plug invocation routes through the invoker" coverage rule (those calls are framework-internal health probes, not user-turn capability invocations). If S13 / S15 exit-gate work surfaces a need to fold them in, file then.

### 4.4 D5 — `execFile` direct, not `bash`-wrapped

Correct architectural call. Dropping the wrapper makes exec-bit a hard requirement, which is exactly what the validator enforces. Plugs that need bash declare `#!/bin/bash` in their shebang. **Approved.**

### 4.5 D6 — Timeout detection via `killed` + code + string fallback

Belt-and-suspenders. The C2 test confirms the string-match fallback works for environments that surface only the message. **Approved.**

### 4.6 FU-3 — "S17 audit of script-interface call sites" — sprint-number drift

FU-3 references S17 (which is reflect-collapse in Phase 3, unrelated). The intent is correct: any future script-interface plug must route through the invoker. But that's not a sprint-specific task — it's the §0.1 rule applied per sprint, and S15's exit gate already exercises every installed plug type which catches the violation if it occurs. **No plan amendment needed; the rule subsumes the FU.** I'll note this in §6.

### 4.7 Test quality

- `invoker.test.ts` — 9 tests cover all 6 symptoms with real temp scripts (timeout, validation-failed, success JSON, success raw, exit-1) and registry fakes for pre-execution paths (not-installed, not-enabled, execution-error/status). The triggeringInput-forwarding test confirms the `cfr.emitFailure` payload shape.
- `exec-bit-validator.test.ts` — 8 tests cover all branches including the MCP-interface guard.
- `invoker-timeout-fallback.test.ts` — covers the C2 string-fallback path with `vi.mock`.

The auditor noted three minor test gaps (cap.name forwarding, multi-line stdout, MCP-interface positive-absence test). I agree they're minor; not required for approval. If S13 dispatcher work touches `runSmokeFixture` or the per-type reverifiers, the dev there should add them.

---

## 5. Universal-coverage check (per §0.1 rule)

S10 added a generic detection layer (`CapabilityInvoker`). Per §0.1, every plug type registered in `.my_agent/capabilities/` at sprint-end must be covered or named.

**Plug types currently installed and their coverage status:**

| Type | Routes through invoker? | Coverage status |
|---|---|---|
| `audio-to-text` (stt-deepgram) | YES (transcribeAudio + reverifyAudioToText) | Covered |
| `text-to-audio` (tts-edge-tts) | NO | **Named in FU-1, deferred to S15/S18** |
| `browser-control` (browser-chrome) | N/A — MCP plug, different gate (S12) | Out of S10 scope — covered by S12 |
| `desktop-control` (desktop-x11) | N/A — MCP plug | Same |

**Verdict:** §0.1 rule compliance is correct. The TTS hole is named, not silent. The MCP plugs are covered by a different gate (S12) which is the architectural decision baked into design v2 §3.1.

---

## 6. Plan amendments (per CTO deferral rule)

### 6.1 Add FU-4 (named-instance invoker selection) to S14 plan

FU-4 says "the work should land in whichever sprint first wires a multi-instance capable caller." S14 explicitly handles multi-instance copy. Adding the parameter to `InvokeOptions` there is the natural fit. **Editing S14 plan section now.**

### 6.2 No amendment for FU-3

FU-3 is subsumed by the §0.1 rule + S15 exit-gate verification. No action.

### 6.3 No amendment for FU-1, FU-2

FU-1 (TTS wiring) is already explicit in S15 (may pre-wire) + S18 (formalize). FU-2 (remove bash fallback) is implicit in S13's invoker refactor of reverify; the dispatcher work removes the fallback as a side effect. **No new plan text needed; both are tracked in the receiving sprint's existing scope.**

---

## 7. Required dev cleanup (one item) before merge

**File:** `packages/dashboard/src/chat/chat-service.ts:1073`

**Current:**
```
   * TODO(S13/S17): route through CapabilityInvoker so TTS failures emit CFR.
   * Deferred per plan-phase2-coverage.md §2.2 — TTS wiring is Phase 3 (S17).
```

**Required:**
```
   * TODO(S15/S18): route through CapabilityInvoker so TTS failures emit CFR.
   * Deferred per plan-phase2-coverage.md §2.2 — S15 may pre-wire if exit gate
   * needs it; S18 (Phase 3, "Duplicate TTS path collapse") formalizes.
```

**Why:** plan-correction commit `d17cb64` (landed during S9 review) renamed the receiving sprint references from S13/S17 to S15/S18. S13 is the reverify dispatcher (not TTS); S17 is reflect-collapse (not TTS). The actual TTS landing sprints are S15 (may pre-wire) and S18 (formalize).

**Commit shape:** `fix(m9.6-s10): correct TODO marker S13/S17 → S15/S18 (per d17cb64)` — single-file, one-line semantic change. After committing, notify the CTO; architect will re-verify and approve for merge.

**Not requiring dev fix** (architect handled): `plan-phase2-coverage.md §2.6 (S14)` was edited by the architect to incorporate FU-4 per CTO deferral rule (architect's responsibility, not dev's). That edit is already in `d2b9ddf`.

**Historical artifacts left as-is:** the same `TODO(S13/S17)` reference appears in `s10-DECISIONS.md` D2 and `s10-FOLLOW-UPS.md` FU-1. Don't edit those — they're the dev's contemporaneous record; the corrected reference lives in the production code marker.

---

## 8. Verdict

**CONDITIONAL.** Sprint work is high-quality. CapabilityInvoker is the architectural keystone for Phase 2 and it's well-built. Auditor conditions resolved cleanly before review. Process compliance per §0.3 is exemplary — clean upgrade from S9.

One trivial dev cleanup required before merge — see §7 (TODO marker correction in chat-service.ts:1073). After dev commits the fix, re-notify the CTO; architect re-verifies and the verdict flips to APPROVED for merge.

S11 and S12 unblocked once merge happens.

---

## 9. Merge guidance

After dev's TODO-marker fix lands and architect re-verifies, sprint branch `sprint/m9.6-s10-capability-invoker` ready to merge to master. Recommended:

```
git merge --no-ff sprint/m9.6-s10-capability-invoker
```

---

*Architect: Opus 4.7 (1M context), Phase 2 architect for M9.6 course-correct*
