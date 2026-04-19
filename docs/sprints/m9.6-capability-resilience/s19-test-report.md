---
sprint: M9.6-S19
---

# S19 Test Report

## TypeScript Compilation

| Package | Exit code | Errors |
|---|---|---|
| core | 0 | 0 |
| dashboard | 0 | 0 |

## Full Test Suites

| Suite | Tests | Status |
|---|---|---|
| core (all) | 660 passed, 9 skipped (669 total) | pass |
| dashboard (all) | 1315 passed, 7 failed, 18 skipped (1340 total) | pre-existing failures (see note) |

**Dashboard suite note:** The 7 failures are all pre-existing, unrelated to S19 work:
- `tests/browser/capability-ack-render.test.ts` — Playwright browser env issue
- `tests/browser/capabilities-singleton-visual.test.ts` — pixel-diff visual regression
- `tests/browser/automation-ui.test.ts` — automation schedule editor (no auth configured)
- `tests/browser/progress-card.test.ts` — status icons check
- `tests/unit/ui/progress-card.test.ts` (2 tests) — CSS color/icon token mismatch
- `tests/e2e/whatsapp-before-browser.test.ts` — STT-level CFR timing

None of these files were modified in S19. All 8 new S19 integration/unit test files pass individually (see below).

## New S19 Tests

| File | Tests | Status |
|---|---|---|
| `tests/capabilities/registry-friendly-name.test.ts` | 5 | pass |
| `tests/capabilities/resilience-messages-frontmatter.test.ts` | 3 | pass |
| `tests/capabilities/ack-coalescing.test.ts` | 10 | pass |
| `tests/conversations/orphan-watchdog-assistant.test.ts` | 3 | pass |
| `tests/integration/cfr-automation-notifier.test.ts` | 4 | pass |
| `tests/integration/app-ackdelivery-wiring.test.ts` | 2 | pass |
| `tests/integration/cfr-system-origin-health.test.ts` | 4 | pass |
| `tests/integration/chat-service-failure-type.test.ts` | 3 | pass |

**Total new S19 tests: 34 — all pass.**

## S18 Regression Tests

| File | Tests | Status |
|---|---|---|
| `tests/integration/tts-paths.test.ts` | 5 | pass |
| `tests/integration/voice-reply-regression.test.ts` | 1 | pass |
| `tests/integration/cfr-tts-single-emit.test.ts` | 1 | pass |

**S18 regression: 7/7 pass.**

## Dashboard

- Dashboard service restarted: yes
- System-origin health panel present in Settings → Capabilities: yes (verified by implementer)
- `failure_type` marker: code present in `chat-service.ts:934`; renders in assistant bubbles when TTS failure turn exists in history

## Universal Coverage

- Templates with `friendly_name`: 5/5 existing templates updated
- `image-to-text.md` template: does not exist (FU-2 — create when capability is added)
- `failure_type` write-sites: 1 (`chat-service.ts:934` — TTS path only)
