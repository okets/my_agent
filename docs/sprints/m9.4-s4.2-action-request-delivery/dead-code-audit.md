---
sprint: M9.4-S4.2 (audit)
auditor: subagent (read-only)
date: 2026-04-26
scope: brief delivery chain (S4 → S4.1 → S4.2)
---

# Dead Code & Stale Functionality Audit — Brief Delivery Chain

Three rounds of rework (S4, S4.1, planned S4.2) have left dead code, stale comments, lying documentation, and superseded tests in the brief-delivery chain. This audit walks the chain and surfaces what to delete or fix.

---

## Top findings (priority order)

### 1. `SessionManager.queueNotification()` / `hasPendingNotifications()` / the entire `pendingNotifications` queue is dead

**Files:**
- `packages/dashboard/src/agent/session-manager.ts:376` (field), `:685-703` (drain), `:898-920` (public API), `:923` (`injectSystemTurn` is the only consumer of the wrap pattern).

**Stale:** `grep -rn '\.queueNotification\|\.hasPendingNotifications' packages/ ` outside session-manager.ts returns ZERO matches in source or tests. Every caller of "send a system notification while busy" routes through `notificationQueue` (PersistentNotificationQueue) → heartbeat → `ci.alert()` instead. The `pendingNotifications: string[]` field, its splice/`[SYSTEM:]`-wrapping drain at `streamMessage:685-703`, and the public methods exist for no caller.

**What's stale beyond "dead":** the S4.2 plan's Task 7 spends a full task adding a `kind` discriminator to this queue, and the audit's Top-1 finding is built on the assumption that "future callers" might use it. The cleaner action is to delete the queue entirely. If a future S4.2 caller ever needs in-band system notifications during a busy stream, they should add `injectActionRequest` (S4.2 Task 3) and skip this graveyard.

**What should happen:** delete the field, the drain block in `streamMessage`, both public methods, and the `BriefingResult`-adjacent doc comment that references "queued notifications". S4.2 Task 7 collapses from "audit + reconcile + add discriminator + tests" to "delete and verify zero callers".

**Blast radius:** Low. No code reads or writes outside session-manager.ts. Removing simplifies S4.2 and shrinks `streamMessage` by ~20 lines.

---

### 2. `heartbeat-service.ts` `verbatimFraming` constant + the entire `formatNotification(job_completed)` body is what S4.2 explicitly rewrites — but the comments and constant are still labeled as the load-bearing fix from S4

**Files:**
- `packages/dashboard/src/automations/heartbeat-service.ts:378-386` — `const verbatimFraming = "Forward these results to the user verbatim..."` and the `Background work results:\n\n${n.summary}\n\n${verbatimFraming}` template.
- `:395` — comment "passed through verbatim" on the `infra_alert` branch.
- `:309-314` — `[SYSTEM: ${prompt}]` wrap inside `initiate()` fallback.

**Stale:** S4 introduced verbatim framing as the core fix; S4.1's own review (line 73 of S4 review.md) marks it PASS; S4.2's plan (lines 27, 333-358) calls this exact code "the load-bearing change" to remove because mid-conversation gravity defeats the verbatim clause. The `console.log("[Heartbeat] Delivering job_completed with VERBATIM framing")` at line 385 is celebratory telemetry for a fix that shipped a regression.

**What should happen:** S4.2 Task 6 already covers rewriting this site. The audit is flagging that there is nothing to preserve from the S4 vintage code other than the `infra_alert` passthrough. Cleanly delete `verbatimFraming`, the `Background work results:` template, and the celebratory `console.log` together — don't try to keep "verbatim framing" as a fallback under the feature flag (S4.2 Task 13). The flag should toggle the *route* (action-request vs system-message), not preserve obsolete prompt content.

**Blast radius:** Medium. Touches the same lines S4.2 Task 6 owns. Recommend folding cleanup INTO Task 6's atomic commit (the plan already lists this site in scope; the audit just argues for being more aggressive about deletion vs. flag-gated retention).

---

### 3. `[Pending Briefing]` block in `system-prompt-builder.ts:158-164` lies about "verbatim" while the heartbeat path is the one supposed to enforce verbatim

**Files:**
- `packages/dashboard/src/agent/system-prompt-builder.ts:158-164` — `[Pending Briefing]` body says "Forward these results to the user verbatim. Adjust tone for conversation but do not summarize or paraphrase the content."

**Stale:** Two compounding issues. (a) S4.2 plan Task 6 renames this `[Pending Briefing]` → `[Pending Deliveries]` with action-request framing — same regression target as the heartbeat. (b) The current text already drifted from the heartbeat's `verbatimFraming`: heartbeat says "do not summarize, paraphrase, **or editorialize**"; system-prompt says "do not summarize or paraphrase". Two near-identical strings, two slightly different invariants, both about to be replaced.

