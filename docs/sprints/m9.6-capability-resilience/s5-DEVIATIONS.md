# S5 Deviations — Orphaned-Turn Watchdog

Sprint: M9.6-S5
Branch: sprint/m9.6-s5-orphaned-turn-watchdog

---

No CTO-escalation deviations. All deviations were self-answered per sprint protocol.

| # | Plan says | What we did | Reason | Self-answered? |
|---|-----------|-------------|--------|----------------|
| D4 | Add `WatchdogRescuedEvent` / `WatchdogResolvedStaleEvent` to `transcript.ts` | Added to `types.ts`; `transcript.ts` re-exports | Circular import — `types.ts` holds the union | Yes — see DECISIONS.md D4 |
| D5 | Wire watchdog "after the RecoveryOrchestrator block" in app.ts | Wired after ConversationInitiator (~line 889) | Dependencies (`conversationManager`, `conversationInitiator`) not yet in scope at line 626 | Yes — see DECISIONS.md D5 |
