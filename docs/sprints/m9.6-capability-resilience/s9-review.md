---
sprint: M9.6-S9
title: TriggeringOrigin type landing + matrix correction
reviewer: External auditor (dev-contracted)
review_date: 2026-04-17
recommended: APPROVE
note: This is the dev-contracted external auditor's read. Informational only — the binding architect review is in s9-architect-review.md.
---

# S9 External Auditor Review

**Sprint:** M9.6-S9 — `TriggeringOrigin` type landing + matrix correction
**Branch:** `sprint/m9.6-s9-triggering-origin`
**Reviewed:** 2026-04-17
**Verdict:** APPROVED

---

## Spec compliance checklist

### `TriggeringOrigin` union — PASS

Three variants present with correct fields:
- `conversation` → `channel: ChannelContext`, `conversationId: string`, `turnNumber: number`
- `automation` → `automationId: string`, `jobId: string`, `runDir: string`, `notifyMode: "immediate" | "debrief" | "none"`
- `system` → `component: string`

All fields match §3.2 exactly. The `ChannelContext` interface is well-formed: `transportId`, `channelId`, `sender` required; `replyTo`, `senderName`, `groupId` optional.

### `TriggeringInput.origin` replaces flat fields — PASS

`TriggeringInput` now has `origin: TriggeringOrigin` plus `artifact?` and `userUtterance?`. The old flat `channel`, `conversationId`, and `turnNumber` fields are absent from the type. Verified by `@ts-expect-error` tests in `cfr-types-origin.test.ts` and by running `tsc --noEmit` on both packages with zero errors.

### `cfr-helpers.ts` with `conversationOrigin()` factory — PASS

File exists at `packages/core/src/capabilities/cfr-helpers.ts`. Factory signature: `conversationOrigin(channel: ChannelContext, conversationId: string, turnNumber: number): TriggeringOrigin`. Returns `{ kind: "conversation", channel, conversationId, turnNumber }`. Correct.

### Emit-site rewraps — PASS

All 4 sites rewrapped:

1. `chat-service.ts:597` (deps-missing emit) — routed through `buildTriggeringInput()` which calls `conversationOrigin()` internally. D2 (DECISIONS.md) records the decision to update the helper rather than each call site — this is the correct mechanical approach.
2. `chat-service.ts:689` (STT error emit) — same `buildTriggeringInput()` path.
3. `chat-service.ts:704` (empty-result emit) — same.
4. `orphan-watchdog.ts:424` (synthetic failure) — inline `conversationOrigin(...)` call with explicit fields. Correct.

No emit site constructs a `TriggeringInput` with the old flat shape. TypeScript confirms this at compile time.

### Consumer-site narrowings — PASS

All 5 consumer sites verified:

1. **`recovery-orchestrator.ts`** — Two access points, both guarded. `handle()` at line 101: `if (origin.kind !== "conversation") throw new Error("unreachable in S9...")`. `recordSurrender()` at line 190: same pattern. Fields `conversationId` and `turnNumber` only accessed after narrowing to `"conversation"`. PASS.

2. **`ack-delivery.ts`** — Guard at line 71: `if (origin.kind !== "conversation") throw ...`. Accesses `origin.channel` and `origin.conversationId` only after the guard. PASS.

3. **`reverify.ts`** — No narrowing needed and none present. Confirmed correct: the function accesses only `failure.triggeringInput.artifact?.rawMediaPath`, which is a top-level field present on all `TriggeringInput` values regardless of origin kind. PASS.

4. **`app.ts` (~740–760)** — Two access points:
   - Logging at line 700–701: `_origin.kind === "conversation" ? _origin.conversationId : "(non-conversation)"` — properly guarded ternary.
   - Surrender event write at line 721–724: `if (_surrenderOrigin.kind !== "conversation") throw ...` before destructuring `{ conversationId, turnNumber }`. PASS.
   - `reprocessTurn` at line 749–752: `if (origin.kind !== "conversation") throw ...` before destructuring `{ conversationId, turnNumber, channel }`. PASS.

5. **`orphan-watchdog.ts` re-processor** — The `tryReverifyAudioOrphan()` method constructs a synthetic failure with `conversationOrigin(...)` then passes it to `this.config.reverify(synthetic)`. The reverify function only reads `artifact?.rawMediaPath` — no origin narrowing required in the re-processor itself. PASS.

No unguarded access to variant-specific fields found. Searched all relevant source files for `origin.conversationId`, `origin.turnNumber`, `origin.channel`, `origin.automationId`, `origin.jobId`, `origin.runDir`, `origin.component` — only one occurrence found (the guarded ternary in `app.ts:701`). Also searched for old flat-field access (`triggeringInput.channel`, `triggeringInput.conversationId`, `triggeringInput.turnNumber`) — zero hits.

### Exports from `lib.ts` and `capabilities/index.ts` — PASS

`lib.ts` exports:
- `conversationOrigin` (value) ✓
- `ChannelContext`, `TriggeringOrigin`, `TriggeringInput` (types) ✓

`capabilities/index.ts` exports:
- `ChannelContext`, `TriggeringOrigin` (types) ✓
- `conversationOrigin` (value, re-exported from `cfr-helpers.js`) ✓

### New test `cfr-types-origin.test.ts` — PASS

Five tests covering:
1. `conversationOrigin()` factory shape — PASS
2. `TriggeringInput` accepts `origin` + `artifact`, `@ts-expect-error` rejects old flat fields — PASS (compile-time enforcement)
3. Switch exhaustiveness across all three variants with `assertNever` — PASS
4. Automation variant field shape — PASS
5. System variant field shape — PASS

All 5 tests green.

### `DECISIONS.md` and `DEVIATIONS.md` — PASS

Both files present at `docs/sprints/m9.6-capability-resilience/`:
- `s9-DECISIONS.md` — three decisions recorded: D1 (`SurrenderScope` stays flat — correct, surrender is inherently conversation-scoped), D2 (`buildTriggeringInput` helper updated in one shot), D3 (v2 coverage matrix confirmed correct, no code change needed).
- `s9-DEVIATIONS.md` — no deviations recorded. Correct: the sprint was mechanical and clean.

### §5 coverage matrix correction — PASS

D3 confirms the matrix in `capability-resilience-v2.md` §5 is already correct. The inconsistency was in the superseded v2.3 plan. No correction to source files required. Noted correctly per spec guidance.

---

## Gaps and observations

**No gaps found.**

One observation worth noting for S12: the "unreachable in S9" throws are correctly positioned as early-return guards, not as `default` branches inside switch statements. This is fine — pattern is consistent across all four consumer files and communicates intent clearly. S12 will replace them with real routing branches.

`SurrenderScope` retaining flat `conversationId` and `turnNumber` fields (D1) is intentional and correct — the type is always conversation-scoped by design, and widening it to carry a `TriggeringOrigin` would add complexity with no benefit.

---

## Universal coverage check

N/A. This is a type-landing sprint only. No new detection layer was added. No plug type is "missed" because the work is purely structural — it repackages how origin context is carried, not how failures are detected. Confirmed: zero behavior change.

---

## Verdict

**APPROVED.** Sprint S9 is a clean, zero-behavior-change type migration. Every checklist item passes. TypeScript enforces the narrowing requirements at compile time. Phase 1 tests pass unchanged. S10 and S12 are unblocked.