**What should happen:** S4.2 Task 6 covers this. Once `[Pending Briefing]` is rewritten as `[Pending Deliveries]`, the S4-era duplicated invariant goes away. No retention needed.

**Blast radius:** Medium — broken by `tests/integration/status-prompt-acceptance.test.ts:118-150,278-289` (5 assertions on the literal string `[Pending Briefing]`). Tests must be rewritten in lockstep with the code change.

---

### 4. Dashboard `CLAUDE.md` "System Prompt Injections" section openly contradicts the code, both before and after S4.2

**Files:**
- `packages/dashboard/CLAUDE.md` — "System Prompt Injections (Brain Notifications)" section.

**Stale:** The doc says: *"Never pre-wrap prompts in `[SYSTEM: ...]` — `injectSystemTurn()` handles wrapping for the `alert()` path. Only wrap in the `initiate()` fallback path."* But:
- `conversation-initiator.ts:184` pre-wraps in the channel-switch initiate call.
- `heartbeat-service.ts:313` pre-wraps in the no_conversation initiate fallback.
- `automation-processor.ts:306` pre-wraps in the queue-fallback initiate call.
- `app.ts:726` pre-wraps in the `AutomationNotifier` initiate fallback.

Four pre-wrap sites despite the rule. The audit's Concern #12 already flagged this; S4.2's Task 12 rewrites the doc. The audit confirms it is a paper rule, not enforced. The doc's example pattern (`if (!alerted) await ci.initiate(...)`) is also stale — `alerted` is now an object, not a boolean (see `app.ts:720` comment: "Pre-M9.4-S4.1 this was `if (!alerted)` which never fired").

**What should happen:** S4.2 Task 12 rewrites the section. Make sure it deletes the if-not-alerted example and reflects the four real wrap sites being collapsed to none (or one — infra_alert).

**Blast radius:** Low (doc only) but high signal — every future contributor reads this file and gets misled.

---

### 5. `summary-resolver.ts` — `resolveJobSummary` (sync, 2000-char DB display) survives but is easy to confuse with `resolveJobSummaryAsync` (10K Haiku)

**Files:**
- `packages/dashboard/src/automations/summary-resolver.ts:66-77` — sync `resolveJobSummary`, with `DB_DISPLAY_LIMIT = 2000` and `DB_TRUNCATION_NOTICE = "\n\n[Full results in job workspace]"`.
- Three sync callers: `automation-executor.ts:283, 717, 973` — all writing to `job.summary` SQLite column.

**Stale-ish:** Not dead, but the file's name suggests one resolver and the export of two with near-identical names is a foot-gun. S4.1's architect-review (line 67) flagged that the sync version was used in 3 DB sites. S4 fixed the notification path (now uses async). The sync function is correct (DB column has finite room), but its name should be `resolveJobSummaryForDb` or it should be inlined, since the only contract is "write to SQLite job.summary; full content stays on disk".

**What should happen:** Out of scope for S4.2 trigger conversion, but worth a one-line rename in a follow-up to prevent regression where someone wires the sync 2K version into a delivery path.

**Blast radius:** Low. Three call sites, all in automation-executor. Pure rename.

---

### 6. `~30` disabled cfr-fix-* automations and 3 disabled build-* automations clutter `.my_agent/automations/`

**Files:**
- `.my_agent/automations/cfr-fix-*.md` — 26 disabled (52 total cfr-fix files counting `.jsonl` siblings).
- `.my_agent/automations/build-*-capability.md` — 3 disabled (oldest April 5, newest April 13).
- Total directory: 133 files, 57 marked `status: disabled`.

**Stale:** S4.2 plan Task 8 fixes the *future* default (`notify: none` for system-flagged) but does not touch the existing disabled drift. The audit explicitly asks whether these should be archived; recommendation: yes, before S4.2 Task 16 soak begins, so the morning brief queue is unambiguous and `notify` defaults work as expected on remaining live automations.

**What should happen:** Add a Task 8.6-prime step: `mv .my_agent/automations/{cfr-fix-*,build-*-capability}.{md,jsonl} .my_agent/automations/_archive/` (or similar). Local-only data; not a code change. Independent of code-level fix in Task 8.

**Blast radius:** Local-only. AutomationManager re-scans on boot, so disabled+filed-away automations won't reappear. Pre-soak hygiene only.

---

### 7. `## Brief Requirements` in `standing-orders.md` (lines 38–46) and `M7-S8` doc references to it

