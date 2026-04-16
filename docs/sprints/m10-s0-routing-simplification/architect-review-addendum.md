# M10-S0 Architect Review — Addendum: Channel-Switch Detection

**Date:** 2026-04-16
**Trigger:** Morning debrief delivered to WhatsApp as continuation of existing web conversation instead of starting a new one. User had no context on WhatsApp — the conversation's prior turns were on the dashboard.
**Conversation:** `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ`

---

## The asymmetric rule (stated by CTO)

Channel switching is **asymmetric** — it depends on which direction the switch goes:

- **Web → external channel** (WhatsApp, email, etc.) = **ALWAYS new conversation.** The user cannot see dashboard history on the external channel. Delivering into an existing conversation gives Nina a reply with no visible context. The user sees a response to something they never said on that channel.
- **External channel → web** = **NEVER new conversation.** The dashboard shows the full transcript. The user has all context.

This is the fundamental rule. Everything below serves it.

---

## Issue 4: `isSameChannel` ignores conversation's actual channel

**File:** `packages/dashboard/src/agent/conversation-initiator.ts:150-152`
**Severity:** Critical — production bug observed April 16.

### What happened

1. Conversation `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ` was created on the web. DB row: `channel = 'web'`.
2. WhatsApp messages were routed into this conversation (Apr 13-15). This set `external_party = '41433650172129@lid'`.
3. User switched to dashboard (Apr 15, turns 36-54). Last user turn is on web, 19:57 UTC.
4. Morning debrief fires Apr 16 01:14 UTC. Last user turn is >3h stale → `targetChannel = preferred = "ninas_dedicated_whatsapp"`.
5. `alert()` checks:

```typescript
const isSameChannel =
  !!current.externalParty && current.externalParty === ownerJid;
```

`externalParty = '41433650172129@lid'`, `ownerJid = '41433650172129@lid'` → **match**. Code concludes "already on WhatsApp, continue." Delivers into the web-originated conversation. User receives a WhatsApp message referencing context they can only see on the dashboard.

### Root cause

`isSameChannel` only tests `externalParty` identity. It does not test whether the conversation's **most recent user activity** was on the target channel. A web conversation that previously received WhatsApp messages still has `externalParty` set — a leftover. The check treats any conversation with a matching `externalParty` as "currently on that channel," which is wrong.

Note: the DB `channel` column is vestigial (always `'web'`, set at insert, never updated — see `conversations/db.ts:295`). Do NOT use it as the fix signal.

### Fix direction

The correct signal for "is this conversation currently on the same channel as the target" is: **what channel was the most recent user turn on?**

We already compute this: `last` from `getLastUserTurn(current.id)`. The `last.channel` field tells us the conversation's effective current channel from the user's perspective.

Replace the `isSameChannel` check with:

```
The conversation is "same channel" as the target IF AND ONLY IF
the most recent user turn's channel matches the target channel.
```

Concretely:
- `last.channel` is undefined/null → conversation is on web. Target is WhatsApp → NOT same channel → `initiate()`.
- `last.channel` is `"ninas_dedicated_whatsapp"` → conversation is on WA. Target is WA → same channel → continue.
- `last.channel` is `"ninas_dedicated_whatsapp"` → conversation is on WA. Target is web → same channel in reverse (external→web = NEVER new conversation) → continue.

Wait — the third case needs care. `alert()` only reaches the channel-switch check when `targetChannel !== "web"` (the web-delivery early-return at `:122-133` handles that). So by the time we're here, `targetChannel` is always an external channel. The question simplifies to: "was the most recent user turn on this same external channel?"

Edge case: no user turns at all (`last === null`). This means a fresh conversation with no history. The safe default: treat as web → force `initiate()` on the target channel.

Edge case: user's last turn was on a DIFFERENT external channel (e.g., last turn on email, target is WhatsApp). Should trigger `initiate()` — user can't see email history on WhatsApp. The check handles this correctly because `last.channel !== targetChannel`.

### What NOT to change

- Do not use the DB `channel` column. It is always `'web'`.
- Do not remove the transport connectivity check above (`:138-148`). That guards against writing stale transcripts on disconnected transports.
- Do not change `initiate()` — it was correctly fixed for Issue 1 and passes `targetChannel` through.
- Do not regress the `externalParty` comparison for the case where it was genuinely correct (conversation IS on the target channel and has been all along). The new check must produce the same result for that case.

### Tests required

1. **Dual-channel conversation: web→WA switch triggers new conversation.**
   - Create conversation. Append WA user turns (sets externalParty via the test harness or manual DB update). Then append web user turns (no channel). Last user turn = web, stale.
   - Fire `alert()`.
   - Assert: `initiate()` was called (new conversation created). The old conversation is NOT continued.

2. **Pure WA conversation: WA→WA continues (no regression).**
   - Create conversation with externalParty = WA ownerJid. All user turns have `channel: "whatsapp"`. Last user turn stale.
   - Fire `alert()`.
   - Assert: same conversation continued. No `initiate()` call.

3. **No user turns: treated as web → new conversation on WA.**
   - Create conversation, no user turns appended.
   - Fire `alert()` with target resolving to WA.
   - Assert: `initiate()` was called.

### Acceptance for final merge

After this fix, the full M10-S0 test suite (current 32 tests + 3 new) must pass. The April 16 morning-brief scenario must be reproducible in a test and the test must demonstrate the correct behavior (new conversation created on channel switch from web).
