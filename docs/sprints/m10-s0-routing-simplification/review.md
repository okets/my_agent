# External Verification Report

**Sprint:** M10-S0 Routing Simplification
**Reviewer:** External Opus (independent)
**Date:** 2026-04-13
**Branch:** `sprint/m10-s0-routing-simplification` @ `b6c04b5`
**Base:** `master` @ `843037d`

---

## Spec Coverage

### § "What gets deleted"

| Row | Status | Evidence |
|---|---|---|
| `PersistentNotification.source_channel` field removed | COVERED | `packages/dashboard/src/notifications/persistent-queue.ts` (4–23): no `source_channel` in type |
| `alert(prompt, { sourceChannel })` option removed | COVERED | `conversation-initiator.ts:87–89` — signature is `alert(prompt, options?: { triggerJobId?: string })` |
| `alert()` `isDashboardSourced` branch removed | COVERED | grep `isDashboardSourced` in `packages/dashboard/src/` → 0 matches |
| `getLastWebMessageAge` + `useWeb` removed | COVERED | grep `getLastWebMessageAge\|useWeb` in `packages/dashboard/src/` → 0 matches |
| `alert()` `getOutboundChannel()` same-channel comparison simplified | COVERED | `conversation-initiator.ts:126–132` — `isSameChannel` check only, no preferred-vs-target reasoning inside alert |
| `automation-server.ts` `fire_automation` hardcode | COVERED | `mcp/automation-server.ts:233–234` — `fire(automation, args.context ?? {})` |
| `automation-server.ts` `create_automation` auto-fire hardcode | COVERED | `mcp/automation-server.ts:159–160` — `fire(automation, {})` |
| `app.ts` mount_failure hardcode | COVERED | `app.ts:1619` — `alert(prompt)` no options |
| `routes/automations.ts` stop-job hardcode | COVERED | `routes/automations.ts` — diff confirms line removed |
| Tests asserting `sourceChannel="dashboard"` semantics rewritten | COVERED | `tests/unit/notifications/source-channel.test.ts` deleted; `tests/conversation-initiator.test.ts` rewritten to presence-rule assertions |

### § "What gets added"

| Row | Status | Evidence |
|---|---|---|
| `ConversationManager.getLastUserTurn(convId)` | COVERED | `conversations/manager.ts:190–194`, `conversations/transcript.ts:196–223` |
| Presence check in `alert()` | COVERED | `conversation-initiator.ts:99–107` |
| Integration test WA→automation→WA | COVERED | `routing-presence.test.ts` "WA inbound → automation completion → delivered to WA" |
| Integration test dashboard→automation→dashboard | COVERED | "dashboard-only inbound → automation completion → delivered to web" |
| Integration test WA→user switches to dashboard within 15 min | COVERED | "channel switch within 15 min: WA inbound then web turn → completion lands on web" |

### § "File Map"

All 13 listed files appear in `git diff master...HEAD --stat` with the expected edit shape. The following incidental file also changed and is consistent with the plan intent:
- `packages/dashboard/src/server.ts` — Fastify decorator interface updated to drop `sourceChannel` from the `alert()` signature. Not in the File Map but necessary for typecheck to succeed. Not flagged as deviation because it's a mechanical propagation of the type change.

### § "Tasks"

| Task | Status | Evidence |
|---|---|---|
| Task 1: `getLastUserTurn()` helper | COVERED | `transcript.ts:196–223` tail-scan + `manager.ts:190–194` async wrapper; 7 unit tests pass |
| Task 2: Rewrite `alert()` with presence rule | COVERED | `conversation-initiator.ts:87–148`, 16 unit tests including channel-switch branch (`conversation-initiator.test.ts:267`, `:293`, `:327`) |
| Task 3: Delete `sourceChannel` plumbing | COVERED | All 4 hardcode sites + 5 read sites removed; scheduler comment updated |
| Task 4: Delete obsolete tests; rewrite salvageable ones | COVERED | `source-channel.test.ts` deleted; initiator tests rewritten |
| Task 5: Integration tests | COVERED | `routing-presence.test.ts` — 6 passing scenarios including the 3 required + 3 extra (stale cron, mount_failure, legacy-field tolerance) |
| Task 6: Deliver lost research message | NOT DONE (correctly) | Plan says post-merge manual step. DECISIONS.md confirms: "no auto-merge... Task 6 Option A approved" for post-merge execution |
| Task 7: Roadmap + memory | COVERED | `ROADMAP.md` updated (M10 status → In Progress, S0 → In Review); `whatsapp-bleed-issue-4.md` written; `whatsapp-bleed-issue-3.md` annotated with reversion note |

### § "Acceptance criteria"

| Item | Status | Evidence |
|---|---|---|
| 1. grep `sourceChannel` in `packages/dashboard/src/` → 0 prod matches | PASS | grep returns empty |
| 2. grep `source_channel` in `packages/dashboard/src/` → 0 matches | PASS | grep returns empty |
| 3. Integration tests in `routing-presence.test.ts` pass | PASS | 6/6 |
| 4. Existing test suite passes after rewrites | PASS (caveated) | 1184/1200 pass; 12 skipped; 4 fail — all 4 reproduce on master, unrelated to routing. See test-report.md. |
| 5. Manual verification on live dashboard | DEFERRED | Plan explicitly defers to post-merge Task 6 |

---

## Test Results

Summary (full command output in `test-report.md`):

