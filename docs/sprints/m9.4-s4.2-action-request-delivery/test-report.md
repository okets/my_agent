# Test Report — M9.4-S4.2

## Test Run

- **Date:** 2026-04-27
- **Reviewer:** External Opus (independent, no shared context with implementation team)
- **Working tree:** `/home/nina/my_agent-s4.2` @ `4d51353` (branch `sprint/m9.4-s4.2-action-request-delivery`)
- **Command:** `cd packages/dashboard && npx tsc --noEmit && npx vitest run`
- **Result:** PASS
- **Numbers:** 1382 tests across 187 test files — 1358 passed, 0 failed, 24 skipped
- **Typecheck:** clean (exit 0)
- **Duration:** 65 s

## Skipped Tests (24)

All skips are CFR live/e2e tests that gate on environment preconditions:

- `tests/e2e/cfr-exit-gate-automation.test.ts` (1) — "realAgentDir not found; capabilities/browser-chrome/CAPABILITY.md missing; no ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in env"
- `tests/e2e/cfr-exit-gate-conversation.test.ts` (1) — same precondition
- `tests/e2e/cfr-abbreviated-replays.test.ts` (2) — same
- `tests/e2e/cfr-exit-gate-tool-retry.test.ts` (1) — same
- `tests/e2e/cfr-phase2-desktop-synthetic.test.ts` (1) — same
- `tests/e2e/cfr-incident-replay.test.ts` (2) — same
- `tests/e2e/cfr-phase2-browser-synthetic.test.ts` (1) — same
- `tests/e2e/cfr-phase2-stt-replay.test.ts` (1) — same
- `tests/e2e/cfr-phase2-tts-replay.test.ts` (1) — same
- `tests/integration/cfr-stt-reprocess-chain.test.ts` (1) — same
- `tests/live/handler-execution.test.ts` (4) — same
- `tests/live/delegation-compliance.test.ts` (4) — same
- `tests/live/hitl-live.test.ts` (1) — same
- `tests/live/user-automation.test.ts` (1) — same

All 24 skips are expected (env-gated, not flaky). None relate to S4.2 changes.

## Coverage Note

S4.2-specific coverage is dense and well-targeted. New tests added in this sprint:
- `tests/unit/agent/inject-action-request.test.ts` (Task 3 — primitive)
- `tests/unit/agent/no-system-prepend-from-queue.test.ts` (Task 7 — regression for queue deletion)
- `tests/unit/chat/send-action-request.test.ts` (Task 4 — chat path)
- `tests/unit/automations/deliverable-validator.test.ts` (Task 5 — doubled-signal)
- `tests/unit/automations/automation-manager.test.ts` (Task 8 — system-flag default)
- `tests/unit/automations/heartbeat-action-request-prompt.test.ts` (Task 6 — new prompt body)
- `tests/unit/automations/feature-flag.test.ts` (Task 13 — both flag states)
- `tests/integration/proactive-delivery-aged-conversation.test.ts` (Task 14 — 50-turn synthetic gravity)

Existing tests updated in lockstep with renames: `status-prompt-acceptance.test.ts` (5 assertions on `[Pending Deliveries]`), `mock-session.ts` (parallel `injectActionRequest` mock + `lastInjectionKind` field), `conversation-initiator-alert-outcome.test.ts`, `conversation-initiator-initiate-outcome.test.ts`, `routing-presence.test.ts`.

Coverage is adequate for the routing/wiring/validator changes shipped in this PR. The integration test header explicitly acknowledges its limit ("50-turn synthetic gravity is not equivalent to 3-day real-conversation gravity") and points to Task 16 as the load-bearing gate. That self-awareness is appropriate.

## 7-Day Soak Plan (Task 16)

The plan's Task 16 specifies a 7-day live soak that begins on merge:

- **Day 1:** observe 07:00 BKK morning brief + 08:00 BKK relocation session. PASS criteria: lands as a turn, content matches deliverable, no dismissal language, no tool narration, no CFR-fix sections, Nina returns to prior topic in next turn (audit concern #13 check).
- **Days 2–7:** repeat each morning. Append a row per day to this report (date, brief PASS/FAIL, relocation PASS/FAIL, conversation length at delivery, anomalies). Conversation length matters — gravity grows over the soak.
- **On any morning failure:** flip `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` in `.env`, restart service, sprint stays open, file follow-up bug with the failing turn copied verbatim.
- **After 7 clean days:** sprint close. After 14 more days clean (21 total since merge): remove the feature flag in a follow-up PR.

The soak is deferred to post-merge per plan and is the load-bearing acceptance gate for this sprint.

## Reviewer Note

S4 (PASS 2026-04-10) and S4.1 (PASS 2026-04-20) both declared the brief-delivery chain fixed; both regressed in production within 5–15 days. The plan correctly treats this sprint's PR-level PASS as necessary-but-not-sufficient and gates close on the soak. That posture is appropriate given the failure history.
