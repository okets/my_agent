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