| Command | Result |
|---|---|
| `cd packages/dashboard && npx tsc --noEmit` | Exit 0 |
| `cd packages/core && npx tsc --noEmit` | Exit 0 |
| `grep -rn "sourceChannel\|source_channel" packages/dashboard/src/` | 0 matches |
| `npx vitest run tests/integration/routing-presence.test.ts` | 6/6 pass |
| `npx vitest run tests/conversations/get-last-user-turn.test.ts` | 7/7 pass |
| `npx vitest run tests/conversation-initiator.test.ts` | 16/16 pass |
| `npx vitest run` (full) | 1184 pass / 12 skipped / 4 fail (1200 total) |
| Same 4 failing files on `master` baseline | 4 fail / 22 pass |

**Pre-existing failures verified** by checking out master and re-running only the failing files: identical 4 failures reproduce, none related to routing. Not introduced by M10-S0.

---

## Browser Verification

**Skipped** — justified per `docs/procedures/external-reviewer.md`.

Diff audit: only internal routing logic and a Fastify decorator type change. No files under `packages/dashboard/public/`. No route handler signature changes (stop-job POST handler body is the same shape; only the enqueued notification no longer contains a `source_channel` field). No server-startup code modified.

The two failing Playwright browser tests pre-date this branch and are unrelated (`automation-ui.test.ts` fails on auth env for a fire test; `progress-card.test.ts` on a status-icon assertion).

---

## Gap Analysis

**Type-erasure risk (`PersistentNotification.source_channel` removal):**
Checked for any production read of the field on a typed value. `grep source_channel packages/dashboard/src/` returns zero. TypeScript `tsc --noEmit` exits 0 across both packages. Safe.

**Test-mock realism:**
`routing-presence.test.ts` mocks `ChatServiceLike` and `TransportManagerLike` — the exact interfaces exported from `conversation-initiator.ts:18–46`. The mocks implement every required method; signatures match (verified by inspecting both files). `AppHarness` provides the real `ConversationManager`, `HeartbeatService`, and `PersistentNotificationQueue`, so the routing-critical path is exercised in production shape. Good fidelity.

**Channel-switch behavior (plan Task 2 Step 4):**
Implemented at `conversation-initiator.ts:125–132`: resolves target channel's ownerJid, compares with `current.externalParty`, and if mismatched calls `this.initiate({ firstTurnPrompt: "[SYSTEM: ...]" })` — starting a new conversation on the target channel. Two dedicated unit tests: `conversation-initiator.test.ts:267` (stale → preferred channel, new conversation created) and `:293` (same-channel match → continues current conversation).

**Deserialization tolerance for stale on-disk field:**
`persistent-queue.ts:47–53` — `listPending()` reads via `JSON.parse` and casts to `PersistentNotification`. JS `JSON.parse` ignores unknown fields; the cast strips them at type level. Explicitly tested by `routing-presence.test.ts` "legacy on-disk notification with source_channel field deserializes cleanly" (written with `@ts-expect-error` to force the legacy field onto disk). Passes.

**`automation-server.ts` `create_automation` auto-fire:**
`mcp/automation-server.ts:159–160` now reads `deps.processor.fire(automation, {})` — no `sourceChannel` injection. `fire_automation` at `:233–234` passes `args.context ?? {}` — matches plan's "raw args.context (or nothing)" requirement exactly.

**Stale `webAge`/`useWeb` references:**
grep `webAge\|useWeb\|isDashboardSourced\|getLastWebMessageAge\|dashboard-sourced` across `packages/dashboard/src/` → 0 matches. The two hits in `packages/dashboard/tests/` are deliberate (a comment at `conversation-initiator.test.ts:245` and commentary in the integration test explaining the pre-fix scenario). Clean.

**Undocumented deviations:**
`DEVIATIONS.md` is empty. One minor file change is not in the plan's File Map: `packages/dashboard/src/server.ts` (Fastify decorator `alert` signature drops `sourceChannel`). This is a mechanical type propagation required for typecheck; listing it as a deviation would be pedantic. Not flagged.

**`app.ts` three enqueue sites:**
Plan calls out `:1453`, `:1484`, `:1509`. Diff confirms three `source_channel:` reads were deleted at three distinct enqueue sites. Exact line numbers drifted slightly due to surrounding edits but all three sites matched.

**Active-session identity vs presence (sanity check):**
Confirmed new rule is purely conversation-transcript-based. No check of `SessionManager.channel` or any sticky session state — which is the precise failure mode called out in the plan's red-team section (sticky channel re-opens Issue #3). Good.

**Concerns noted but not blocking:**
- `forwardToChannel` silently swallows channel-disconnected failures (logs + returns). Plan acknowledges this as potential follow-up "M10-S0.1". Not this sprint's scope.
- No test exercises `thresholdMinutes` being overridden by `ConversationInitiatorOptions.activityThresholdMinutes`, but the override path is obvious and the 15-min default is what production runs.

---

## Verdict

**PASS**

All planned tasks (1, 2, 3, 4, 5, 7) are implemented to spec with no undocumented deviations. Task 6 is correctly deferred per plan. Mechanical acceptance (items 1–4) passes; item 5 is the plan-approved post-merge manual step. Core architectural change is clean: the `sourceChannel` abstraction is fully excised from production code, the presence rule is implemented as a pure function of conversation transcript + operator preference, and the regression net (13 new tests + 16 rewritten) locks in the behavior for Issues #2/#3/#4. Four pre-existing test failures on master reproduce unchanged — not attributable to this sprint.

Recommend merge after the trip-review walkthrough and execution of Task 6 (production re-delivery of job `594f1962`) as planned.
