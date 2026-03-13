# External Verification Report

**Sprint:** M6.9-S3 Conversation Initiation
**Reviewer:** External Opus (independent)
**Date:** 2026-03-13

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| **3.1** `alert(prompt): Promise<boolean>` — inject system turn into active conversation | COVERED | `conversation-initiator.ts:198-236`, test: "injects system turn into active conversation and returns true" |
| **3.2** `initiate(options?): Promise<Conversation>` — start new conversation on preferred channel | COVERED | `conversation-initiator.ts:243-271`, test: "creates new conversation and appends first turn" |
| **3.3** Active conversation = last user message within 15 min | COVERED | `db.ts:514-531` (`getActiveConversation` with threshold query), `manager.ts:128-134`, tests: 4 threshold tests in Task 3 |
| **3.4** `alert()` with no active conversation is no-op with warning log | COVERED | `conversation-initiator.ts:203-208`, test: "returns false when no active conversation" |
| **3.5** Constructor receives conversationManager, sessionFactory, channelManager, config access | COVERED | `conversation-initiator.ts:164-170` (ConversationInitiatorOptions interface) |
| **4.1** Morning brief sequence: check active, alert or initiate | COVERED | `work-loop-scheduler.ts:696-710`, tests: "calls initiate when alert returns false", "does not initiate when alert succeeds" |
| **4.2** No special morning-brief context injection (approach A) | COVERED | No extra context injection code — brain uses existing system prompt layers |
| **4.3** User declines = no timers/retries/flags | COVERED | No retry logic exists in the implementation |
| **4.4** Haiku failure guard | COVERED | `work-loop-scheduler.ts:699` guards on `output` being truthy |
| **4.4** Duplicate guard | COVERED | Relies on existing `work_loop_runs` table preventing re-run within cadence window (per plan) |
| **5.1** `outboundChannel` preference in config.yaml | COVERED | `config.ts:345,352,373-375`, test: config-preferences.test.ts (2 tests) |
| **5.1** `outboundChannel` supersedes `morningBrief.channel` with fallback | COVERED | `config.ts:375` — `p.outboundChannel ?? mb.channel ?? DEFAULT_PREFERENCES.outboundChannel` |
| **5.2** Fallback: silently fall back to web if channel not connected | COVERED | `conversation-initiator.ts:277-308` (`trySendViaChannel`), test: "falls back to web when preferred channel is disconnected" |
| **5.3** Hatching: outbound channel question | COVERED | `hatching-prompt.ts:9` (step 5 added), `hatching-tools.ts:186-220` (schema + config.yaml persistence) |
| **5.4** Settings UI: outbound channel dropdown | COVERED | `index.html:2306-2316` (desktop), `index.html:6618-6630` (mobile), `app.js:215,2594,2720` |
| **6** Synthetic turn: `[SYSTEM: {prompt}]` format, not shown to user | COVERED | `session-manager.ts:280-283` wraps in `[SYSTEM: ]`, `conversation-initiator.ts:222-228` only appends assistant response |
| **6.1** `injectSystemTurn()` on SessionManager | COVERED | `session-manager.ts:279-283`, yields from `streamMessage` |
| **7** Files changed — all listed files modified | COVERED | 15 files changed matching spec Section 7 (with minor additions: config-preferences.test.ts not in spec table but appropriate) |
| **8** Edge: no channels connected = web only | COVERED | `trySendViaChannel` returns early when `channelId === "web"` |
| **8** Edge: WhatsApp disconnects mid-send | COVERED | `trySendViaChannel` catch block silently falls back |
| **8** Edge: active conv on web, preferred is WhatsApp | PARTIAL | `alert()` sends via `trySendViaChannel` using the preferred channel rather than the active conversation's channel. Spec says "alert goes into the web conversation (respect active conversation)". See Gaps. |
| **10** Unit tests per spec test strategy | COVERED | 16 tests in conversation-initiator.test.ts + 2 in config-preferences.test.ts |

## Test Results

- Dashboard: 380 passed, 1 failed, 2 skipped
- TypeScript: compiles clean (0 errors)

**Failed test:** `tests/haiku-jobs.test.ts > morning-prep produces output` — pre-existing timeout failure (requires API key), not related to this sprint.

**Skipped tests:** 2 in conversation-lifecycle.test.ts — pre-existing, not related.

## Browser Verification

- [x] Dashboard loads at / without console errors (0 errors, 1 warning: Tailwind CDN deprecation — pre-existing)
- [x] Settings page renders with all sections
- [x] "Outbound Channel" dropdown present under Morning Brief section
- [x] Default value is "Web Only"
- [x] Options are "Web Only" and "WhatsApp"
- [x] Changed to "WhatsApp", clicked Save, got "Preferences saved" confirmation
- [x] Page reload: "WhatsApp" still selected (persisted)
- [x] API verification: `GET /api/settings/preferences` returns `outboundChannel: "whatsapp"`
- [x] API write: `PUT /api/settings/preferences` with `outboundChannel: "web"` succeeds
- [x] Mobile dropdown present in mobile settings section (verified in diff: index.html lines 6618-6630)

## Gaps Found

1. **Edge case: alert() channel routing (Spec 8, row 3)** — The spec states: "Active conversation on web, preferred channel is WhatsApp: Alert goes into the web conversation (respect active conversation)." However, `alert()` calls `trySendViaChannel()` which uses `getOutboundChannel()` (the global preference), not the active conversation's channel. If the active conversation is on web but the preferred outbound channel is WhatsApp, the alert response would be sent via WhatsApp instead of the web conversation. **Severity: Low** — in practice the web dashboard shows the assistant turn via WebSocket regardless, so the user sees it either way. But it may result in a duplicate message (once on web, once on WhatsApp).

2. **No traceability matrix in plan** — The external reviewer procedure requires a traceability matrix mapping spec requirements to plan tasks. The plan has tasks mapped to spec sections implicitly (task names reference spec concepts) but no explicit traceability table. **Severity: Process only** — coverage is complete despite missing table.

3. **`initiate()` does not use `firstTurnPrompt` parameter** — The spec defines `initiate(options?: { firstTurnPrompt?: string })` and the implementation accepts this parameter in the type signature, but the `firstTurnPrompt` is never passed to `streamNewConversation()`. The session factory's `streamNewConversation` takes only `conversationId` and calls `sm.streamMessage("")`. **Severity: Low** — the spec says "Nina composes the opening message" via system prompt context, and the parameter is optional, but it exists in the interface without effect.

## Verdict

**PASS WITH CONCERNS**

The sprint delivers all core functionality: ConversationInitiator with alert/initiate primitives, active conversation detection via lastUserMessageAt, morning brief integration, outboundChannel configuration (config, API, UI, hatching), and SessionManager.injectSystemTurn. Tests are comprehensive (16 dedicated tests + 2 config tests), TypeScript compiles clean, and the Settings UI works correctly with persistence. The two code-level gaps (alert channel routing and unused firstTurnPrompt) are low severity and can be addressed in S3.5 when all Working Nina touchpoints are audited.
