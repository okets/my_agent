---
sprint: M9.4-S4.2
auditor: subagent (no shared context with plan author)
date: 2026-04-27
verdict: APPROVE-WITH-CHANGES
---

# Plan Audit — M9.4-S4.2

## Verdict

**APPROVE-WITH-CHANGES.** The architectural insight (user-role action-request vs. system-role status-note) is sound and matches the failure data. But three concrete defects will land regressions or false-PASS the verification gate. Fix those three and tighten Task 13 to a multi-day soak before close.

---

## Top 3 Weaknesses

### 1. `pendingNotifications` queue still wraps in `[SYSTEM: …]`

**Files:** `packages/dashboard/src/agent/session-manager.ts:685-702, 908-913, 922-924`.

The plan's central claim is that `injectActionRequest()` calls `streamMessage(prompt)` "unwrapped." But `streamMessage` itself drains `this.pendingNotifications` and prepends them as `[SYSTEM: ${n}]` blocks to whatever `content` is passed in. Any caller of `queueNotification()` (or future caller wired through the action-request path on a busy session) ends up with the action-request prompt prepended with `[SYSTEM: …]` — exactly the framing the sprint claims to abolish. Worse, on the next user turn, queued `[SYSTEM: …]` blocks prepend to the user's message, perpetuating broken framing for any ad-hoc `queueNotification()` callers.

The plan never inspects `pendingNotifications` or reconciles its existence with the action-request principle.

**Action:** add a task that audits all `queueNotification()` callers and either drops the `[SYSTEM: ]` wrapping in the queue path or routes proactive deliveries through a different queue.

---

### 2. Standing-orders cache invalidation silently missing

**Files:** `packages/dashboard/src/agent/system-prompt-builder.ts:56, 81, 208-235`; `packages/core/src/prompt.ts:586`.

`SystemPromptBuilder.getStablePrompt()` caches the assembled prompt in `this.stablePromptCache` for the lifetime of a `SessionManager`. Standing-orders.md is loaded inside that cached block. The plan's Task 10 edits standing-orders.md and immediately moves on — no `invalidateCache()` call, no documented restart requirement, no automated reload.

On the live verification gate the next morning, the dashboard will have been running since the merge. Unless someone restarts `nina-dashboard.service`, the new Voice rule is **not in the prompt**. The verification gate may pass or fail for reasons unrelated to the rule's effect — and if it passes, the team will conclude "action-request alone fixes it" while tool-narration is just dormant.

**Action:** add a step to Task 10 (or Task 12) — restart the dashboard service after standing-orders edits land, and document the cache-invalidation invariant.

---

### 3. Task 8 has a non-existent API and wrong job_type constants

**Files:** `packages/dashboard/src/automations/automation-manager.ts:67, 214, 337`; `packages/core/src/spaces/automation-types.ts:48, 105`; `packages/dashboard/src/automations/automation-executor.ts:237-238`.

(a) Step 8.1's test calls `automationManager.normalizeManifest(manifest)` — no such method exists. The three line numbers (67/214/337) are three different code paths: `create()`, `list()` row deserialization, `frontmatterToManifest()`. Each must be patched independently. Test as written cannot pass without inventing the method or restructuring the test.

(b) The proposed `SYSTEM_JOB_TYPES = new Set(["capability_modify", "capability_create"])` is wrong on the data: there is no `capability_create` job type. Actual enum is `capability_build | capability_modify | generic | research`. `capability_build` is *also* assigned to system-orchestrated runs (e.g., `build-chrome-capability.md`). So those will continue to default to `notify: debrief`. Conversely, a user-authored `job_type: capability_build` from the brainstorm flow would be silently dropped.

The existing `system: boolean` flag (used by `migrations/work-patterns-to-automations.ts:64-67` and persisted in DB at automation-manager.ts:220) is the correct discriminator and the plan ignores it.

**Action:** rewrite Task 8 to use the `system` flag, patch the three sites independently (no fictional helper), and verify both `capability_build` and `capability_modify` system runs are excluded.

---

## Other Concerns

1. Task 9 `stripHaikuPreamble` interacts with `WRAPPER_MARKER` — slicing at first heading drops the wrapper marker for the first section. Existing `condensed.includes(h)` substring guard still passes, but it's an undocumented contract erosion.

