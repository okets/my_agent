# M9.4-S4.2: Proactive Delivery as Action Request — Sprint Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run in a dedicated worktree.

**Supplemental to:** [M9.4-S4](../m9.4-s4-brief-delivery-fix/plan.md), [M9.4-S4.1](../m9.4-s4.1-brief-section-preservation/plan.md) — third sprint on the same delivery chain.

**Opened:** 2026-04-27
**Revised:** 2026-04-27 (v2) — folded audit findings (`audit.md`).
**Revised:** 2026-04-27 (v3) — folded dead-code/stale-functionality findings (`dead-code-audit.md`).
**Goal:** Both proactive delivery flavors (`notify: immediate` and `notify: debrief` → debrief-reporter) reliably reach the user even when Conversation Nina is mid-conversation.

**Architecture (one sentence):** Stop injecting completion notifications as system-role context; deliver them as user-role *action requests* that Nina's response loop is trained to fulfill, and clean the raw materials those requests reference.

---

## Why this sprint exists

### The failing pattern (Apr 25–27, conv-01KPYCMD9438AYAKX67BZETHTJ)

| Date | Time (BKK) | Trigger | What Nina sent |
|---|---|---|---|
| Apr 24 | 07:01 | brief | Clean rendered brief — first turn of fresh convo |
| Apr 25 | 07:01 | brief | *"That's the morning brief workers running for tomorrow — ignoring that, it's background. Back to Shopee — did that App Store link work?"* |
| Apr 26 | 07:01 | brief | *"That's the morning brief workers for tomorrow (April 26) — they'll land in the 7am brief. Nothing to action now."* |
| Apr 27 | 07:02 | brief | *"That's tomorrow's brief workers — they'll land at 7am. Nothing to action now."* + tool-narration leakage |
| Apr 27 | 08:04 | relocation session | *"That's tomorrow's 8am relocation session running in the background — it'll deliver at 8am. All good."* |

**The dismissal is symmetric across both delivery flavors.** They share the same final hop: notification → heartbeat formatNotification → `alert()` → `injectSystemTurn` (`[SYSTEM: …]`) → streamMessage. The `[SYSTEM: …]` wrapper makes the model read the prompt as context to factor in, not action to perform. Mid-conversation, Nina's conversational gravity wins over the verbatim-framing clause.

### Compounding production-side problems

S4 + S4.1 fixed brief-pipeline data integrity. Two regressions surfaced afterward:

1. **Worker `deliverable.md` files contaminated** with stream-of-consciousness thinking text. Today's chiang-mai-aqi-worker deliverable opens *"Let me start by checking my todo list.Now let me look at the automation definition.…"* — followed by the actual report. Validator only checks `>= 50 chars`.
2. **CFR-fix automations swept into the debrief queue.** Default `notify` is `debrief`; M9.6 sprints generated `cfr-fix-…` automations that flooded April 22's brief to 37,012 chars.
3. **Haiku condense leaks its own preamble.** Apr 18 brief opened *"I'll help you condense this content to fit within 10,000 characters…"* — Haiku narrating itself.

### The voice-rule regression

M7-S8 (Finding 10) added a *Conversation Voice — don't narrate tool usage* section to `standing-orders.md`. It got deleted during the M6.7 identity/operations split. Without it, Nina defaults to her trained behaviour — narrating tools, talking about workers. Apr 27 turn 44 is exactly this: *"Let me read both files before editing.Now let me read the expat-tips-worker automation definition…"*.

### The "Brief Requirements" leftover

`standing-orders.md` has a `## Brief Requirements` block listing what the daily brief must contain. This is a leftover from before the worker model was authoritative. Today, importance is encoded by *what gets scheduled* — if the AQI worker exists, AQI is in the brief. Standing-orders should not duplicate the worker schedule.

---

## Design principle (promoted from this sprint)

**Proactive deliveries are user-role action requests, not system-role status notes.**

Past-Nina, when she scheduled the brief or the relocation session, was effectively asking future-Nina to deliver something at that time. The injection should speak in that voice: *"Nina, it's brief time, present today's brief now"* — not *"a working agent completed a task, results: …"*. The artifact is referenced by file path; future-Nina reads, renders in her voice, sends. Editorial freedom inside each section, no silent dropping of sections.

---

## Audit fixes folded in (v2 over v1)

- **Top-1 fix:** `pendingNotifications` queue. v2 added Task 7 to audit and reconcile (add `kind` discriminator).
- **Top-2 fix:** Standing-orders cache invalidation. Added explicit service restart step to Task 11.
- **Top-3 fix:** Task 8 rewritten — uses existing `system: boolean` flag, not non-existent `job_type` constants.
- **Order-of-ops fix:** Trigger conversion (Tasks 4+5+6) merged into one atomic Task 6, single commit.
- **Second wrap site:** `heartbeat-service.ts:313` added to Task 6 scope.
- **Wiring fix:** `chat-service.ts` registration added to Task 4.
- **Validator fix:** Doubled-signal acknowledgement in Task 5.
- **Telemetry fix:** Haiku preamble stripping emits telemetry distinguishing "stripped" from "no `##` passthrough".
- **CLAUDE.md drift:** New Task 12 updates the dashboard CLAUDE.md rule.
- **Feature flag:** Task 13 — `PROACTIVE_DELIVERY_AS_ACTION_REQUEST` env gate.
- **Harness reality check:** Task 14 extends `AppHarness` rather than calling fictional methods.
- **7-day soak:** Task 16 is multi-morning, not single-morning.
- **SDK pre-flight:** Task 2 verifies the user-role assumption.

## Dead-code findings folded in (v3 over v2)

- **Task 7 changed shape entirely.** `pendingNotifications` queue has zero external callers (verified by grep). v2 added a `kind` discriminator to a graveyard. **v3 deletes the queue** — field, drain block, both public methods. Net code reduction. The audit's Top-1 concern dissolves rather than is fixed.
- **Task 6 deletes (not flag-gates) obsolete prompt content.** The feature flag (Task 13) controls *routing* (sendActionRequest vs sendSystemMessage), not preserves dead prompt text. `verbatimFraming` constant, `Background work results:` template, celebratory `console.log("Delivering job_completed with VERBATIM framing")`, and the `[Pending Briefing]` literal are deleted outright; `formatNotification` always emits the new action-request prompt regardless of routing.
- **Task 6 also deletes the `if (!alerted)` historical commentary** in `app.ts:720-742` (dead since S4.1; alerted is now an object) and any remaining `[SYSTEM: …]` pre-wrap sites at `automation-processor.ts:306` and `app.ts:726`.
- **Task 4 expanded to update `MockSessionManager`** (`tests/integration/mock-session.ts:31, 73`) with parallel `injectActionRequest` mock. v2 missed this; tests would fail without it.
- **Task 6 includes test fixture updates.** `tests/integration/status-prompt-acceptance.test.ts:118-150, 278-289` has 5 assertions on the literal string `[Pending Briefing]` — must update in lockstep with the rename. `routing-presence.test.ts:135` fixture string `"Background work finished."` updated to neutral language.
- **New Task 8.7 archives ~26 disabled cfr-fix-* and 3 build-*-capability automations** to `.my_agent/automations/_archive/` BEFORE Task 16 soak begins. Local-only data hygiene; soak measures live automation behavior, not zombie clutter.
- **Task 6 fixes orphaned docstring** at `session-manager.ts:889-897` (describes `injectSystemTurn` but sits above `isStreaming()` due to past edits).
- **Deferred to follow-up:** rename sync `resolveJobSummary` → `resolveJobSummaryForDb` (3 callers, pure rename); footnote `m9.2-s7` plan reference to deleted `Brief Requirements` block; `infra_alert` branch retention pending production evidence.

