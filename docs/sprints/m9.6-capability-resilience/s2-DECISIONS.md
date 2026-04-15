# S2 Decisions

**Sprint:** M9.6-S2 — Deps wiring at App boot
**Date:** 2026-04-15
**Implementer:** Claude Sonnet 4.6 on sprint branch `sprint/m9.6-s2-deps-boot-wiring`

---

## D1: `idleTimerManager` and `attachmentService` stored as App fields

**Judgment call:** The plan says to construct `IdleTimerManager` and call `app.chat.setDeps()` in `App.create()`. This is correct. But two other places in `chat-handler.ts` also need to reach these objects post-S2:

1. `deleteConversation` uses `idleTimerManager.clear(id)` — previously via the module-level singleton.
2. `deleteConversation` uses `attachmentService.deleteConversationAttachments(id)` — same.

Without App-level fields, the WS handler would need to access them through `app.chat["deps"]` (private field, `any` cast) or a new getter on `AppChatService`. Both are uglier than exposing them as top-level App fields.

**Decision:** Added `app.idleTimerManager: IdleTimerManager | null` and `app.attachmentService: AttachmentService | null` to the App class. Both are set in the boot wiring block alongside `setDeps()`. The WS handler accesses them as `app.idleTimerManager` and `app.attachmentService`.

**Blast radius:** None beyond S2. S4 and S5 do not reference these fields. The fields are simple nullable properties on App, consistent with how `cfr` and `rawMediaStore` were added in S1.

---

## D2: `IdleTimerManager` callback default is `() => 0`

**Judgment call:** The plan says implement approach (b) — replace `ConnectionRegistry` constructor arg with a `getViewerCount` callback. The plan does not specify what the default should be.

**Decision:** Default is `() => 0` (always zero viewers). This means at boot (before any WS connection), idle timers will always fire if a conversation goes idle. This is the **more aggressive** default — it prefers abbreviation over silence. The WS handler upgrades this to the real `registry.getViewerCount` on first connect.

Alternative (always return 1) would suppress all abbreviation until WS connects. Rejected: would cause indefinitely-deferred abbreviation for channel-only workflows with no browser.

---

## D3: `setViewerCountFn` called on every WS connect, not just first

**Judgment call:** The WS handler calls `app.idleTimerManager?.setViewerCountFn(...)` unconditionally on every connection (no "first connect" guard).

**Decision:** Left as-is. Overwriting the callback with the same function reference is harmless, and avoiding a guard flag keeps the code simpler. The callback is always `connectionRegistry.getViewerCount.bind(connectionRegistry)` — the same `connectionRegistry` instance per server lifetime.

---

## D4: `onRenamed` callback stays in WS handler

**Judgment call:** The plan's S2 scope is deps wiring. The `abbreviationQueue.onRenamed` callback fires WS broadcasts (`broadcastToAll`) — it inherently needs `connectionRegistry` and belongs at the adapter layer, not in `App`.

**Decision:** Moved the `onRenamed` wiring out of the `idleTimerManager` init block (which was removed) into its own `if (!fastify.abbreviationQueue.onRenamed)` guard. Same behavior, cleaner structure. No blast radius.
