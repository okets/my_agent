---
title: "Morning brief delivery broken — truncated, paraphrased, context-contaminated"
priority: high
created: 2026-04-08
---

# Bug: Morning brief is truncated, re-paraphrased, and contaminated by conversation context

## Symptom

The WhatsApp morning brief is:
- Missing sections (Thailand news, project health, events)
- Conversational instead of structured ("two things worth flagging...")
- Mixed with unrelated conversation context (motherboard discussion)
- Offers "full brief available if you want it" instead of presenting the full brief

## The Pipeline

```
Workers (7:00)  →  Debrief Reporter (8:13)  →  Notification Queue  →  Heartbeat  →  Brain  →  WhatsApp
   5 workers         Haiku digest              persistent-queue       formatNotification()   ci.alert()
   ~1600 chars        well-structured            .slice(0, 500)         "present naturally"    inject into
   each               debrief-digest.md          truncated              double-paraphrase      active convo
```

The debrief-reporter produces an excellent 1601-char structured digest via Haiku. By the time it reaches the user, three things destroy it.

## Root Causes

### Issue 1: 500-char truncation in `automation-processor.ts`

**File:** `packages/dashboard/src/automations/automation-processor.ts` line 227

```typescript
: (result.work ?? "Completed successfully.").slice(0, 500);
```

When the debrief-reporter completes, its `result.work` (the full digest) is truncated to 500 chars before being stored in the notification queue. The digest is ~1600 chars. Everything after 500 chars is lost — Thailand news, project health, events, and the closing section.

**Origin:** Added in commit `067a6de` (M7-S3, 2026-03-23) as a defensive guard when `result.work` was passed directly into `ci.alert()`. At that time, worker output could be arbitrarily large. The debrief-reporter (added later in `a53ce9c`) produces a carefully sized digest, but the truncation was never revisited.

**Fix:** The truncation is a blunt instrument. Options:
- Remove it entirely — the debrief digest is already sized by Haiku. Other `notify: immediate` automations are rare and typically short.
- Replace with a larger limit (e.g., 4000 chars) as a safety net.
- Make it configurable per-automation in the manifest (e.g., `max_notification_chars: 2000`).

### Issue 2: Generic mediator framing in `heartbeat-service.ts`

**File:** `packages/dashboard/src/automations/heartbeat-service.ts` lines 162-178

```typescript
private formatNotification(n: PersistentNotification): string {
  const mediatorFraming =
    "You are the conversation layer — present what matters to the user naturally.";

  switch (n.type) {
    case "job_completed":
      return `A working agent completed a task.\n\nResults: ${n.summary}\n\n${mediatorFraming}`;
```

Every `job_completed` notification — including the morning brief — gets the same generic framing. The brain is told to "present what matters naturally," so it paraphrases the (already truncated) digest into a conversational message. This is double-paraphrasing: Haiku already wrote the digest; Sonnet rewrites it.

**Fix:** The debrief-reporter notification needs different framing. The brain should be told to forward the digest verbatim, not paraphrase it. Detection: check `n.automation_id === "debrief-reporter"` or add a notification field like `verbatim: true`.

### Issue 3: Alert injection into active conversation (not a brief-specific fix)

**File:** `packages/dashboard/src/agent/conversation-initiator.ts` `alert()` method

`alert()` injects the brief into the current active conversation. If the user was discussing motherboards, the brain has that full context and blends topics ("Also, while we were talking — morning brief came in").

This is **not a brief-specific issue** — it's correct behavior for `alert()`. The fix is in Issue 2: with proper "forward verbatim, do not reference prior conversation" framing, the brain should deliver the brief cleanly even in an existing conversation. The brief doesn't need its own conversation.

**Separate concern:** Auto-starting a new conversation after idle time would be a general improvement to `ConversationInitiator`, not tied to the brief specifically.

## Evidence

Delivered notification file shows the 500-char truncation:
```
# .my_agent/notifications/delivered/1775783639884-job-5563313a-*.json
summary field: exactly 500 chars, cuts mid-sentence at "**today is your last wi"
```

The full digest on disk is complete and well-structured:
```
# .my_agent/notebook/operations/debrief-digest.md
~1601 chars, includes AQI, Songkran, Thailand news, project health, events
```

## Files to Modify

1. `packages/dashboard/src/automations/automation-processor.ts` — line 227: remove or raise the `.slice(0, 500)`
2. `packages/dashboard/src/automations/heartbeat-service.ts` — `formatNotification()`: add debrief-specific path with verbatim framing

## Verification

After fixing, trigger a manual debrief-reporter run and verify:
1. The full digest (~1600 chars) appears in the notification queue unstruncated
2. The WhatsApp message matches the digest structure (sections, formatting)
3. The brain does not paraphrase or editorialize the digest
4. If injected into an active conversation, the brief is distinct from prior topics