2. Task 9 false-positive on legitimate openings ("Here's the AQI", "I'll keep this short — AQI is 151"). Single-section condensed brief without `## ` heading silently falls back to raw — no telemetry distinguishes "stripped" from "no `##` so passthrough."

3. Task 7 thinking-trace regex covers openings only. Mid-document narration passes the validator. Reasonable first cut; plan doesn't acknowledge the residual.

4. Task 7 false-positive risk on legitimate "I need to flag…" or "I'll fetch…". Recommend doubled signal (two narration markers in head) to drop FP rate.

5. **Order-of-operations risk between Tasks 4 and 5.** If Task 4 (alert/initiate route to `sendActionRequest`) lands before Task 5 (action-request prompt content), `formatNotification()` still emits "Background work results: …, forward verbatim" but now delivered as a user-role turn. The model receives a request-shaped turn whose content is system-shaped — *worse* than the status quo. Land Tasks 4+5 in a single commit, invert the order, or feature-flag.

6. Task 11 harness API is fictional (`createTestAppHarness`, `seedConversation`, `completeJob`, `getLastAssistantTurn` don't exist on `AppHarness`). Executor must extend the harness — non-trivial work the plan doesn't budget. Real-LLM mode also costs money and produces non-deterministic output the brittle assertions can flake on.

7. 50-turn synthetic gravity ≠ 3-day real gravity. Apr 25-27 failures were after 30+ turns over 3 days with cached context, real topic, real escalation. Synthetic seed has different cache-control behavior and attention distribution. Test may pass while production fails.

8. Task 13 single-morning observation is not enough. S4 (PASS, 2026-04-10) and S4.1 (PASS, 2026-04-20) both declared this fixed; both followed by production regression. Pattern argues for **7-day soak** before sprint close.

9. No rollback plan / feature flag. Single-user systemd service with global merge-to-master. If Task 5's phrasing causes Nina to over-eagerly deliver mid-conversation, no off-switch except revert-and-redeploy. Feature flag (`PROACTIVE_DELIVERY_AS_ACTION_REQUEST=1`) gated on env, default off, flipped after Task 13, would make rollback a config change.

10. `heartbeat-service.ts:313` `initiate()` fallback hard-codes `[SYSTEM: ${prompt}]` — second site, not listed in Task 4 Step 4.3. If unfixed, `no_conversation` fresh-install path retains broken framing.

11. `ChatServiceLike` interface change risk. Step 3.5 lists `index.ts` and `app.ts` but not `packages/dashboard/src/chat/chat-service.ts` — actual chat service needs the wire too.

12. Dashboard `CLAUDE.md` documents *"Never pre-wrap prompts in `[SYSTEM: ...]` — `injectSystemTurn()` handles wrapping for the `alert()` path. Only wrap in the `initiate()` fallback path."* Today's `conversation-initiator.ts:184` and `heartbeat-service.ts:313` both pre-wrap inside `firstTurnPrompt`. Doc was drifting from code; the plan fixes line 184 but doesn't update the rule. Update the rule (or kill it) as part of this sprint.

13. Risk-log understates "Nina responds too eagerly" — a user-role turn saying "deliver the brief now" mid-conversation can read as the user interrupting themselves; Nina may pivot mid-answer abandoning the prior topic. Add Task 13 check: "Nina returns to the prior topic after delivering."

---

## Couldn't Verify / Assumed

- Whether the Agent SDK distinguishes user-role injection from "real" user messages at the `streamMessage(content)` level. `streamMessage` does not tag content with role metadata — the SDK presumably treats as `user` turn unconditionally. Worth verifying via `claude-developer-platform` skill before Task 2.
- Whether `appendTurn(role: "assistant")` as the only persisted turn (no user turn for the action request) leaves the transcript in a state that downstream consumers (memory sync, daily summary) handle. Pattern matches `send-system-message.ts` so probably fine, but the framing shift is an invariant change.
- Production state of `pendingBriefing` at the moment of an action-request. If a brief is already queued via `pendingBriefingProvider` and the user-role action-request fires, both the system-prompt `[Pending Briefing]` section and the action-request prompt body instruct delivery — no test for this double-instruction case.
- Task 13 timing: whether a service restart between merge and 07:00 BKK is part of deployment runbook. If not, the cached system prompt issue (#2 above) actively blocks.
