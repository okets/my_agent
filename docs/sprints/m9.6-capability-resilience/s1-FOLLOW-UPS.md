# S1 Follow-Ups

**Sprint:** M9.6-S1 — Raw Media Persistence + CFR Detector

Items noticed during implementation that are out of scope for S1. Do not fix these now.

---

## F1: `transcribeAudio` doesn't return `durationMs` or `confidence`

**File:** `packages/dashboard/src/chat/chat-service.ts:938-958`

The `transcribeAudio()` method currently returns `{ text?, language?, error? }` only. `classifyEmptyStt()` requires `durationMs` and `confidence` to detect broken capabilities (vs. genuine silence). In S1, these are `undefined`, so `classifyEmptyStt` always returns `null`.

The plan acknowledges this: "Empty-result detection comes alive in S6."

**Action needed in S6:** Update the STT script contract to emit `durationMs` and `confidence` in its JSON output, and update `transcribeAudio()` to pass them to `classifyEmptyStt()`.

---

## F2: `CfrEmitter` has a no-op listener; the recovery orchestrator (S4) wires it

The S1 `CfrEmitter` emits `failure` events to nothing. Until S4 wires a real handler, CFR events are fire-and-forget. This is intentional per the sprint plan.

No action needed until S4.

---

## F3: Image attachments use composite key `${first.id}-${firstAtt.filename}`

**File:** `packages/dashboard/src/channels/message-handler.ts:~490`

For images, the `attachmentId` used in `rawMediaStore.save()` is `${first.id}-${firstAtt.filename}`. This works but creates a slightly different key format than voice notes (which use `first.id` alone). A future cleanup could normalize to always use `first.id` for the base key.

Out of scope for S1. Noting for the next media-related sprint.

---

## FU1: Dashboard-origin media never lands in `raw/`

`options.rawMediaPath` is only set by message-handler (channel layer). Dashboard WS uploads go through `AttachmentService` only. If an S4 CFR fires for a dashboard-origin audio failure (unlikely post-S2 but possible for `empty-result`), `TriggeringInput.artifact.rawMediaPath` will be undefined.

**Action in S4:** S4's re-verifier should include an `AttachmentService`-path fallback when `rawMediaPath` is absent but a saved attachment path exists.

---

## FU2: `makeTestApp` in CFR tests reaches live `.my_agent/` via SessionManager

`cfr-emit-deps-missing.test.ts` uses a real `AppChatService` which initializes `SessionManager` against the live agent directory during the test. The test catches the resulting auth error, so it passes, but the implicit dependency on `findAgentDir` makes it fragile in CI.

**Action in S5/S6:** Extract a lighter stub for the attachment/CFR path that stops before session management when writing similar tests.

---

## FU3: Plugin-layer download failure has no CFR path

If Baileys `downloadMediaMessage` throws (network / auth), `audioBuffer` is undefined and the plugin emits `"[Voice note — failed to download audio]"`. No CFR fires because there is no capability involved — it's a transport failure.

The CFR taxonomy covers capability failures; transport failures are a sibling concern not in scope for M9.6.

**Action in M10:** When designing the Channel SDK, add a `transport-failure` event alongside CFR so users are not silently told "voice note download failed" with no recovery path.

---

## FU4: Debounced batches of multiple voice notes lose all but the first

`ChannelMessageHandler.handleMessages` represents a debounced batch as `first` + `messages[]`. Only `first.audioAttachment` is threaded through to message-handler. If a user sends three consecutive voice notes within the debounce window, voices 2 and 3 are dropped at the channel layer — pre-existing behavior, not introduced by S1.

**Action in S5:** Note this as a known limitation for the orphan-watchdog design. Voice notes 2/3 that never reach message-handler cannot be rescued on reboot.
