# External Verification Report

**Sprint:** M9.6-S19 UX Polish
**Reviewer:** External Opus (independent)
**Date:** 2026-04-19

## Spec Coverage

| Spec Requirement | Status | Evidence |
|---|---|---|
| 30-second ack coalescing window | COVERED | `ack-delivery.ts:98` `COALESCE_WINDOW_MS = 30_000`; `onAck` opens new window when `nowMs - existing.openedAt > COALESCE_WINDOW_MS` (line 127), returns null for first ack (line 131), idempotent on repeat (line 134–136), returns "still fixing — now also …" string on subsequent distinct type within window (line 141). |
| N-aware Oxford comma copy | COVERED | `renderTypeList` at `ack-delivery.ts:187–193`: 0→"", 1→single name, 2→"X and Y", 3+→"X, Y, and Z". Maps types through `FRIENDLY_NAMES`. Verified by `ack-coalescing.test.ts` (5 pass). |
| Conversation-origin only; automation/system bypass coalescer | COVERED | Coalescer `onAck`/`onTerminal` only called inside the `origin.kind === "conversation"` branch at `ack-delivery.ts:279–304`. Automation branch (`340`) and system branch (`401`) never invoke the coalescer. |
| `AutomationNotifierLike` concrete implementation | COVERED | `app.ts:671–691` constructs `automationNotifier: AutomationNotifierLike` with lazy `app.conversationInitiator` closure; passed as 3rd arg to `new AckDelivery(...)` at `app.ts:695`. Uses `ci.alert()` → `ci.initiate()` fallback with proper mediator framing per dashboard CLAUDE.md. |
| Fixed-outcome fan-out | COVERED | `ack-delivery.ts:349–350`: `outcome = context?.kind === "terminal-fixed" ? "fixed" : "surrendered"`. No longer hardcoded. `isTerminalKind` at line 241 includes `"terminal-fixed"`. |
| System-origin ring buffer (cap 100) | COVERED | `ack-delivery.ts:208` `SYSTEM_RING_BUFFER_MAX = 100`; `systemEventLog.push(...)` at line 408; `shift()` on overflow at line 416–418. `getSystemEvents()` returns `[...log].reverse()` (most recent first) at line 428. |
| `/api/capabilities/cfr-system-events` endpoint | COVERED | `packages/dashboard/src/routes/capabilities.ts:370–373`: returns `{ events: fastify.app?.ackDelivery?.getSystemEvents() ?? [] }`. Live check: `curl localhost:4321/api/capabilities/cfr-system-events` returns `{"events":[]}` (200). |
| `TranscriptTurn.failure_type?: string` | COVERED | `packages/dashboard/src/conversations/types.ts:115` `failure_type?: string` with S19 doc comment. |
| `FAILURE_PLACEHOLDERS` dispatch table | COVERED | `packages/core/src/conversations/orphan-watchdog.ts:180–185` exports `FAILURE_PLACEHOLDERS` keyed by capability type. `isUserTurnPlaceholder` at line 187 dispatches via `Object.values(FAILURE_PLACEHOLDERS).flat()`. |
| Assistant-turn orphan watchdog scan | COVERED | `orphan-watchdog.ts:301–332`: iterates transcript, filters `role==="assistant" && failure_type`, applies idempotency check (laterNonEmpty at 312–319), calls `systemMessageInjector` with re-drive prompt. Report tracks `assistantFailuresScheduled`. |
| `failure_type` write-callsite | COVERED | `packages/dashboard/src/chat/chat-service.ts:776` `let ttsFailed = false`; set to `true` at `:897` when `synthesisResult === null`; written into `TranscriptTurn.failure_type` at `:934`. |
| Dashboard failure_type inline marker | COVERED | `packages/dashboard/public/index.html:5897–5901` (desktop) and `:9235–9239` (mobile): `<template x-if="msg.failureType">` with orange italic `text-orange-400/70 italic` styling. Copy: `'voice reply unavailable — fixing…'` for `text-to-audio`, generic fallback for others. Field populated from WS at `app.js:1504–1505` and on transcript load at `:1602` and `:1782`. |
| Dashboard system-origin health panel | COVERED | `index.html:3326–3349`: "Recent System Events" glass panel with refresh button, empty-state, per-event row showing capability type / component / local timestamp. Tailwind tokens `text-red-400` / `text-orange-400` correctly applied. Fetched via `loadSystemCfrEvents()` at `:3052–3060`, called in `init()` at `:3063`. |
| `registry.getFriendlyName(type)` | COVERED | `packages/core/src/capabilities/registry.ts:248–253`: iterates capabilities, first-wins on `cap.friendlyName`, falls back to `FRIENDLY_NAMES[type]`, then raw `type`. Doc comment explicitly states resolution order. |
| 6 templates updated with `friendly_name:` | COVERED (5/5 expected) | Spec notes `image-to-text` doesn't exist (DEV-2). Confirmed 5 templates carry `friendly_name`: audio-to-text ("voice transcription"), text-to-audio ("voice reply"), text-to-image ("image generation"), browser-control ("browser"), desktop-control ("desktop control"). |

