# S2 Deviations

**Sprint:** M9.6-S2 — Deps wiring at App boot
**Date:** 2026-04-15
**Implementer:** Claude Sonnet 4.6 on sprint branch `sprint/m9.6-s2-deps-boot-wiring`

---

No deviations filed. Sprint implemented as written in plan.md §4.

All plan requirements satisfied:
- `IdleTimerManager` uses callback (b) — `getViewerCount: (id: string) => number`
- `setViewerCountFn()` setter added; WS handler calls it on first connect
- Module-level singletons removed from `chat-handler.ts`
- First-connect init block removed
- `app.chat.setDeps()` call removed from WS handler
- `App.create()` wires deps after `app.chat = new AppChatService(app)`

One additive choice (D1 in DECISIONS.md): also exposed `idleTimerManager` and `attachmentService` as App fields. This was required to fix two remaining references in `deleteConversation` that the plan's listed removals did not mention. Not a deviation — it's mechanically required by the removal, and does not touch any files outside the sprint's declared file set.
