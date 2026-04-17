# S9 Decisions

**Sprint:** M9.6-S9 — TriggeringOrigin type landing
**Branch:** sprint/m9.6-s9-triggering-origin
**Date:** 2026-04-17

---

## D1 — `SurrenderScope` stays flat

`SurrenderScope` in `cfr-types.ts` still carries flat `conversationId` and `turnNumber` fields. The plan says only `TriggeringInput` gets the `origin` union. `SurrenderScope` is always conversation-scoped (surrender is a per-conversation concept), so keeping it flat is correct and avoids unnecessary churn.

**Decision:** leave `SurrenderScope` as-is.

---

## D2 — `buildTriggeringInput` helper updated to return nested origin

`chat-service.ts` has a `buildTriggeringInput()` local helper that constructs `TriggeringInput`. Updating it to produce `origin: { kind: "conversation", ... }` is the cleanest way to rewrap all three emit sites in one shot — rather than touching each call site individually.

**Decision:** update `buildTriggeringInput()` signature and body; all three chat-service emit sites inherit the fix automatically.

---

## D3 — Design v2 §5 coverage matrix verified correct

Checked `docs/design/capability-resilience-v2.md` §5 (coverage matrix). The `image-to-text` row correctly shows `RESTORED_WITH_REPROCESS` when triggering image available, `RESTORED_TERMINAL` otherwise — the inconsistency was in the v2.3 plan (now superseded), not in v2. No code change needed.

**Decision:** no correction required; noted here per plan §2.1 guidance.
