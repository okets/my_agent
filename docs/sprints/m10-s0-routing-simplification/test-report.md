# M10-S0 — Raw Test Report (External Reviewer)

**Reviewer:** External Opus (independent)
**Date:** 2026-04-13
**Branch tested:** `sprint/m10-s0-routing-simplification` @ `b6c04b5`
**Baseline:** `master` @ `843037d`

---

## Typecheck

```
$ cd packages/dashboard && npx tsc --noEmit
EXIT: 0

$ cd packages/core && npx tsc --noEmit
EXIT: 0
```

Both packages typecheck cleanly.

---

## Mechanical grep acceptance

```
$ grep -rn "sourceChannel\|source_channel" packages/dashboard/src/
(no matches)
```

Zero production references to either identifier. Acceptance items 1 & 2 satisfied.

Additional check — core package:

```
$ grep -rn "sourceChannel\|source_channel" packages/core/src/
(no matches)
```

Also clean.

Additional check — any lingering references to deleted helpers:

```
$ grep -rn "webAge\|useWeb\|isDashboardSourced\|getLastWebMessageAge\|dashboard-sourced" packages/dashboard/src/
(no matches)
```

All deleted helper names are gone from src/.

Remaining occurrences in `packages/dashboard/tests/`:
- `tests/conversation-initiator.test.ts:245` — comment documenting legacy behavior
- `tests/integration/routing-presence.test.ts` — deliberate stale-field fixtures for the legacy-tolerance test and comments explaining Issue #4 scenario

All tests-side references are intentional.

---

## Targeted sprint tests

### `tests/integration/routing-presence.test.ts`

```
$ npx vitest run tests/integration/routing-presence.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
  Duration  3.36s
```

Pass. Scenarios:
1. WA inbound → automation completion → delivered to WA
2. dashboard-only inbound → automation completion → delivered to web
3. channel switch within 15 min: WA inbound then web turn → completion lands on web
4. stale conversation, scheduled job completes → preferred channel (WA) when externalParty matches
5. mount_failure with no recent user activity → preferred channel (WA), not forced web
6. legacy on-disk notification with `source_channel` field deserializes cleanly

### `tests/conversations/get-last-user-turn.test.ts`

```
$ npx vitest run tests/conversations/get-last-user-turn.test.ts
Test Files  1 passed (1)
     Tests  7 passed (7)
  Duration  409ms
```

Pass.

### `tests/conversation-initiator.test.ts`

```
$ npx vitest run tests/conversation-initiator.test.ts
Test Files  1 passed (1)
     Tests  16 passed (16)
  Duration  529ms
```

Pass.

---

## Full dashboard suite

```
$ cd packages/dashboard && npx vitest run
Test Files  3 failed | 136 passed | 4 skipped (143)
     Tests  4 failed | 1184 passed | 12 skipped (1200)
  Duration  60.43s
```

Failing files:
- `tests/unit/ui/progress-card.test.ts` (2 fails)
- `tests/browser/automation-ui.test.ts` (1 fail)
- `tests/browser/progress-card.test.ts` (1 fail)

---

## Pre-existing failure verification

Checked out master, re-ran only the failing files:

```
$ git checkout master
$ cd packages/dashboard && npx vitest run \
    tests/unit/ui/progress-card.test.ts \
    tests/browser/automation-ui.test.ts \
    tests/browser/progress-card.test.ts

Test Files  3 failed (3)
     Tests  4 failed | 22 passed (26)
  Duration  17.58s
```

**All 4 failures reproduce on master with identical assertions.** None reference routing, conversations, notifications, `sourceChannel`, or presence — they're about:
- progress-card unicode status icons / color classes
- Playwright browser integration against a running dashboard

**Not introduced by M10-S0.** Matches implementer's claim in DECISIONS.md.

Switched back to `sprint/m10-s0-routing-simplification` for subsequent review.

---

## Totals attributable to M10-S0

- **New tests:** 6 (routing-presence) + 7 (get-last-user-turn) = 13 brand-new tests, all passing.
- **Rewritten:** `conversation-initiator.test.ts` — 16 tests, all passing (vs. prior version with dashboard-sourced carve-outs).
- **Deleted:** `tests/unit/notifications/source-channel.test.ts` (obsolete, as called for in plan Task 4 Step 1).
- **Regressions on master baseline:** 0.
