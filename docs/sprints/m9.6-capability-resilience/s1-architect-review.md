# S1 Architect Review — Raw Media Persistence + CFR Detector

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s1-raw-media-cfr-detector`
**Review date:** 2026-04-15
**Plan reviewed against:** [`plan.md`](plan.md) §2 and §3

---

## Verdict: **APPROVED with two small fixes before merge**

S1 delivers its scope. Shared contracts match the plan field-for-field. CFR emission is correctly placed at chat-service (B1 resolution honored). Raw-media persistence lands at the right layer (deviation D1 is justified and I accept it — the plan itself provided the escape hatch). 42/42 tests pass, both packages compile clean, `.my_agent/` untouched, no `systemctl restart` introduced anywhere.

Two small gaps I want fixed on this branch before S2 starts. Both are low-risk; neither is a re-plan.

---

## What I checked (beyond the self-review)

### Plan ↔ code audit

| Plan item | Location | Status |
|-----------|----------|--------|
| §2.1 `cfr-types.ts` field-for-field | `packages/core/src/capabilities/cfr-types.ts:6-67` | Matches exactly, including the `parentFailureId` for nesting, `SurrenderScope`'s `expiresAt`, and `FixAttempt`'s `phase: "execute" \| "reflect"` |
| §2.2 `TurnCorrectedEvent` | `packages/dashboard/src/conversations/transcript.ts:24-31` | Added in fixup `e11ef0f` — field shape correct, JSDoc names S5 as consumer |
| §3.1 `RawMediaStore` | `packages/dashboard/src/media/raw-media-store.ts` | `save` / `pathFor` / `exists` all match. Extension table covers `.ogg/.mp3/.wav/.jpg/.png` explicitly and falls through to sub-type or `.bin` — plan-compliant |
| §3.2 `classifySttError` / `classifyEmptyStt` | `packages/core/src/capabilities/failure-symptoms.ts` | Signatures match. Thresholds strict-`>` not `>=`. Edge case `capExists && capEnabled && "No audio-to-text capability available"` → `execution-error` is a sensible interpretation of a status-stale capability |
| §3.3 `CfrEmitter` | `packages/core/src/capabilities/cfr-emitter.ts` | Auto-fills `id` / `detectedAt` / `attemptNumber:1` / `previousAttempts:[]`. Overload for `on("failure", …)` is type-safe |
| §3.5 message-handler `rawMediaPath` threaded | `packages/dashboard/src/channels/message-handler.ts:479-501`, `:547` | Persistence happens after conversation resolution and before `sendMessage` — plan's invariant preserved |
| §3.6 chat-service deps guard CFR | `chat-service.ts:592-600` | Fires before the save-branch bypass. Correct |
| §3.6 chat-service STT error CFR | `chat-service.ts:677-691` | Uses `classifySttError` with `!!cap` / `!!cap?.enabled`. Correct |
| §3.6 chat-service empty-STT CFR | `chat-service.ts:694-708` | Calls `classifyEmptyStt` with `undefined` duration/confidence — correctly null-returns in S1, activates in S6 |
| §3.6 `detectCapabilityTypeFromMimes` | `chat-service.ts:118-126` | `audio/*` / `image/*` / else-handler — matches |
| `App` wiring | `app.ts:377-390` | `cfr!: CfrEmitter` / `rawMediaStore!: RawMediaStore` non-null after fixup `e11ef0f`. Constructed unconditionally |
| Core exports | `packages/core/src/lib.ts:259-261`, `src/capabilities/index.ts:7-15` | All CFR types + `CfrEmitter` + classifiers re-exported at both layers |

### Compile + tests

```
cd packages/core && npx tsc --noEmit          → clean
cd packages/dashboard && npx tsc --noEmit     → clean
cd packages/dashboard && npx vitest run tests/cfr → 42/42 passed
```

### Deviation D1 assessment

Accepted. The plan's §3.4 explicitly said *"If threading adds >30 lines, file a deviation proposal."* The implementer invoked that escape hatch with a short, honest DEVIATIONS entry. The alternative paths considered are real (staging-path rename vs. fragile JID-keyed setter). Moving to message-handler preserves the invariant *"persist every inbound media buffer before any downstream processing (STT, deps check)"* — the buffer is on disk before `sendMessage` is called. D2–D4 follow mechanically from D1 and are correct.

What I re-verified independently: the WhatsApp plugin at `plugins/channel-whatsapp/src/plugin.ts:460-486` always fires `this.handlers.message(incoming)` after downloading the buffer. There's no plugin-layer filter that drops voice notes before the handler runs. So D1 doesn't leak media that the plan promised to persist.

---

## Gaps — fix before merge

### F1: Multi-attachment messages only persist the first buffer

**File:** `packages/dashboard/src/channels/message-handler.ts:490-498`

```typescript
} else if (first.attachments?.length) {
  const firstAtt = first.attachments[0];
  rawMediaPath = await this.deps.app.rawMediaStore.save(...);
}
```

If a user sends three images in one WhatsApp message, `first.attachments` has 3 entries but only `[0]` is saved to `raw/`. The plan's B2 promise was *"every inbound audio/image buffer"*. This breaks that.

Fix: iterate `first.attachments` and save each; record all paths. Since `ChatMessageOptions.rawMediaPath` is currently singular, either (a) promote it to `rawMediaPaths: string[]` or (b) keep the first path there and note in DECISIONS.md that S4's re-verify will only know the first.

I'll accept (b) for S1 scope — promoting the shape ripples into `TriggeringInput.artifact` which is a shared contract and we don't want to touch that now. Iterate and save, keep the first as `rawMediaPath` for the CFR event, write the rest to disk anyway so S4 can find them via directory listing if needed.

**Estimated effort:** ~10 lines + a test that sends 2 images and asserts both files exist.

### F2: No wiring test for image persistence path through message-handler

**Evidence:** `cfr-emit-deps-missing.test.ts` covers PDF (falls through to `attachment-handler`) and audio. No image case. Combined with F1, this is how the multi-attachment bug slipped through.

Fix: add one test to `cfr-emit-deps-missing.test.ts` — two-image attachment → asserts both files under `conversations/<convId>/raw/` exist and the CFR event's `artifact.type === "image"`.

**Estimated effort:** ~15 lines.

---

## Gaps — defer (file as S1 FOLLOW-UPs, address in later sprints)

### FU1: Dashboard-origin media never lands in `raw/`

**Severity:** Minor.

`options.rawMediaPath` is only set by message-handler (channel layer). Dashboard WS uploads go through `AttachmentService` only. If an S4 CFR fires for a dashboard-origin audio failure (unlikely post-S2 but possible for `empty-result` symptom), `TriggeringInput.artifact.rawMediaPath` is undefined. S4's re-verifier will need an AttachmentService fallback.

**Action:** add a line to `s1-FOLLOW-UPS.md` under F4 and reference it from S4's reverify spec.

### FU2: Test brittleness — `makeTestApp` reaches live `.my_agent/` via SessionManager

**Severity:** Minor.

Self-review already flagged. Agreed: the test catches the auth error with try/catch, so it passes even without an SDK session. But the test has an implicit dependency on `findAgentDir`'s behavior. Extracting a lighter `AppChatService` stub that exercises only the attachment/CFR branch would be cleaner.

**Action:** captured in the existing `s1-review.md` suggestion. Leave for when S5/S6 write similar tests.

### FU3: Plugin-layer download failure has no CFR path

**Severity:** Minor.

If Baileys `downloadMediaMessage` throws (network, auth), `audioBuffer` is undefined and the plugin sets content to `"[Voice note — failed to download audio]"` (plugin.ts:519). Message-handler receives no `audioAttachment`. No CFR fires because there's no capability involved — it's a transport failure.

This is one level up from capability failures; the CFR taxonomy doesn't cover `transport-failure` today. Fine for M9.6 but flag for M10 channel SDK design: transport-failure should probably emit a sibling event to CFR so the user isn't silently told "voice note download failed".

**Action:** add a cross-reference from `s1-FOLLOW-UPS.md` to M10's planning doc.

### FU4: Debounced batches of multiple voice notes lose all but the first

**Severity:** Minor (pre-existing behavior).

`ChannelMessageHandler.handleMessages` debounces messages by party. The batch is represented as `first` + `messages[]` for text content, but only `first.audioAttachment` is threaded through. If the user sends three consecutive voice notes inside the debounce window, voices 2 and 3 are lost at the channel layer — pre-existing bug, not introduced by S1.

**Action:** note as a known limitation for S5's orphan-watchdog work. If voice #2/#3 don't even reach message-handler, the orphan-watchdog can't rescue them on reboot.

---

## Nitpicks (no action required)

- **N1:** `convId!` non-null assertion at three sites (`chat-service.ts:598, 690, 705`). A `const resolvedConvId = convId;` after the auto-create block at line 521 would eliminate the assertions cleanly. Leave for S4, which touches this area anyway.
- **N2:** `buildTriggeringInput`'s fallback channel at line 135-139 silently stamps `dashboard` when `options.channel` is missing. Fine for now; S6's `AckDelivery` will need to branch on `transportId === "dashboard"` vs channel-id anyway and can surface any edge case then.
- **N3:** Image rawMediaStore attachmentId is `${first.id}-${firstAtt.filename}` (noted as F3 in `s1-FOLLOW-UPS.md`). Fine.

---

## Paper-trail check

- `s1-DECISIONS.md` — present, all four judgment calls documented with rationale.
- `s1-DEVIATIONS.md` — present. D1 well-argued with real options and concrete blast-radius analysis. "Self-answered" flag is honest.
- `s1-FOLLOW-UPS.md` — present, three items. After F1/F2 fixes I'd like to see FU1–FU4 added so S4 and S5 pick them up.
- `s1-review.md` — present. External reviewer caught the two real blockers (TurnCorrectedEvent missing, rawMediaStore nullability) and got them fixed in `e11ef0f`.
- `s1-test-report.md` — present, command-output-level honest.

Commit hygiene: six commits, conventional-style, no `--amend`, no `--no-verify`. Each commit is a logical unit.

---

## What to do next

1. **Implementer:** fix F1 and F2 on this branch. Push two small commits (`feat(m9.6-s1):` for the iteration fix, `test(m9.6-s1):` for the image wiring test). Add FU1–FU4 to `s1-FOLLOW-UPS.md`.
2. **Implementer:** rename `s1-*.md` files to live under a `s1/` subfolder, matching the convention of previous sprints (see `docs/sprints/m9.5-s7-browser-capability/` which has `plan.md`, `review.md`, `DECISIONS.md` etc. at the top level of the sprint folder). Actually — previous sprints use a single-sprint-per-folder layout. Since M9.6 has multiple sprints under one folder, the `s1-`, `s2-` prefixing is fine; leave as-is.
3. **Architect (me):** re-review the F1/F2 fixes when pushed. If clean, approve for merge to master.
4. **After merge:** S2 (deps wiring at App boot) can proceed. S2 touches `app.ts`, `ws/chat-handler.ts`, `IdleTimerManager` — disjoint from anything S1 touched.

## Assessment of D1 — one more note for the next sprint

The move from plugin to message-handler is the *right* long-term placement. Future channel plugins (M10 — Telegram, Discord, Line, agent-authored) will benefit from not needing to know about RawMediaStore. When M10-S1 defines the Channel SDK, this placement becomes formal: *plugins produce buffers; the framework persists them via message-handler, always*. Add a comment in `message-handler.ts` near the persistence block to lock this rule in, e.g.:

```typescript
// RawMediaStore writes happen here (framework layer), NOT in plugins.
// Plugins are transport-only; they download buffers and fire incoming events.
// The framework is responsible for disk persistence before any downstream
// processing. See docs/design/capability-resilience.md §Red-Team Resolutions B2.
```

That's a nice-to-have — do it as part of the F1 fix commit.

---

**Approved pending F1 + F2. Ping when pushed.**