**Files:**
- `.my_agent/notebook/reference/standing-orders.md:38-46` — Brief Requirements block.
- `docs/plans/2026-04-07-m9.2-s7-framework-instance-split.md:87` — lists `Brief Requirements` as one of the standing-orders sections being moved.
- `docs/sprints/m7-s8-debrief-workers/review.md:91` — references the (already-deleted-then-restored) `Conversation Voice` section.

**Stale:** S4.2 plan Task 11 already deletes the `## Brief Requirements` block. After deletion, the m9.2-s7 framework-instance-split plan's enumeration of moved sections will name a section that no longer exists. Worth a footnote in that plan's review section, but not a code blocker. The m7-s8 review's claim that `Conversation Voice` exists in standing-orders is already false (was deleted in M6.7 split per S4.2 plan line 39); S4.2 restores it. Both docs become correct again after S4.2 lands.

**What should happen:** Verify after Task 11 lands. No additional cleanup needed beyond the plan.

---

## All other findings (file:line + one-sentence)

- **`packages/dashboard/src/automations/heartbeat-service.ts:386`** — celebratory `console.log("Delivering job_completed with VERBATIM framing")` is stale telemetry for a fix that shipped a regression; delete with the surrounding rewrite.
- **`packages/dashboard/src/automations/automation-processor.ts:306`** — fallback `if (!ci) ... initiate({ firstTurnPrompt: \`[SYSTEM: ${prompt}]\` })` mirrors the same wrap pattern; included in S4.2 Task 6 scope but worth verifying.
- **`packages/dashboard/src/app.ts:720-742`** — comment block "Pre-M9.4-S4.1 this was `if (!alerted)` which never fired" documents history. Once S4.2 lands, this whole AutomationNotifier should also route through `sendActionRequest`; the historical commentary can be condensed.
- **`packages/dashboard/src/agent/conversation-initiator.ts:255`** — default `firstTurnPrompt` is hard-coded `[SYSTEM: ...]`; covered by S4.2 Task 6.3(a).
- **`packages/dashboard/src/agent/session-manager.ts:889-897`** — orphaned doc comment block ("Inject a synthetic system turn... Wraps the prompt in [SYSTEM: ] format...") sits ABOVE the `isStreaming()` method, but actually documents `injectSystemTurn` (the next-but-one method). Reordered/edited at some point; the comment lost its function. Move comment to immediately above `injectSystemTurn` (line 922).
- **`packages/dashboard/src/agent/session-manager.ts:898-901`** — `isStreaming()` has no comment, but inherits the misplaced one above it.
- **`packages/dashboard/tests/integration/status-prompt-acceptance.test.ts:118-150,278-289`** — 5 assertions on the literal string `[Pending Briefing]`. Will fail after S4.2 Task 6 (renames to `[Pending Deliveries]`). Update in same commit.
- **`packages/dashboard/tests/integration/routing-presence.test.ts:135`** — default-fixture summary `"Background work finished."` uses S4-era language. Will work post-S4.2 (it's just a fixture string), but consider renaming to neutral `"Job completed."` so the fixture doesn't perpetuate "background work" framing.
- **`packages/dashboard/tests/integration/mock-session.ts:73-81`** — `MockSessionManager.injectSystemTurn` only mocks the system path. After S4.2 Task 3, mock needs `injectActionRequest` too. S4.2 Task 4.5 mentions `ChatServiceLike` but not the mock-session — add to scope.
- **`packages/dashboard/src/automations/summary-resolver.ts:7-18`** — `CONDENSE_SYSTEM_PROMPT` already says "Return only the condensed markdown — no preamble, no explanation, no meta-commentary." Yet S4.2 Task 10 adds a Haiku-preamble *stripper*. Either the prompt is being ignored by Haiku (telemetry will show), or the prompt is fine and the stripper is belt-and-suspenders. No action; just note that the existing prompt already states the rule the stripper enforces post-hoc.
- **`packages/dashboard/src/agent/system-prompt-builder.ts:160-163`** — `[Pending Briefing]` block uses `briefing.lines` joined by `- `. The `pendingBriefingProvider` in `app.ts:1923-1935` constructs lines that already include `n.summary` (which is `[automation-name] <body>`). Output is double-`-` prefixed in some cases. Pre-existing and unrelated to S4.2, but worth checking when Task 6 rewrites the section.
- **`docs/bugs/2026-04-08-brief-delivery-broken.md:42-46`** — "Origin: added in commit `067a6de` (M7-S3, 2026-03-23) as a defensive guard..." — this is now a fully obsolete defensive guard. The bug is closed; consider moving to an `archive/` subfolder of `docs/bugs/` for discoverability hygiene.
- **`docs/sprints/m9.4-s4-brief-delivery-fix/architect-review.md:67`** — flagged the sync `resolveJobSummary` 15K-char-DB-blowup risk as Concern. S4.1 closed; not a finding here, but if the SQLite `job.summary` column has been observed > 4 KB under the current code, that's a follow-up.
- **`packages/dashboard/src/automations/automation-processor.ts:316-322`** — comment "transport_failed / skipped_busy / send_failed — no queue configured in this fallback path" describes a path that nearly never fires (notificationQueue is always wired in app.ts). Effectively dead code. Worth annotating "// fallback path used only by tests" or removing.

---

## Out of scope / can't tell

- **Whether `pendingBriefingProvider` is used anywhere besides app.ts:1919.** Single registration site is wired; can't confirm whether tests stub it. (`status-prompt-acceptance.test.ts` uses `pendingBriefing` directly in BuildContext, bypassing the provider — so the provider may be production-only.) Without running, I can't confirm whether the test path exercises the queue→provider→prompt flow at all, or just the provider's output shape.
- **Whether the `AutomationProcessor` "fallback: direct ci.alert()" path (`:296-329`) is still reachable.** `app.ts` always wires `notificationQueue`, so the early-return at `:294` always fires. Could not confirm there is no test/init path that constructs `AutomationProcessor` without a queue.
- **Whether `inject` paths in `chat-service.ts` (which I did not read) have additional stale wrappers.** S4.2 Task 4.4 says register `sendActionRequest` "alongside" `sendSystemMessage`; if the chat-service has its own `[SYSTEM:]`-wrapping helpers, those would be a 5th wrap site.
- **Whether the "infra_alert" branch in `formatNotification` (`heartbeat-service.ts:393-396`) has any callers in production.** Comment says "Caller supplies the full user-facing prompt"; could not find a `.enqueue({type:"infra_alert"...})` call site outside tests via grep.
- **`docs/sprints/m7-s8-debrief-workers/review.md:91`** claims standing-orders has Conversation Voice section. The block has been deleted-then-restored across M6.7 and (planned) S4.2. Status of that doc as "stale" depends on when reader arrives. Document is historical; leave as-is, with the caveat that future audits should treat sprint review docs as time-stamped, not as live truth.

---

## Recommendation

**Fold findings 1, 2, 3, 4, 6 into S4.2.** They overlap with tasks already in the plan:

- **Finding 1** (delete `pendingNotifications`/`queueNotification`/`hasPendingNotifications`) — collapses S4.2 Task 7 from "audit + add discriminator + tests" to "delete + verify zero callers". Net code reduction; shrinks attack surface for the load-bearing fix; eliminates the audit's own Top-1 concern by removing the queue rather than fixing it.
- **Findings 2 & 3** (delete `verbatimFraming` + `Background work results:` template; rename `[Pending Briefing]`) — already in S4.2 Task 6 scope; the audit just recommends *delete*, not flag-gated retention. The feature flag (Task 13) should switch routing (`sendActionRequest` vs `sendSystemMessage`), not preserve dead prompt content.
- **Finding 4** (CLAUDE.md drift) — already S4.2 Task 12. Deletion of the `if (!alerted)` example pattern is the audit's specific add to that task.
- **Finding 6** (archive disabled cfr-fix/build-* automations) — local-only data hygiene; takes 30 seconds; should run before Task 16 soak so the soak isn't measuring queue behavior on dead automations. Add as Task 8.6-prime.

**Defer to follow-up:**

- **Finding 5** (rename sync `resolveJobSummary` → `resolveJobSummaryForDb`) — pure rename, three callers, no behavior change. One-PR follow-up after S4.2 stabilizes.
- **Finding 7** (m7-s8 / m9.2-s7 doc references to deleted `Brief Requirements`) — verify in S4.2 sprint sweep (Task 15); footnote if needed; not a blocker.

**Leave alone:**

- The `summary-resolver.ts:7-18` `CONDENSE_SYSTEM_PROMPT` already-says-no-preamble observation. Belt-and-suspenders is fine when telemetry will reveal which mechanism actually catches it.
- `infra_alert` branch retention. Until proven dead in production, a trivial code path with documented contract is cheaper than removal.

**Hygiene principle for next sprint:** the audit found three layers of "wrap content in `[SYSTEM:]`" with comments on each declaring it the load-bearing fix from the most recent sprint. Three sprints in three months is enough; the cleanup payoff scales with how aggressively S4.2 deletes vs. flag-gates. Recommend the team err on the side of deletion this round.
