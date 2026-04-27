---
date: 2026-04-27
status: fix-in-progress
sprint: M9.4-S4.2
related_sprints: [M9.4-S4, M9.4-S4.1]
severity: high
---

# Proactive deliveries dismissed mid-conversation

## Symptom

Across 2026-04-25 → 2026-04-27, both proactive-delivery flavors were dismissed by Conversation Nina rather than presented to the user:

| Date | Time (BKK) | Trigger | What Nina sent (verbatim) |
|---|---|---|---|
| 2026-04-24 | 07:01 | `notify: debrief` morning brief | Clean rendered brief — first turn of fresh convo (CONTROL — works) |
| 2026-04-25 | 07:01 | `notify: debrief` morning brief | *"That's the morning brief workers running for tomorrow — ignoring that, it's background. Back to Shopee — did that App Store link work?"* |
| 2026-04-26 | 07:01 | `notify: debrief` morning brief | *"That's the morning brief workers for tomorrow (April 26) — they'll land in the 7am brief. Nothing to action now."* |
| 2026-04-27 | 07:02 | `notify: debrief` morning brief | *"That's tomorrow's brief workers — they'll land at 7am. Nothing to action now."* + tool-narration leakage |
| 2026-04-27 | 08:04 | `notify: immediate` (relocation session) | *"That's tomorrow's 8am relocation session running in the background — it'll deliver at 8am. All good."* |

Conversation: `conv-01KPYCMD9438AYAKX67BZETHTJ`. Pattern is symmetric across both delivery flavors; dismissal language is consistently "background activity" framing.

## Root cause

Both flavors share the same final hop:

```
notification → heartbeat formatNotification → alert() → injectSystemTurn → [SYSTEM: …] wrap → streamMessage
```

The `[SYSTEM: …]` wrapper makes the model interpret the prompt as **context to factor in**, not **action to perform**. Mid-conversation (after 30+ turns of accumulated topic gravity), the model's conversational momentum overrides the verbatim-framing clause inside the prompt body.

S4 (2026-04-10) and S4.1 (2026-04-20) both fixed data integrity in this pipeline (silent-drop, section preservation, delivery-ack) and both PASSed verification gates — but neither addressed the role-shape of the injection. Production regression resurfaced with a different symptom (dismissal-as-background instead of silent-drop).

## Compounding production-side defects

Surfaced during root-cause investigation:

1. **Worker `deliverable.md` files contaminated** with stream-of-consciousness thinking text. Apr 27 chiang-mai-aqi-worker deliverable opens *"Let me start by checking my todo list.Now let me look at the automation definition.…"* The validator only requires `>= 50 chars`.

2. **CFR-fix automations swept into the debrief queue.** Default `notify` is `debrief`; M9.6 sprints generated `cfr-fix-*` automations whose deliverables flooded April 22's brief to 37,012 chars. They are system-orchestrated repairs, not user-deliverable content.

3. **Haiku condense leaks its own preamble.** Apr 18 brief opened *"I'll help you condense this content to fit within 10,000 characters…"* — Haiku narrating itself.

4. **`Conversation Voice` rule deleted in M6.7 split.** M7-S8 had added a *don't narrate tool usage* section to `standing-orders.md`. Lost during the M6.7 identity/operations split. Without it, Nina defaults to her trained narration behavior. Apr 27 turn 44 is exactly this: *"Let me read both files before editing.Now let me read the expat-tips-worker automation definition…"*.

5. **`Brief Requirements` block in standing-orders is leftover.** Predates the worker scheduling model; today, importance is encoded by *what gets scheduled*. Standing-orders should not duplicate the worker schedule.

## Fix summary

**Design principle promoted:** *Proactive deliveries are user-role action requests, not system-role status notes.*

Past-Nina, when she scheduled the brief or the relocation session, was effectively asking future-Nina to deliver something at that time. The injection should speak in that voice — "Nina, it's brief time, present today's brief now" — referencing the artifact by file path. Future-Nina reads, renders in her voice, sends. Editorial freedom inside each section, no silent dropping.

**Surface changes:**

- `injectActionRequest()` primitive on SessionManager — bare user-role injection, no `[SYSTEM:]` wrap.
- `sendActionRequest` chat path mirroring `sendSystemMessage`. Both registered on the chat service; the latter retained for genuine system events (mount failures, infra alerts).
- `alert()` and `initiate()` route proactive deliveries through `sendActionRequest`. `formatNotification.job_completed` becomes an action-request prompt referencing `run_dir`.
- `[Pending Briefing]` system-prompt section renamed `[Pending Deliveries]` with action-request framing.
- All four `[SYSTEM:]` pre-wrap sites collapsed (`conversation-initiator.ts:184`, `heartbeat-service.ts:313`, `automation-processor.ts:306`, `app.ts:726`).
- Dead `pendingNotifications` queue **deleted** (zero callers verified by grep).

**Hygiene fixes:**

- Worker deliverable validator gains a doubled-signal narration heuristic.
- `notify` default depends on `manifest.system: boolean` flag (system → `none`, else → `debrief`). Existing `cfr-fix-*` manifests get explicit `system: true`.
- Haiku condense preamble stripped before passthrough; telemetry distinguishes "stripped" from "no-heading-passthrough".
- `Conversation Voice` section restored to `standing-orders.md`.
- `Brief Requirements` block deleted from `standing-orders.md` (superseded by worker schedule).
- ~26 disabled `cfr-fix-*` and 3 disabled `build-*-capability` automations archived from `.my_agent/automations/` to `_archive/`.

**Rollback:** `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` in `packages/dashboard/.env` reverts routing to `sendSystemMessage`. Default ON.

**Verification gate:** 7-day live soak. Each morning checks (a) brief lands as a turn matching the assembled brief without dismissal language or tool narration, (b) relocation session lands as a turn, and (c) Nina returns to the prior topic in the next turn (no mid-answer pivot regression).

## References

- Plan: [`docs/sprints/m9.4-s4.2-action-request-delivery/plan.md`](../sprints/m9.4-s4.2-action-request-delivery/plan.md)
- Audit: [`docs/sprints/m9.4-s4.2-action-request-delivery/audit.md`](../sprints/m9.4-s4.2-action-request-delivery/audit.md)
- Dead-code audit: [`docs/sprints/m9.4-s4.2-action-request-delivery/dead-code-audit.md`](../sprints/m9.4-s4.2-action-request-delivery/dead-code-audit.md)
- Prior sprints in this chain: [M9.4-S4](../sprints/m9.4-s4-brief-delivery-fix/plan.md), [M9.4-S4.1](../sprints/m9.4-s4.1-brief-section-preservation/plan.md)