---

## Scope — files changed

| Action | File | Change |
|--------|------|--------|
| Add | `packages/dashboard/src/agent/session-manager.ts` | New `injectActionRequest(prompt)` method (no `[SYSTEM: ]` wrap). Add `invalidateCache()` exposed for standing-orders edits. |
| Modify | `packages/dashboard/src/agent/session-manager.ts` (`pendingNotifications` drain) | Audit notification-prepend path; ensure proactive deliveries do not double-wrap. |
| Add | `packages/dashboard/src/chat/send-action-request.ts` | New chat path mirroring `send-system-message.ts` but routing through `injectActionRequest`. |
| Modify | `packages/dashboard/src/chat/chat-service.ts` | Register `sendActionRequest` on the chat service interface alongside `sendSystemMessage`. |
| Modify | `packages/dashboard/src/agent/conversation-initiator.ts` | `alert()` (web + same-channel paths) and `initiate()` route through `sendActionRequest`. Default `firstTurnPrompt` no longer wrapped in `[SYSTEM: ]`. |
| Modify | `packages/dashboard/src/automations/heartbeat-service.ts` | `formatNotification.job_completed` becomes action-request prompt with artifact path. Drop `[SYSTEM: …]` wrap at `:313` (second site). |
| Modify | `packages/dashboard/src/agent/system-prompt-builder.ts` | `[Pending Briefing]` becomes `[Pending Deliveries]` with action-request framing. |
| Modify | `packages/dashboard/src/automations/types.ts` | Add `run_dir?: string` to `PersistentNotification`. |
| Modify | `packages/dashboard/src/app.ts`, `automation-processor.ts` | Populate `run_dir` at every `notificationQueue.enqueue` for `job_completed`. |
| Modify | `packages/dashboard/src/automations/todo-validators.ts` | `deliverable_written` rejects thinking-trace openings (doubled-signal heuristic). |
| Modify | `packages/dashboard/src/automations/todo-templates.ts` | Worker deliverable todo prompt strengthened — Write tool, no thinking, final step. |
| Modify | `packages/dashboard/src/automations/automation-manager.ts` | `notify` default depends on `manifest.system` flag (true → `none`, false → `debrief`). Patches `create()` line 67, `list()` line 214, `frontmatterToManifest()` line 337 independently. |
| Modify | `packages/dashboard/src/automations/summary-resolver.ts` | Strip Haiku conversational preamble; emit telemetry distinguishing stripped from passthrough. |
| Modify | `packages/dashboard/src/env.ts` (or equivalent) | Read `PROACTIVE_DELIVERY_AS_ACTION_REQUEST` env (default `"1"`). Plumb through to `heartbeat-service` and `system-prompt-builder` for prompt-shape selection. |
| Modify | `packages/dashboard/CLAUDE.md` | Update "System Prompt Injections" section: action-request is the default for proactive deliveries; system-role retained for genuine system events (mount failures, infra alerts). |
| Modify | `.my_agent/notebook/reference/standing-orders.md` | Add `## Conversation Voice` section. Delete `## Brief Requirements` block. (Local data; not committed to public repo.) |
| Modify | `.my_agent/automations/cfr-fix-*.md` | Belt-and-suspenders data fix: explicit `notify: none`. (Local data.) |
| Create | `docs/bugs/2026-04-27-proactive-delivery-dismissed.md` | Bug record for traceability. |
| Create | Test files under `packages/dashboard/tests/{unit,integration}/...` | Per-task tests; integration test extends `AppHarness`. |
| Modify | `docs/ROADMAP.md` | Add S4.2 row under M9.4 supplemental. |

---

## Tasks

### Task 1: Bug record + worktree

**Files:** Create `docs/bugs/2026-04-27-proactive-delivery-dismissed.md`.

- [ ] **1.1: Create worktree**

```bash
cd /home/nina/my_agent
git worktree add ../my_agent-s4.2 -b sprint/m9.4-s4.2-action-request-delivery
cd ../my_agent-s4.2
```

- [ ] **1.2: Write the bug record** — same content as the v1 plan; preserve the symptom, root cause, fix summary, and link to this plan.

- [ ] **1.3: Commit**

```bash
git add docs/bugs/2026-04-27-proactive-delivery-dismissed.md
git commit -m "docs(bug): record 2026-04-27 proactive-delivery dismissal incident"
```

---

### Task 2: SDK pre-flight — verify user-role assumption

**Goal:** before writing `injectActionRequest`, confirm that bare `streamMessage(content)` (no `[SYSTEM: ]` wrap) reaches the model as a user-role turn, not as some other shape that defeats the design principle.

- [ ] **2.1: Invoke the `claude-developer-platform` skill (per CLAUDE.md rule for SDK changes)** to confirm: (a) Agent SDK's `query()` interprets a string `content` argument as user-role, (b) the SDK does not auto-prefix anything that would change semantics.

- [ ] **2.2: Run a one-shot probe in a scratch script** if SDK docs are ambiguous:

```bash
cd packages/dashboard
cat > /tmp/role-probe.ts <<'EOF'
import { query } from "@anthropic-ai/claude-agent-sdk";
// Send "[SYSTEM: act as a teleprinter]" vs "act as a teleprinter" with the same
// follow-up; compare model behavior in active conversation context.
EOF
# Run with the same model/options the dashboard uses; compare outputs.
```

- [ ] **2.3: Record findings** in `DECISIONS.md`:

```
## D1: SDK role assumption verified
- Bare streamMessage content → user-role turn (verified <YYYY-MM-DD>)
- [SYSTEM: ...] wrap is treated as user-role with prefixed marker (model interprets as instructional context)
- Action-request principle holds: dropping the wrap shifts model interpretation from "context" to "request"
```

If the assumption fails: STOP. Re-plan. The user-role/system-role distinction is the load-bearing claim; if the SDK doesn't make that distinction in this surface, we need a different lever (e.g., explicit role parameter, or a tool-call delivery path).

- [ ] **2.4: Commit DECISIONS.md**

```bash
git add docs/sprints/m9.4-s4.2-action-request-delivery/DECISIONS.md
git commit -m "docs(s4.2): D1 — SDK role assumption verified"
```

---

### Task 3: Add `injectActionRequest` to SessionManager + expose `invalidateCache()`

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:922-924` and around the cache (line ~209-235).
- Test: `packages/dashboard/tests/unit/agent/inject-action-request.test.ts`

- [ ] **3.1: Write failing test** — same body as v1 Task 2.1 (asserts `injectActionRequest` calls `streamMessage` with prompt unwrapped, distinct from `injectSystemTurn`).

- [ ] **3.2: Run, confirm FAIL**

- [ ] **3.3: Implement `injectActionRequest`** (same code as v1 Task 2.3).

- [ ] **3.4: Add public `invalidateCache()` accessor on `SystemPromptBuilder`** — referenced by Task 11 below to flush after standing-orders edits at runtime if we ever do hot reload (currently restart suffices, but we don't want a future caller to be unable to invalidate).

```typescript
// packages/dashboard/src/agent/system-prompt-builder.ts (around line 234)
public invalidateCache(): void {
  this.stablePromptCache = null;
}
```

- [ ] **3.5: Run test → PASS, typecheck**

- [ ] **3.6: Commit**

```bash
git add packages/dashboard/src/agent/session-manager.ts \
        packages/dashboard/src/agent/system-prompt-builder.ts \
        packages/dashboard/tests/unit/agent/inject-action-request.test.ts
