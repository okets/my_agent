# S14 Deviations

## DEV-1: AckDelivery.writeAutomationRecovery widened to accept "terminal-fixed"

**Spec:** Not explicitly scoped to Task 5.

**What happened:** The TypeScript compiler flagged a type mismatch in app.ts when the new `terminal-fixed` AckKind branch was wired into `emitAck`. The orchestrator's `writeAutomationRecovery` dep signature already declared `"terminal-fixed"` as a valid outcome (S13), but `AckDelivery.writeAutomationRecovery()` and `buildRecoveryBody()` in ack-delivery.ts only accepted `"fixed" | "surrendered"`.

**Resolution:** Widened both type signatures to `"fixed" | "terminal-fixed" | "surrendered"`. The value flows through to the CFR_RECOVERY.md frontmatter `outcome:` field as-is, which is correct — `terminal-fixed` is a distinct outcome meaningful to post-hoc analysis.

**Impact:** No behaviour change; dashboard and core type-check clean.
