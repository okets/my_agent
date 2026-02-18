# M3-S4: External Communications & Personal Channels — Review

> **Status:** Complete
> **Date:** 2026-02-17
> **Reviewer:** Claude Opus 4.5

---

## Summary

All 11 tasks completed successfully. The sprint implements:

1. **External communications** — Full ruleset-based handling of non-owner messages
2. **Personal channel role** — Privacy-first monitoring with per-conversation opt-in
3. **Draft approval flow** — Editable drafts with send/reject actions

---

## Tasks Completed

| Task | Description | Status |
|------|-------------|--------|
| T1 | External Store Enhancement | Complete |
| T2 | Rules Loader | Complete |
| T3 | Message Handler — Rule Check | Complete |
| T4 | External Communications API | Complete |
| T5 | External Tab UI | Complete |
| T6 | Rule Addition via Agent | Complete |
| T7 | Personal Channel Setup | Complete |
| T7a | Monitoring Config Utility | Complete |
| T8 | Monitoring Gate | Complete |
| T9 | Monitoring API | Complete |
| T10 | Approval UI + Backend | Complete |
| T11 | Settings Badge (Bonus) | Complete |

---

## Files Created

| File | Purpose |
|------|---------|
| `packages/dashboard/src/channels/rules-loader.ts` | Parse external-communications.md files |
| `packages/dashboard/src/channels/monitoring-config.ts` | Read/write monitoring.json |
| `packages/dashboard/src/routes/external.ts` | External communications REST API |

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/dashboard/src/channels/external-store.ts` | Added status field, action methods (markResponded, markBlocked, markIgnored), getByChannel, listSenders |
| `packages/dashboard/src/channels/message-handler.ts` | Rule check integration, monitoring gate, draft generation |
| `packages/dashboard/src/channels/index.ts` | Export new modules |
| `packages/dashboard/src/routes/channels.ts` | Monitoring API endpoints, personal channel setup |
| `packages/dashboard/src/ws/protocol.ts` | Draft approval message types (draft_ready, draft_sent, draft_rejected, draft_approve, draft_reject), external_message |
| `packages/dashboard/src/ws/chat-handler.ts` | Rule detection, draft approval handlers |
| `packages/dashboard/src/server.ts` | Register external routes |
| `packages/dashboard/public/index.html` | External tab UI, pending drafts section, settings badge |
| `packages/dashboard/public/js/app.js` | External communications state and methods, draft approval |

---

## Implementation Details

### External Communications Flow

1. Non-owner message arrives via channel
2. Message handler checks rules via `RulesLoader.getRuleForContact()`
3. Based on rule action:
   - `auto_respond`: Generate response, send via channel
   - `draft_only`: Generate draft, notify dashboard for approval
   - `block`: Store as blocked, discard silently
   - No rule: Store + notify, no response

### Personal Channel Monitoring

1. Channel setup allows "personal" role selection
2. `MonitoringConfigManager` creates `monitoring.json` with `defaultMonitored: false`
3. Message handler checks monitoring state before processing
4. Unmonitored conversations are cut at source — never reach LLM

### Draft Approval UI

1. Draft appears in orange section above compose bar
2. Shows recipient, channel, and editable text area
3. User can edit content before sending
4. Send → approved draft delivered via channel
5. Reject → draft discarded, original message marked ignored

### Natural Language Rules

Chat handler detects patterns like:
- "Always respond to Sarah warmly" → `auto_respond` with instruction
- "Block mother-in-law" → `block`
- "Draft replies for Bob" → `draft_only`

Rule is appended to global `external-communications.md` file.

---

## Verification Status

| # | Test Case | Status |
|---|-----------|--------|
| 1 | Non-owner message → stored + notified, no response | Ready |
| 2 | Add "respond warmly" rule → auto-response | Ready |
| 3 | Add "draft only" rule → draft appears for approval | Ready |
| 4 | Block contact → messages silently dropped | Ready |
| 5 | Respond Once via External tab → reply sent | Ready |
| 6 | Natural language rule in chat → rules file updated | Ready |
| 7 | Personal channel setup → monitoring.json created | Ready |
| 8 | Unmonitored conversation → not processed | Ready |
| 9 | Enable monitoring via API → messages appear | Ready |
| 10 | Draft approval → editable, Send/Reject | Ready |
| 11 | Channel error → red badge on Settings | Ready |

---

## Technical Notes

### Rule File Format

```markdown
## Rules

- **Sarah** (+15551234567): always respond warmly
- **Bob** (bob@example.com): draft only
- **Telemarketers** (+15559876543): never respond
```

### Monitoring Config Format

```json
{
  "defaultMonitored": false,
  "conversations": {
    "+15551234567": {
      "monitored": true,
      "enabledAt": "2026-02-17T..."
    }
  }
}
```

### New WebSocket Message Types

**Server → Client:**
- `external_message` — New external message notification
- `draft_ready` — Draft awaiting approval
- `draft_sent` — Draft approved and delivered
- `draft_rejected` — Draft rejected

**Client → Server:**
- `draft_approve` — Approve and send draft (with edited content)
- `draft_reject` — Reject draft

---

## Known Limitations

1. **Draft content is static MVP** — Currently uses template responses. Future: route through brain for contextual drafts.
2. **LID JID resolution** — WhatsApp LID JIDs cannot be matched to phone numbers without contact store lookup (TODO for future sprint).
3. **No complex rule parsing** — MVP supports simple patterns. Complex conditions deferred.

---

## Next Steps

- Test all verification scenarios manually
- Consider brain-powered draft generation for smarter responses
- Add scheduled monitoring for personal channels (M4a dependency)

---

## Commit

Ready for commit when CTO approves.