git commit -m "feat(s4.2): injectActionRequest + invalidateCache primitives"
```

---

### Task 4: `sendActionRequest` chat path + `chat-service.ts` wiring

**Files:**
- Create: `packages/dashboard/src/chat/send-action-request.ts`
- Modify: `packages/dashboard/src/chat/chat-service.ts` — register the function on the chat service interface.
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts` — extend `ChatServiceLike` interface (line 24) with `sendActionRequest` method **alongside** `sendSystemMessage`. Both remain callable; `sendSystemMessage` is now reserved for genuine system events (infra alerts).
- Modify: `packages/dashboard/tests/integration/mock-session.ts:31, 73` — add `injectActionRequest` parallel mock to `MockSessionManager`. Without this, integration tests using mock sessions cannot exercise the action-request path.
- Test: `packages/dashboard/tests/unit/chat/send-action-request.test.ts`

- [ ] **4.1: Write failing test** — same body as v1 Task 3.1.

- [ ] **4.2: Run, confirm FAIL.**

- [ ] **4.3: Implement `send-action-request.ts`** — same body as v1 Task 3.3.

- [ ] **4.4: Wire on chat-service.ts**

Find the chat service registration site (`packages/dashboard/src/chat/chat-service.ts` or wherever `sendSystemMessage` is exported as a method on the App's chat service). Add `sendActionRequest` parallel to it:

```typescript
// chat-service.ts (parallel to existing sendSystemMessage registration)
sendActionRequest: (
  conversationId: string,
  prompt: string,
  turnNumber: number,
  options?: SystemMessageOptions,
) => sendActionRequest(app, conversationId, prompt, turnNumber, options),
```

While you're in this file, **grep for any internal `[SYSTEM:`-wrapping helpers** (`grep -n 'SYSTEM:' packages/dashboard/src/chat/`) — if a chat-service-internal wrapper exists beyond `injectSystemTurn`, add it to Task 6 scope.

- [ ] **4.5: Add `injectActionRequest` to MockSessionManager**

In `packages/dashboard/tests/integration/mock-session.ts:31`, add a parallel async generator after `injectSystemTurn`:

```typescript
async *injectActionRequest(
  prompt: string,
): AsyncGenerator<{ type: string; text?: string; message?: string }> {
  // Mirror injectSystemTurn shape but without the [SYSTEM: ] wrap signal in
  // the recorded prompt. Test helpers can assert which method was called.
  this.lastInjectedPrompt = prompt;
  this.lastInjectionKind = "action_request";
  yield { type: "text_delta", text: this.options?.mockResponse ?? "ok" };
  yield { type: "done" };
}
```

(Add `lastInjectionKind` field to the mock if it doesn't exist; tests can assert `lastInjectionKind === "action_request"` to verify routing.)

- [ ] **4.6: Extend `ChatServiceLike` interface** in `conversation-initiator.ts:24`:

```typescript
export interface ChatServiceLike {
  sendSystemMessage(...): AsyncGenerator<ChatEvent>;
  sendActionRequest(...): AsyncGenerator<ChatEvent>;  // NEW
}
```

- [ ] **4.7: Run test → PASS, typecheck**

- [ ] **4.8: Commit**

```bash
git add packages/dashboard/src/chat/send-action-request.ts \
        packages/dashboard/src/chat/chat-service.ts \
        packages/dashboard/src/chat/index.ts \
        packages/dashboard/src/app.ts \
        packages/dashboard/src/agent/conversation-initiator.ts \
        packages/dashboard/tests/unit/chat/send-action-request.test.ts
git commit -m "feat(s4.2): sendActionRequest chat path — registered on ChatService"
```

---

### Task 5: Worker deliverable cleanliness — validator (doubled-signal heuristic)

**Files:**
- Modify: `packages/dashboard/src/automations/todo-validators.ts:105-121`
- Modify: `packages/dashboard/src/automations/todo-templates.ts:55, 73`
- Test: `packages/dashboard/tests/unit/automations/todo-validators.test.ts`

(Moved earlier than the trigger-conversion task because clean deliverables benefit BOTH the new and old paths, and reduce risk during the trigger conversion.)

- [ ] **5.1: Write failing tests** — same as v1 Task 7.1, plus:

```typescript
it("doubled-signal — accepts opening with single weak match if no second narration follows", () => {
  // 'I need to' is a weak match — accept if the rest is the report
  writeFileSync(join(tmp, "deliverable.md"),
    "I need to flag — AQI sensors at North-East station were offline today.\n\n## AQI Report\n**AQI: estimated 145 (Unhealthy for Sensitive Groups)**\nPM2.5: ~52 µg/m³");
  const result = validators.deliverable_written(tmp);
  expect(result.passed).toBe(true);
});

it("doubled-signal — rejects when two narration markers appear in head", () => {
  writeFileSync(join(tmp, "deliverable.md"),
    "Let me check the news. Now let me look at the AQI.\n\n## Report\n**AQI: 151**");
  const result = validators.deliverable_written(tmp);
  expect(result.passed).toBe(false);
});
```

- [ ] **5.2: Run, confirm FAIL on doubled-signal cases**

- [ ] **5.3: Implement doubled-signal heuristic**

```typescript
deliverable_written: (runDir) => {
  const path = join(runDir, "deliverable.md");
  if (!existsSync(path)) return { passed: false, reason: "deliverable.md does not exist" };
  const raw = readFileSync(path, "utf-8");
  const stripped = stripFrontmatter(raw).trim();
  if (stripped.length < 50) return { passed: false, reason: "deliverable.md too short" };

  const STRONG_OPENERS = [
    /^Let me start by\b/i,
    /^I'll start by\b/i,
    /^I'll help (you )?(condense|summarize|format)\b/i,
    /^Now I'll (start|check|look)\b/i,
    /^Here'?s what I'?ll do\b/i,
    /^Let'?s check\b/i,
  ];
  // Second-marker detection: any "Let me / Now let me" appearing within first 300 chars
  const SECOND_MARKERS = /\b(Now let me|Let me (check|look|fetch|read)|I'll (check|fetch|read|look))\b/gi;

  const head = stripped.slice(0, 300);
  const strongHit = STRONG_OPENERS.some(p => p.test(head));
  const secondMatches = (head.match(SECOND_MARKERS) || []).length;

  // Reject if: (a) strong opener pattern, OR (b) two or more weak narration markers in head
  if (strongHit) {
    return { passed: false, reason: `deliverable.md opens with strong narration pattern. Use Write tool to emit the report only.` };
  }
  if (secondMatches >= 2) {
    return { passed: false, reason: `deliverable.md has ${secondMatches} narration markers in head — looks like stream-of-consciousness, not a final report.` };
  }
  return { passed: true };
},
```

- [ ] **5.4: Update `todo-templates.ts`** — same as v1 Task 7.5.

- [ ] **5.5: Run test → PASS**

- [ ] **5.6: Commit**

```bash
git add packages/dashboard/src/automations/todo-validators.ts \
        packages/dashboard/src/automations/todo-templates.ts \
        packages/dashboard/tests/unit/automations/todo-validators.test.ts
git commit -m "feat(s4.2): deliverable validator with doubled-signal narration detection"
```

> **Caveat (acknowledged):** opening-only detection. A worker that opens cleanly but slips into mid-document narration ("Now let me check the news…" between sections) still passes. That's a known residual; mid-document detection would be a follow-up if observed.

---

### Task 6: ATOMIC trigger conversion + obsolete-content deletion

**Why atomic:** these sites must change together. Landing alert/initiate routing first without updating the prompt content would deliver the OLD `"forward verbatim"` prompt as a USER-role turn — strictly worse than today. Single coordinated commit, single coordinated rollback.

**Why deletion (not flag-gating) of obsolete content:** the feature flag (Task 13) controls *routing* (`sendActionRequest` vs `sendSystemMessage`), not preserves dead prompt text. `formatNotification` always emits the new action-request prompt; if the flag rolls routing back, the action-request prompt is delivered via system-role wrapping — still strictly different from S4.1, but provides a path back if user-role injection itself is the problem.

**Files (full scope):**
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts:141, 184, 193, 253-255, 262`
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts:312-313, 377-400`
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts:158-164`
- Modify: `packages/dashboard/src/agent/session-manager.ts:889-897` — fix orphaned docstring (describes `injectSystemTurn` but sits above `isStreaming()`; move comment to immediately above `injectSystemTurn` at line 922).
- Modify: `packages/dashboard/src/automations/types.ts` — add `run_dir?: string` to `PersistentNotification`.
- Modify: `packages/dashboard/src/automations/automation-processor.ts:306` — drop `[SYSTEM: ${prompt}]` wrap in queue-fallback initiate call.
- Modify: `packages/dashboard/src/app.ts:720-742, 726` — drop the `if (!alerted)` historical commentary block (dead since S4.1; `alerted` is now an object) and the `[SYSTEM: ]` wrap in AutomationNotifier initiate fallback.
- Modify: `packages/dashboard/src/app.ts`, `automation-processor.ts` — populate `run_dir` at every `notificationQueue.enqueue` for `job_completed`.
- Modify (tests): `packages/dashboard/tests/integration/status-prompt-acceptance.test.ts:118-150, 278-289` — update 5 literal-string assertions on `[Pending Briefing]` → `[Pending Deliveries]`.
- Modify (tests): `packages/dashboard/tests/integration/routing-presence.test.ts:135` — fixture string `"Background work finished."` → `"Job completed."` (neutral language; the old fixture perpetuates S4-era framing).
- Modify (tests): existing `conversation-initiator-alert-outcome.test.ts` (extended in Task 4).
- Create (tests): `packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts`.
- Modify (tests): existing `system-prompt-builder.test.ts`.

**Deletions in this task (no flag-gated retention):**
- `verbatimFraming` const in `heartbeat-service.ts:378`
- `Background work results:\n\n${n.summary}\n\n${verbatimFraming}` template at `:386`
- Celebratory `console.log("[Heartbeat] Delivering job_completed with VERBATIM framing (...)")` at `:385`
- `[Pending Briefing]` literal in `system-prompt-builder.ts:162` (renamed to `[Pending Deliveries]` with action-request body)
- `if (!alerted)` historical commentary in `app.ts:720-742` — dead branch documented by S4.1 review

- [ ] **6.1: Write all failing tests in one go** — combine the test additions from v1 Tasks 4.1, 5.1, 6.1. After this commit they will all PASS together.

- [ ] **6.2: Run, confirm FAIL on all three test files**

- [ ] **6.3: Apply all five code changes**

(a) `conversation-initiator.ts`:
- Lines 141, 193, 262: `sendSystemMessage` → `sendActionRequest`.
- Line 184: `firstTurnPrompt: \`[SYSTEM: ${prompt}]\`` → `firstTurnPrompt: prompt`.
- Lines 253-255: drop `[SYSTEM: ...]` wrapping in default firstTurnPrompt.

(b) `heartbeat-service.ts`:
- Line 312-313 (`initiate()` fallback inside `deliverPending`): drop `[SYSTEM: ${prompt}]` wrap, pass `prompt` as-is.
- Lines 377-400 (`formatNotification`): rewrite the `job_completed` branch as action-request (same body as v1 Task 5.3). Status types (`job_failed`, `job_interrupted`, `job_needs_review`, `infra_alert`) keep status framing unchanged.

(c) `system-prompt-builder.ts:158-164`: rename `[Pending Briefing]` → `[Pending Deliveries]` with action-request body (same as v1 Task 6.3).

(d) `types.ts`: add `run_dir?: string` to `PersistentNotification`.

(e) `app.ts` + `automation-processor.ts`: at every `notificationQueue.enqueue({ type: "job_completed", … })`, add `run_dir: job.run_dir`.

- [ ] **6.4: Run all tests → PASS, typecheck clean**

- [ ] **6.5: Single coordinated commit**

```bash
git add packages/dashboard/src/agent/conversation-initiator.ts \
        packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/src/agent/system-prompt-builder.ts \
        packages/dashboard/src/automations/types.ts \
        packages/dashboard/src/app.ts \
        packages/dashboard/src/automations/automation-processor.ts \
        packages/dashboard/tests/unit/agent/conversation-initiator-alert-outcome.test.ts \
        packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts \
        packages/dashboard/tests/unit/agent/system-prompt-builder.test.ts
git commit -m "feat(s4.2): convert proactive-delivery trigger from system-role to user-role action request

- alert() and initiate() route through sendActionRequest
- heartbeat formatNotification(job_completed) becomes action-request prompt with artifact path
- heartbeat:313 second [SYSTEM:] wrap removed
- [Pending Briefing] → [Pending Deliveries] action-request framing
- PersistentNotification.run_dir wired through enqueue sites

This is the load-bearing change. Tasks 4-6 of the plan land in this single commit
to avoid the intermediate state where action-request routing is wired with stale
'forward verbatim' prompt content (strictly worse than status quo)."
```

---

### Task 7: DELETE the `pendingNotifications` queue (zero callers)

**Why DELETE not reconcile:** the dead-code audit verified via `grep -rn '\.queueNotification\|\.hasPendingNotifications' packages/` that there are **zero external callers** in source or tests outside session-manager.ts itself. The only references are: the field at `:376`, the drain block at `:685-702`, the public methods at `:908-919`. Adding a discriminator (v2's plan) was infrastructure for a graveyard. Delete the queue; the audit's Top-1 concern dissolves rather than is fixed.

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:376, 685-702, 908-919`

- [ ] **7.1: Verify zero callers (one more time, with the executor's eyes)**

```bash
cd /home/nina/my_agent
grep -rn '\.queueNotification\|\.hasPendingNotifications\|pendingNotifications' \
  packages --include='*.ts' --include='*.tsx' \
  | grep -v 'dist/' \
  | grep -v 'session-manager.ts'
```

Expected output: ZERO matches (or matches that are unrelated — e.g., a local variable name in `heartbeat-service.test.ts:16` mockQueue parameter; not a call to the SessionManager method).

If matches DO appear from a call site that wasn't in the audit's view (e.g., a caller added between audit time and execution time): STOP. Open a follow-up question. Don't delete blindly.

- [ ] **7.2: Write a regression test that streamMessage no longer prepends `[SYSTEM:]` blocks from any internal queue**

```typescript
// packages/dashboard/tests/unit/agent/no-system-prepend-from-queue.test.ts
import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "../../../src/agent/session-manager.js";

describe("streamMessage no longer prepends queued [SYSTEM:] blocks (S4.2 Task 7)", () => {
  it("calling streamMessage with a bare prompt sends ONLY that prompt to the SDK", async () => {
    const sm = Object.create(SessionManager.prototype) as any;
    // Stub everything streamMessage needs — focus the assertion on the SDK input
    sm.activeQuery = null;
    sm.conversationId = "test";
    sm.options = {};
    // ... set up minimal stubs to exercise the prompt-prepend code path ...

    const sdkSpy = vi.fn(async function* () {
      yield { type: "text_delta", text: "ok" };
    });
    sm.invokeSdk = sdkSpy; // replace with whatever the actual SDK invocation method is

    for await (const _ of sm.streamMessage("Brief time. Deliver.")) { void _; }

    const sdkInput = sdkSpy.mock.calls[0][0];
    expect(sdkInput).toBe("Brief time. Deliver.");
    expect(sdkInput).not.toMatch(/^\[SYSTEM:/);
  });
});
```

(If the actual SDK-call shape inside `streamMessage` makes this test awkward, replace with a structural test: assert that `pendingNotifications` field no longer exists on the prototype.)

- [ ] **7.3: Run test → confirm FAIL** (queue still exists, prepending logic still active)

- [ ] **7.4: Delete the queue**

In `packages/dashboard/src/agent/session-manager.ts`:
- Line 376: delete `private pendingNotifications: string[] = [];`
- Lines 685-702: delete the entire prepend block:

```typescript
// DELETE THIS BLOCK:
if (this.pendingNotifications.length > 0) {
  const notifications = this.pendingNotifications.splice(0);
  // ... [SYSTEM: …] prepending logic ...
}
```

- Lines 908-919: delete `queueNotification()` and `hasPendingNotifications()` methods entirely.
- Line 904 (or wherever): delete the orphan doc comment about queued notifications.

- [ ] **7.5: Run test → PASS, typecheck clean**

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run tests/unit/agent/no-system-prepend-from-queue.test.ts
```

- [ ] **7.6: Confirm no unrelated test breakage**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: same pre-existing failures as baseline; no new failures introduced.

- [ ] **7.7: Commit**

```bash
git add packages/dashboard/src/agent/session-manager.ts \
        packages/dashboard/tests/unit/agent/no-system-prepend-from-queue.test.ts
git commit -m "refactor(s4.2): delete dead pendingNotifications queue (zero external callers)

The queue was kept alive across S4 + S4.1 + early-v2-S4.2 thinking but
no caller in source or tests references queueNotification() or
hasPendingNotifications(). Deletion eliminates the audit's Top-1 concern
(future callers re-introducing [SYSTEM:] wrap framing) rather than fixing
it via discriminator. Verified by grep before deletion."
```

---

### Task 8: System-flag-based notify default (replaces v1 Task 8 — `system: boolean`, not `job_type`)

**Files:**
- Modify: `packages/dashboard/src/automations/automation-manager.ts:67, 214, 337` (three independent sites).
- Test: `packages/dashboard/tests/unit/automations/automation-manager.test.ts`

**Why:** v1 used `SYSTEM_JOB_TYPES = new Set(["capability_modify", "capability_create"])` which is wrong on the data — `capability_create` does not exist; `capability_build` is also system-orchestrated and was missed. The correct discriminator is the existing `manifest.system: boolean` flag (used by migrations and persisted in DB).

- [ ] **8.1: Verify the `system` flag exists on the manifest**

```bash
grep -n "system" packages/core/src/spaces/automation-types.ts
grep -n "manifest.system\|\.system =\b" packages/dashboard/src/automations/automation-manager.ts
```

Confirm: `AutomationManifest.system?: boolean` is defined and persisted in `automations.system` column.

- [ ] **8.2: Write failing tests (no fictional helpers)**

```typescript
// packages/dashboard/tests/unit/automations/automation-manager.test.ts

import { AutomationManager } from "../../../src/automations/automation-manager.js";
import { open } from "../../helpers/test-db.js"; // existing pattern

describe("AutomationManager — notify default depends on system flag (S4.2)", () => {
  it("system: true automation defaults notify to 'none'", async () => {
    const db = await open();
    const mgr = new AutomationManager(db);
    await mgr.create({
      manifest: {
        name: "cfr-fix-x",
        system: true,
        // notify intentionally omitted
      },
    });
    const stored = await mgr.get("cfr-fix-x");
    expect(stored?.notify).toBe("none");
  });

  it("system: false (or absent) defaults notify to 'debrief'", async () => {
    const db = await open();
    const mgr = new AutomationManager(db);
    await mgr.create({
      manifest: { name: "thailand-news-worker" /* system absent */ },
    });
    const stored = await mgr.get("thailand-news-worker");
    expect(stored?.notify).toBe("debrief");
  });

  it("explicit notify in manifest always wins over default", async () => {
    const db = await open();
    const mgr = new AutomationManager(db);
    await mgr.create({
      manifest: { name: "x", system: true, notify: "immediate" },
    });
    const stored = await mgr.get("x");
    expect(stored?.notify).toBe("immediate");
  });
});
```

- [ ] **8.3: Run, confirm FAIL**

- [ ] **8.4: Patch the three sites in automation-manager.ts**

```typescript
// helper at top of file
function defaultNotifyFor(manifest: { system?: boolean }): "immediate" | "debrief" | "none" {
  return manifest.system ? "none" : "debrief";
}

// Line 67 (create): notify: input.manifest.notify ?? defaultNotifyFor(input.manifest),
// Line 214 (list row deserialization): notify: (row.notify as ...) ?? defaultNotifyFor({ system: !!row.system }),
// Line 337 (frontmatterToManifest): notify: (data.notify as ...) ?? defaultNotifyFor({ system: !!data.system }),
```

- [ ] **8.5: Verify cfr-fix manifests carry `system: true`**

```bash
grep -L "^system: true" ~/my_agent/.my_agent/automations/cfr-fix-*.md | head
```

If any are missing the flag, treat as a separate data fix (Step 8.6).

- [ ] **8.6: Data fix — add explicit `system: true` to existing CFR-fix manifests** (idempotent, local-only)

```bash
for f in ~/my_agent/.my_agent/automations/cfr-fix-*.md; do
  if ! grep -q "^system:" "$f"; then
    awk 'BEGIN{c=0} /^---$/{c++; print; if(c==1) print "system: true"; next} {print}' "$f" > "$f.tmp"
    mv "$f.tmp" "$f"
  fi
done
```

- [ ] **8.7: Archive disabled CFR-fix and build-* automations** (local data hygiene; `.my_agent/` is gitignored)

The dead-code audit found ~26 disabled `cfr-fix-*` and 3 disabled `build-*-capability` manifests cluttering `.my_agent/automations/` (133 files total, 57 marked `status: disabled`). Archive them before Task 16 soak so the live brief queue is unambiguous.

```bash
mkdir -p ~/my_agent/.my_agent/automations/_archive
cd ~/my_agent/.my_agent/automations
for prefix in cfr-fix build-chrome-capability build-deepgram-stt-capability build-edge-tts-capability; do
  for f in ${prefix}-*.{md,jsonl}; do
    [ -e "$f" ] || continue
    if [ -f "$f" ] && grep -q "^status: disabled" "$f" 2>/dev/null \
        || [[ "$f" == *.jsonl ]] && [ -e "${f%.jsonl}.md" ] && grep -q "^status: disabled" "${f%.jsonl}.md"; then
      mv "$f" _archive/
    fi
  done
done
ls _archive/ | wc -l    # ~58 files (md + jsonl pairs for ~29 disabled automations)
ls *.md | wc -l         # remaining live + non-CFR disabled
```

Verify on dashboard restart that AutomationManager rescans cleanly without orphan-disable warnings for the moved files.

- [ ] **8.8: Run test → PASS, typecheck**

- [ ] **8.9: Commit code (only — `.my_agent/` is gitignored, archive moves stay local)**

```bash
git add packages/dashboard/src/automations/automation-manager.ts \
        packages/dashboard/tests/unit/automations/automation-manager.test.ts
git commit -m "feat(s4.2): notify default uses manifest.system flag (was: incorrect job_type filter)"
```

---

### Task 9: ~~(folded into Task 8)~~ — *merged with the system-flag fix above.*

---

### Task 10: Strip Haiku conversational preamble — with telemetry

**Files:**
- Modify: `packages/dashboard/src/automations/summary-resolver.ts`
- Test: extend `packages/dashboard/tests/unit/automations/summary-resolver.test.ts`

- [ ] **10.1: Write failing tests** — same as v1 Task 9.1, plus:

```typescript
it("logs 'stripped' counter when preamble is removed", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const queryModelFn = vi.fn(async () =>
    `I'll help you condense this content.\n\n## a\n**body**`,
  );
  await resolveJobSummaryAsync("x".repeat(15000), { queryModelFn, expectedHeadings: ["a"] });
  expect(logSpy.mock.calls.flat().join(" ")).toMatch(/Stripped Haiku preamble/);
});

it("logs 'no-heading-passthrough' when no ## heading found (distinct from stripping)", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const queryModelFn = vi.fn(async () => "I'll help you condense. Here is data.");
  await resolveJobSummaryAsync("x".repeat(15000), { queryModelFn, expectedHeadings: ["a"] });
  expect(logSpy.mock.calls.flat().join(" ")).toMatch(/no heading/i);
});
```

- [ ] **10.2: Run, confirm FAIL**

- [ ] **10.3: Implement stripping with telemetry**

```typescript
function stripHaikuPreamble(text: string): string {
  const firstHeadingIdx = text.search(/^## /m);
  if (firstHeadingIdx <= 0) {
    if (firstHeadingIdx === -1) {
      console.log("[summary-resolver] no heading-found in Haiku output — passthrough (preamble check skipped)");
    }
    return text;
  }
  const preamble = text.slice(0, firstHeadingIdx);
  if (/^(I'll|Let me|Here's|Sure|Now I'll|First,? let me)/im.test(preamble)) {
    console.log(`[summary-resolver] Stripped Haiku preamble (${preamble.length} chars before first ## heading)`);
    return text.slice(firstHeadingIdx);
  }
  return text;
}
```

> **Note (wrapper-marker contract):** the aggregator emits `<!-- wrapper -->\n## name`. When the preamble strip slices at the first `## `, any HTML comment that preceded it is dropped. The substring-match heading verification at line 165 still passes (it doesn't require the comment), so this is not a correctness break — but document the invariant in `summary-resolver.ts` so future contributors don't tighten the verification to expect the marker.

- [ ] **10.4: Add wrapper-marker invariant comment**

```typescript
// INVARIANT: stripHaikuPreamble may slice off a leading <!-- wrapper --> HTML
// comment if it precedes the first ## heading. Heading verification uses
// substring containment (not marker presence) and is unaffected. If this
// assumption changes, stripHaikuPreamble must preserve markers.
```

- [ ] **10.5: Run test → PASS**

- [ ] **10.6: Commit**

```bash
git add packages/dashboard/src/automations/summary-resolver.ts \
        packages/dashboard/tests/unit/automations/summary-resolver.test.ts
git commit -m "fix(s4.2): strip Haiku preamble with telemetry; document wrapper-marker invariant"
```

---

### Task 11: Standing-orders cleanup + cache invalidation + service restart

**Files:**
- Modify: `.my_agent/notebook/reference/standing-orders.md` (local data, not committed to public repo)
- Restart: `nina-dashboard.service`

- [ ] **11.1: Edit standing-orders.md**

(a) Delete the `## Brief Requirements` block (currently lines 38–46).

(b) Append the `## Conversation Voice` section — same body as v1 Task 10.3 (don't narrate tools; don't expose internals; don't dismiss your own scheduled work; bad/good examples from this conversation).

- [ ] **11.2: Restart the dashboard service** so the new system prompt is loaded

```bash
systemctl --user restart nina-dashboard.service
sleep 5
systemctl --user status nina-dashboard.service --no-pager | head -10
journalctl --user -u nina-dashboard.service -n 20 --no-pager
```

Verify: service is `active (running)`, no errors in startup log, no missing-file complaints from `loadNotebookReference("standing-orders.md")`.

- [ ] **11.3: Document in DECISIONS.md**

```markdown
## D2: Standing-orders changes require service restart
- SystemPromptBuilder.getStablePrompt() caches the assembled prompt for the lifetime of a SessionManager.
- Standing-orders.md edits are picked up only on next session creation OR after `invalidateCache()` call.
- For this sprint we restart the service after the edit. Future hot-reload would call SystemPromptBuilder.invalidateCache() (added in Task 3) on file-change events.
```

- [ ] **11.4: Commit DECISIONS.md** (the `.my_agent/` edits are local-only)

```bash
git add docs/sprints/m9.4-s4.2-action-request-delivery/DECISIONS.md
git commit -m "docs(s4.2): D2 — standing-orders cache invalidation requires service restart"
```

---

### Task 12: Update dashboard CLAUDE.md to reflect new pattern

**Files:** `packages/dashboard/CLAUDE.md` — "System Prompt Injections (Brain Notifications)" section.

- [ ] **12.1: Read current section, identify all stale patterns to delete**

The dead-code audit found the section's example pattern is itself stale:

```typescript
// Current example (CLAUDE.md):
const alerted = await ci.alert(prompt);
if (!alerted) {
  // initiate() path...
}
```

`alerted` has been an object (not boolean) since S4.1 — `if (!alerted)` is a dead branch that never fires. The S4.1 plan explicitly fixed the consumers (`heartbeat-service.ts`, `app.ts`) but this CLAUDE.md example was never updated.

Delete it. The new section should NOT have a flat boolean alert example anywhere.

- [ ] **12.2: Rewrite the section**

Replace the existing rules with:

```markdown
## System Prompt Injections — Brain Notifications

**Two delivery shapes:**

1. **Action requests** (proactive scheduled deliveries — briefs, sessions, completion notifications). Use `sendActionRequest` / `injectActionRequest`. Prompt is sent USER-ROLE — Nina's response loop is trained to fulfill it. Never wrap in `[SYSTEM: ]`. Examples: morning brief delivery, daily session delivery, `notify: immediate` job completion.

2. **System events** (genuine infrastructure notifications — mount failures, infra alerts, capability degradation). Use `sendSystemMessage` / `injectSystemTurn`. Prompt is wrapped in `[SYSTEM: …]` automatically by `injectSystemTurn`. Used for events the user did not ask for and that need to be surfaced as info, not delivered as content.

**Pattern for action requests:**

```typescript
const prompt = `Brief delivery time. Deliverable: ${runDir}/deliverable.md\n\nRead the file and present its contents to the user now. Render in your voice — pick what matters, structure it, voice it — but do not silently drop sections from the deliverable.`;
const result = await ci.alert(prompt);  // routes through sendActionRequest
```

**Pattern for system events:**

```typescript
const prompt = `A filesystem watch on "${path}" has failed after ${attempts} retry attempts.\n\nYou are the conversation layer — let the user know about this infrastructure issue briefly. Don't be dramatic, just inform them.`;
const result = await app.notificationQueue.enqueue({
  type: "infra_alert", summary: prompt, ...
});
// formatNotification's infra_alert branch passes through verbatim; alert() routes via sendActionRequest semantically because Nina is being asked to present.
```

**Rules:**

- **Never pre-wrap action-request prompts.** `sendActionRequest` does not wrap; the model reads as user-role.
- **Never bypass the queue for proactive deliveries.** All briefs and session deliveries go through the notification queue → heartbeat → action-request injection. Do not call `injectActionRequest` directly except in unit tests.
- **`pendingNotifications` queue carries a `kind` discriminator.** Queue with `kind: "system"` for genuine system events; queue with `kind: "delivery"` for proactive deliveries. The drain only wraps `kind: "system"` with `[SYSTEM: …]`.

**Why:** On 2026-04-25–27, three days of morning briefs were dismissed as "background activity" because system-role injection reads as context-to-acknowledge, not action-to-perform. Action-request injection (M9.4-S4.2) shifts the model's interpretation by speaking in the user's voice — Nina fulfills requests; she dismisses context.
```

- [ ] **12.3: Commit**

```bash
git add packages/dashboard/CLAUDE.md
git commit -m "docs(s4.2): update CLAUDE.md — action request vs system event injection patterns

Removes the stale 'if (!alerted)' example pattern (alerted has been an
object since S4.1; the dead branch never fires in practice). Reflects
that there should be ZERO pre-wrap [SYSTEM:] sites after S4.2 lands —
the four sites the audit found at conversation-initiator.ts:184,
heartbeat-service.ts:313, automation-processor.ts:306, app.ts:726 are
all collapsed in Task 6."
```

---

### Task 13: Feature flag `PROACTIVE_DELIVERY_AS_ACTION_REQUEST` — routing only

**Scope clarified after dead-code audit:** the flag controls *only* the routing decision in `conversation-initiator.ts` (`sendActionRequest` vs `sendSystemMessage`). It does NOT preserve obsolete prompt text. `formatNotification` always emits the new action-request prompt; `[Pending Deliveries]` is always the system-prompt section name. If the flag is set to `0`, the new prompts get delivered through the old (system-role) injection path — strictly different from S4.1 behavior, but provides a path back if user-role injection itself is the problem (e.g., Nina pivoting mid-answer).

**Why this scope:** the dead-code audit's Findings 2 & 3 argued that the feature flag should not preserve dead prompt content. Keeping `verbatimFraming` constant + `Background work results:` template alive under the flag would be three more strings of dead code waiting to rot. Delete them outright; route-only flag is sufficient rollback safety.

**Files:**
- Modify: `packages/dashboard/src/env.ts` (or wherever env vars are read)
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts` — read flag to choose `sendSystemMessage` vs `sendActionRequest`
- Test: `packages/dashboard/tests/unit/automations/feature-flag.test.ts`

(Note: `heartbeat-service.ts` and `system-prompt-builder.ts` are NOT flag-gated. They emit the new prompt text unconditionally.)

- [ ] **13.1: Read flag**

```typescript
// env.ts
export const PROACTIVE_DELIVERY_AS_ACTION_REQUEST =
  process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST !== "0";  // default ON
```

- [ ] **13.2: Gate routing in conversation-initiator.ts**

```typescript
// conversation-initiator.ts — only the routing decision is flag-gated
import { PROACTIVE_DELIVERY_AS_ACTION_REQUEST } from "../env.js";

// Inside alert() web-delivery branch and external-channel same-channel branch:
const sender = PROACTIVE_DELIVERY_AS_ACTION_REQUEST
  ? this.chatService.sendActionRequest.bind(this.chatService)
  : this.chatService.sendSystemMessage.bind(this.chatService);

for await (const event of sender(current.id, prompt, ...)) { ... }

// Same flag-gating in initiate() at line 262.
```

- [ ] **13.3: Test both flag states**

```typescript
describe("Feature flag PROACTIVE_DELIVERY_AS_ACTION_REQUEST", () => {
  it("when set to '0', alert routes through sendSystemMessage (legacy)", () => { ... });
  it("when unset or '1', alert routes through sendActionRequest (new)", () => { ... });
});
```

- [ ] **13.4: Document in `DECISIONS.md`**

```markdown
## D3: Feature flag for rollback
- `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` reverts to S4.1 behavior (system-role injection, "forward verbatim" framing).
- Default ON (no env var → new behavior). Set to "0" in `packages/dashboard/.env` if Task 16 (live soak) reveals regression.
- Removed in a follow-up sprint after 14 days of clean operation.
```

- [ ] **13.5: Commit**

```bash
git add packages/dashboard/src/env.ts \
        packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/src/agent/conversation-initiator.ts \
        packages/dashboard/src/agent/system-prompt-builder.ts \
        packages/dashboard/tests/unit/automations/feature-flag.test.ts \
        docs/sprints/m9.4-s4.2-action-request-delivery/DECISIONS.md
git commit -m "feat(s4.2): PROACTIVE_DELIVERY_AS_ACTION_REQUEST feature flag — config-level rollback"
```

---

### Task 14: AppHarness extension + integration test

**Files:**
- Modify: `packages/dashboard/tests/helpers/app-harness.ts` (or wherever `AppHarness` lives — verify path)
- Create: `packages/dashboard/tests/integration/proactive-delivery-aged-conversation.test.ts`

- [ ] **14.1: Locate `AppHarness`**

```bash
find packages/dashboard/tests -name "app-harness*" -o -name "AppHarness*"
grep -rn "class AppHarness\|export.*AppHarness" packages/dashboard/tests
```

- [ ] **14.2: Extend the harness with the methods Task 14 needs**

`seedConversation({ topic, turns })`, `completeJob({ automation_id, run_dir, deliverable, notify })`, `getLastAssistantTurn()`. If `AppHarness` exists, add as methods; if not, build a minimal harness following the M7-S9 pattern.

- [ ] **14.3: Write the integration test** — same as v1 Task 11.1, but acknowledging the synthetic-vs-real-gravity caveat:

```typescript
// HEADER COMMENT
// This test is a confidence-builder, not a load-bearing gate.
// 50-turn synthetic gravity is not equivalent to 3-day real-conversation
// gravity (cached context, real topic momentum). The load-bearing gate is
// Task 16 (live multi-morning soak). If this test passes but Task 16 fails,
// trust Task 16.
```

- [ ] **14.4: Run, confirm PASS**

- [ ] **14.5: Commit**

```bash
git add packages/dashboard/tests/helpers/app-harness.ts \
        packages/dashboard/tests/integration/proactive-delivery-aged-conversation.test.ts
git commit -m "test(s4.2): integration test — proactive delivery vs synthetic 50-turn gravity"
```

---

### Task 15: Sprint sweep + ROADMAP update

- [ ] **15.1: Full test suite**

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run 2>&1 | tail -30
```

Expected: typecheck clean. Tests: pass except documented pre-existing failures.

- [ ] **15.1.5: Verify cross-doc references to deleted content**

After Task 11 deletes `## Brief Requirements` from standing-orders, two existing docs reference it:
- `docs/plans/2026-04-07-m9.2-s7-framework-instance-split.md:87` — enumerates `Brief Requirements` as a moved section.
- `docs/sprints/m7-s8-debrief-workers/review.md:91` — claims `Conversation Voice` exists in standing-orders (was true at M7-S8, false after M6.7 split, true again after S4.2).

Both are historical sprint docs; add a footnote rather than rewrite:

```bash
# Add a footnote to the m9.2-s7 plan (one-line edit):
echo "
> **Footnote (M9.4-S4.2, 2026-04-XX):** the \`## Brief Requirements\` section referenced above was deleted from \`standing-orders.md\` in M9.4-S4.2 — superseded by the worker scheduling model. The historical reference in this plan is preserved for traceability.
" >> docs/plans/2026-04-07-m9.2-s7-framework-instance-split.md
```

The m7-s8 review's claim about Conversation Voice becomes correct again after S4.2 lands; no edit needed.

- [ ] **15.2: Append S4.2 row to ROADMAP** (the M9.4 row is updated separately by the user; this step adds the S4.2 dedicated table row in the M9.4 sprint table further down).

```markdown
| S4.2 | Proactive Delivery as Action Request (supplemental) | **Done** | Convert proactive-delivery injection from system-role to user-role action requests so briefs and `notify: immediate` deliveries are honored mid-conversation; clean worker deliverables (validator); CFR-fix automations leave brief queue (system-flag default); strip Haiku condense preamble; restore Conversation Voice rule in standing-orders; delete Brief Requirements leftover; PROACTIVE_DELIVERY_AS_ACTION_REQUEST feature flag for rollback. [Plan](../sprints/m9.4-s4.2-action-request-delivery/plan.md) · [Audit](../sprints/m9.4-s4.2-action-request-delivery/audit.md) · [Bug](../bugs/2026-04-27-proactive-delivery-dismissed.md) |
```

- [ ] **15.3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): record M9.4-S4.2 row + supplemental annotation"
```

- [ ] **15.4: Push branch + open PR**

```bash
git push -u origin sprint/m9.4-s4.2-action-request-delivery
```

PR title: "M9.4-S4.2: proactive delivery as action request". PR body summarizes the bug, design principle, hygiene fixes, audit fixes, feature flag, and links to the plan, audit, and bug record.

---

### Task 16: Live soak gate — 7-day verification before sprint close

This sprint cannot close until both delivery flavors run cleanly across multiple days of real conversation.

- [ ] **16.1: Restart the dashboard with the new build (already done in Task 11.2 but confirm with the merged build)**

```bash
systemctl --user restart nina-dashboard.service
sleep 10
journalctl --user -u nina-dashboard.service -n 30 --no-pager | grep -i error
```

Expected: no errors.

- [ ] **16.2: Day 1 — observe both deliveries**

Confirm:
- [ ] **07:00 BKK morning brief** — lands as a turn, content matches assembled brief, no dismissal language, no tool narration, no CFR-fix sections.
- [ ] **08:00 BKK relocation session** — lands as a turn, content matches deliverable, no dismissal, Nina returns to prior topic in next turn (the "pivots mid-answer" check from audit concern #13).

- [ ] **16.3: Days 2-7 — repeat the same checks each morning**

For each day, append a row to `test-report.md` with date, brief PASS/FAIL, relocation PASS/FAIL, conversation length at delivery, any anomalies. Conversation length matters — gravity grows over the soak.

- [ ] **16.4: If ANY morning fails**

- Set `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` in `.env`, restart service. Sprint stays open.
- File a follow-up bug with the failing turn copied verbatim.
- Re-plan based on the failure mode (does the new prompt over-eagerly interrupt? does the queued notification still wrap? did the cache fail to invalidate?).

- [ ] **16.5: After 7 clean days — sprint close**

```bash
# Update plan status, write final test-report, mark S4.2 Done in ROADMAP
git add docs/sprints/m9.4-s4.2-action-request-delivery/test-report.md \
        docs/ROADMAP.md
git commit -m "docs(s4.2): 7-day live soak PASS — proactive delivery reliable"
```

- [ ] **16.6: Schedule feature-flag removal**

After 14 more days of clean operation (21 total since merge), remove the `PROACTIVE_DELIVERY_AS_ACTION_REQUEST` flag and the legacy code paths. Track as a follow-up sprint.

---

## Self-review checklist (v3)

- [ ] Each code task has a failing test before implementation (Tasks 3, 4, 5, 6, 7, 8, 10, 13).
- [ ] No placeholders.
- [ ] Tasks 4-6 land atomically (single commit).
- [ ] All four `[SYSTEM:]` pre-wrap sites collapsed: `conversation-initiator:184`, `heartbeat-service:313`, `automation-processor:306`, `app.ts:726`.
- [ ] `chat-service.ts` registration covered (Task 4.4).
- [ ] `MockSessionManager.injectActionRequest` added (Task 4.5).
- [ ] `pendingNotifications` queue **deleted** — zero callers verified (Task 7).
- [ ] Obsolete prompt content deleted, not flag-gated: `verbatimFraming`, `Background work results:` template, celebratory `console.log`, `[Pending Briefing]` literal, `if (!alerted)` historical commentary (Task 6).
- [ ] Test fixtures updated for renames: `[Pending Briefing]` → `[Pending Deliveries]` in `status-prompt-acceptance.test.ts:118-150, 278-289` (Task 6 scope).
- [ ] Orphaned docstring at `session-manager.ts:889-897` repositioned (Task 6).
- [ ] Standing-orders cache invalidation handled (Task 11.2 service restart).
- [ ] `notify` default uses `manifest.system` flag (Task 8) — verified against actual enum, not invented constants.
- [ ] Disabled CFR-fix and build-* automations archived before soak (Task 8.7).
- [ ] Feature flag controls **routing only**, not preserves dead prompt content (Task 13).
- [ ] AppHarness extension is part of plan, not assumed (Task 14.2).
- [ ] 7-day live soak before close (Task 16).
- [ ] CLAUDE.md drift fixed, including deletion of `if (!alerted)` example (Task 12).
- [ ] SDK assumption verified before any code lands (Task 2).
- [ ] Cross-doc references to deleted `Brief Requirements` footnoted in sprint sweep (Task 15.1.5).

## Risk log (revised)

| Risk | Likelihood | Mitigation |
|---|---|---|
| User-role injection causes Nina to *interrupt herself mid-answer* — pivot away from prior topic | Medium | Task 16.2 explicitly checks she returns to the prior topic. If observed, action-request prompt gets a "preserve continuity" clause. Feature flag for emergency rollback. |
| `pendingNotifications` queue regression — a future contributor adds a delivery to the queue without `kind` discriminator | Low | Task 7 enforces the `kind` typing; TS catches a missing arg. |
| Standing-orders edit is forgotten on restart in a future sprint | Low | DECISIONS.md D2 documents the cache contract; `invalidateCache()` available for hot-reload future. |
| `system: true` flag is omitted on a future system-generated automation | Low | Migrations and CFR-fix templates already set it. Code review pattern. |
| Action-request prompt loses Nina's voice — feels robotic | Low | Prompt explicitly says "render in your voice". Worker output IS the content; Nina renders. |
| Live soak fails on day 3+ from accumulated conversation gravity | Medium | Feature flag + rollback. Re-plan with conversation-reset architecture (S4 rejected this; if soak fails it's the next escalation). |

## Out of scope

- Project-session primitive (relocation as bounded stateful project rather than `notify: immediate` worker). Flagged in user discussion; deserves its own design conversation.
- Architectural alternative: brief always opens a fresh conversation. S4 rejected; if Task 16 fails after this lands, re-open.
- Standing-orders becoming a strictly operational doc with no domain-specific content. Brief Requirements removal is a step toward that; full audit is a follow-up.
- Mid-document narration detection in worker deliverables (Task 5 covers opening only).

### Deferred to follow-up (from dead-code audit)

- **Rename sync `resolveJobSummary` → `resolveJobSummaryForDb`** (`packages/dashboard/src/automations/summary-resolver.ts:66`). Pure rename; 3 callers in `automation-executor.ts:283, 717, 973`. One-PR follow-up after S4.2 stabilizes; prevents future regression where someone wires the 2K-char DB-display version into a delivery path.
- **Footnote `m9.2-s7` plan reference** to deleted `Brief Requirements` block in `docs/plans/2026-04-07-m9.2-s7-framework-instance-split.md:87`. Add a "(removed in M9.4-S4.2)" annotation during sprint-sweep verification.
- **`infra_alert` branch retention** (`heartbeat-service.ts:393-396`). Comment claims it has callers; grep found none outside tests. Until proven dead in production, the trivial code path with documented contract is cheaper than removal.
- **`AutomationProcessor` fallback path commenting** (`:316-322`) — describes a path that nearly never fires (notificationQueue is always wired in app.ts). Annotate "// fallback path used only by tests" or remove in a hygiene PR.
- **Move closed bug record** `docs/bugs/2026-04-08-brief-delivery-broken.md` to `docs/bugs/_archive/`. Defer to a docs-hygiene PR alongside Finding 5 rename.