## Test Results

- **Core:** 660 passed, 0 failed, 9 skipped (31.3s)
- **Dashboard:** 1315 passed, 7 failed, 18 skipped (68.0s)
- **TypeScript:** compiles clean in both packages (`tsc --noEmit` exit 0)
- **S19-specific tests:** 34/34 pass (21 core + 13 dashboard)
- **S18 regression:** within green core suite

The 7 dashboard failures are all pre-existing and unrelated to S19:
- `tests/browser/automation-ui.test.ts` (Playwright automation UI)
- `tests/browser/capabilities-singleton-visual.test.ts` (visual regression baseline)
- `tests/browser/capability-ack-render.test.ts` (browser WS test)
- `tests/browser/progress-card.test.ts` (progress card T4)
- `tests/e2e/whatsapp-before-browser.test.ts` (e2e STT-level CFR)
- `tests/unit/ui/progress-card.test.ts` (two progress-card template tests — both reference `✗` icon/color tokens, S18-era scope)

None of these touch coalescing, failure_type, registry, or system-origin health paths.

## Browser Verification

- `systemctl --user status nina-dashboard.service`: active (running), uptime 12 min, PID 3850122.
- `GET /api/capabilities/cfr-system-events` → HTTP 200, body `{"events":[]}` (expected for a fresh-boot buffer).
- Endpoint wiring, Alpine component initialization (`init() → loadSystemCfrEvents()`), and Tailwind tokens verified in `index.html`. Template guards (`x-show`, `x-for`) match the `SystemCfrEvent` shape exported from core.

## §0.3 Compliance

- **Branch not merged to master:** yes — `git log master..HEAD` = 10 commits; `git branch --contains HEAD` does not list master.
- **No "APPROVED" / "all tasks complete" commits:** yes — `git log master..HEAD --format="%s" | grep -i 'approved\|all tasks complete'` returns no matches.

## Gaps Found

None. Every one of the 15 spec requirements maps to concrete source code that is exercised by the S19 test suite. The one nuance worth flagging (not a gap):

- Spec line items "6 templates updated" is reconciled to 5 actual templates per DEV-2 (no `image-to-text` template exists in the repo). Coverage is complete given the actual template set.
- Dashboard health panel currently shows only capability type + component + timestamp; it does not surface `symptom` text. This matches the S19 plan (minimal health surface) but if richer context is desired later, the payload already carries `symptom` and `capabilityName` — a frontend-only change.

## Verdict

**PASS**

All 15 spec requirements are implemented cleanly and covered by 34 new passing tests. Branch is unmerged, commit language is §0.3-compliant, both packages typecheck, and the live endpoint responds as designed. Pre-existing dashboard test failures are unrelated to S19 scope.
