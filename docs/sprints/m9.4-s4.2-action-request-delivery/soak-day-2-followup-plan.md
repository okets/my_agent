# M9.4-S4.2 — Soak Day-2 Follow-up Plan (fu2)

> **For agentic workers:** Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Land in a small fast PR so it deploys before tomorrow's 07:00 BKK brief.

**Opened:** 2026-04-29
**Origin:** Soak Day-2 case report ([`soak-day-2.md`](soak-day-2.md)) and architect decision (in conversation log).
**Goal:** Stop Conversation Nina from narrating Read tool usage when delivering proactive content.
**Soak status:** stays open. Day-3 (2026-04-30) tests this fix.

---

## What this patch does

**One change:** in `formatNotification.job_completed`, inline the resolved deliverable content into the prompt body instead of pointing Nina at the file path. Stop asking her to call the Read tool.

Everything else from S4.2 + fu1 stays:
- Action-request routing (`sendActionRequest`, no `[SYSTEM:]` wrap) — Day-1 + Day-2 confirmed this fixed the dismissal pattern.
- "Today, now" framing + anti-tomorrow/anti-background clauses — also working.
- Standing-orders `## Conversation Voice` rule — keeps general anti-narration discipline.
- `[Pending Deliveries]` system-prompt section — unchanged.
- Validator regex (fu1 widened) — unchanged.
- Feature flag (`PROACTIVE_DELIVERY_AS_ACTION_REQUEST`) — unchanged.

---

## Why this fix

Day-2 surfaced that the **artifact-reference design** (telling Nina to Read a file path) has a structural side effect: Sonnet narrates tool calls. Today's brief opener:

> *"Let me read that deliverable. Good — I have the full picture. The deliverable has the worker narratives but the actual content is embedded in them. Let me render this cleanly."*

No prompt-level instruction can reliably suppress this — the model is trained to narrate Read calls, and one paragraph in standing-orders fighting many turns of training loses under load.

**Pre-S4.2 (the Apr 24 baseline)**: prompt body had inline content. No tool call. No narration.
**Post-S4.2 + fu1 (Apr 28-29)**: prompt body had `Deliverable: <path>` + "Read the deliverable…". Tool call. Narration.

We don't need the file reference. The notification already carries `n.summary` — the resolved content from `summary-resolver` (which already handles 100K hard cap, Haiku condense ≥10K, heading preservation, preamble strip). Use it.

This is **not** a rollback of S4.2. It's the smallest surgical revert: undo the artifact-reference content-design choice, keep the action-request routing principle.

---

## Scope — files changed

| Action | File | Change |
|--------|------|--------|
| Modify | `packages/dashboard/src/automations/heartbeat-service.ts:377-408` | `formatNotification.job_completed` always inlines `n.summary`; drops `Read the deliverable` directive even when `run_dir` is present. `run_dir` still logged for telemetry but no longer triggers a different prompt shape. |
| Modify | `packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts` | Replace assertions about `${run_dir}/deliverable.md` reference with assertions about inline content. Add: prompt does NOT contain "Read the deliverable" or any other tool-call directive. |
| Modify | `packages/dashboard/tests/integration/proactive-delivery-aged-conversation.test.ts` | Update prompt fixture in test body to match new inline shape. |
| Add | `packages/dashboard/CLAUDE.md` | One-line rule update: prompts inline the deliverable content; do not reference files for the model to read. (Updates Task-12 documentation from S4.2.) |

No SDK / database / standing-orders changes. No worker manifest changes. Validator code unchanged.

---

## Tasks

### Task 1 — Worktree

- [ ] **1.1: Create worktree**

```bash
cd ~/my_agent
git worktree add ../my_agent-s4.2-fu2 -b sprint/m9.4-s4.2-fu2-inline-content
cd ../my_agent-s4.2-fu2
```

---

### Task 2 — Update tests first (TDD)

**File:** `packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts`

The existing test file has 7+ tests asserting the old prompt shape. Some assertions will break (anything checking for `${run_dir}/deliverable.md` or "Read the deliverable"). Update them, AND add new assertions for the inline shape.

- [ ] **2.1: Read the existing test file**

```bash
cat packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts
```

Identify the existing test "references the run_dir/deliverable.md artifact when run_dir is provided" — this test is now wrong-by-design. Replace.

- [ ] **2.2: Add the new assertions and update the existing ones**

Replace the "references the run_dir/deliverable.md artifact" test with:

```typescript
it("inlines the deliverable summary content; does NOT reference a file path for the model to read", () => {
  const summary = "## Chiang Mai AQI\n\n**AQI: 145 (Unhealthy for Sensitive Groups)**\nPM2.5: ~52 µg/m³";
  const prompt = format({
    job_id: "j1",
    automation_id: "morning-brief",
    type: "job_completed",
    summary,
    run_dir: "/tmp/runs/morning-brief/2026-04-30",
    created: "2026-04-30T07:00:00Z",
    delivery_attempts: 0,
  });
  // Inline content present
  expect(prompt).toContain(summary);
  // No file-path Read directive (this is the regression we're fixing)
  expect(prompt).not.toMatch(/Read the deliverable/i);
  expect(prompt).not.toMatch(/deliverable\.md\b/i);
  expect(prompt).not.toMatch(/\$\{?run_dir\}?/);
});

it("does NOT instruct any tool call (Read, Open, Fetch, etc.) — content is inline", () => {
  const prompt = format({
    job_id: "j1",
    automation_id: "morning-brief",
    type: "job_completed",
    summary: "## Brief\n**Body**",
    run_dir: "/tmp/x",
    created: "2026-04-30T07:00:00Z",
    delivery_attempts: 0,
  });
  // The structural fix: no instruction to invoke a tool. Sonnet narrates
  // tool calls; this prompt must not invite one.
  expect(prompt).not.toMatch(/\bRead\s+(the\s+)?(deliverable|file|content)\b/i);
  expect(prompt).not.toMatch(/\bOpen\s+the\b/i);
  expect(prompt).not.toMatch(/\bFetch\s+/i);
});

it("when run_dir is absent, still inlines summary (same shape as run_dir-present case)", () => {
  const prompt = format({
    job_id: "j1",
    automation_id: "morning-brief",
    type: "job_completed",
    summary: "## Brief\n**Body**",
    // run_dir intentionally omitted
    created: "2026-04-30T07:00:00Z",
    delivery_attempts: 0,
  });
  expect(prompt).toContain("## Brief");
  expect(prompt).toContain("**Body**");
});

it("delimits the inline content with a clear boundary so the model treats it as deliverable, not framing", () => {
  const prompt = format({
    job_id: "j1",
    automation_id: "morning-brief",
    type: "job_completed",
    summary: "BODY_SENTINEL",
    run_dir: "/tmp/x",
    created: "2026-04-30T07:00:00Z",
    delivery_attempts: 0,
  });
  // The body should be wrapped in a delimiter ("---" works) so the model
  // distinguishes content-to-render from framing-around-content.
  // Find the sentinel and assert there's a delimiter before AND after it.
  const idx = prompt.indexOf("BODY_SENTINEL");
  expect(idx).toBeGreaterThan(0);
  const before = prompt.slice(0, idx);
  const after = prompt.slice(idx + "BODY_SENTINEL".length);
  expect(before).toMatch(/---|```|<deliverable>/);
  expect(after).toMatch(/---|```|<\/deliverable>/);
});
```

Also keep the existing tests that still apply:
- "does NOT contain the legacy 'Background work results' header" ✓ (still applies)
- "does NOT instruct 'forward verbatim'" ✓ (still applies)
- "frames the prompt as an action request (deliver / present / render)" ✓
- "preserves editorial freedom and no-silent-drop guard" ✓
- "does NOT log the celebratory 'VERBATIM framing' message" ✓
- "prompt explicitly says 'now' to anchor delivery in present time" ✓ (fu1)
- "prompt warns against 'tomorrow' / 'background' framing" ✓ (fu1)
- "prompt includes interruption-tolerance framing" ✓ (fu1)

Remove the existing test "references the run_dir/deliverable.md artifact when run_dir is provided" — replaced by the inline-content test above.

- [ ] **2.3: Run tests, confirm FAIL**

```bash
cd packages/dashboard
npx vitest run tests/unit/automations/heartbeat-action-request-prompt.test.ts
```

Expected: 4+ new tests fail (inline content not yet present, file-path directive still present), existing fu1 tests pass.

---

### Task 3 — Implement the inline-content prompt

**File:** `packages/dashboard/src/automations/heartbeat-service.ts:377-408`

- [ ] **3.1: Replace the `job_completed` branch**

Current body (post-fu1):

```typescript
case "job_completed": {
  const artifact = n.run_dir
    ? `\n\nDeliverable: ${n.run_dir}/deliverable.md\n\nRead the deliverable, render its contents in your voice, and present it to the user now. Editorial freedom inside each section — pick what matters, structure it, voice it — but do not silently drop sections from the deliverable.`
    : `\n\nThe deliverable summary is:\n\n${n.summary}\n\nRender it in your voice and present it to the user now.`;
  console.log(
    `[Heartbeat] Delivering job_completed as action request (${n.summary.length} chars summary, run_dir=${n.run_dir ? "yes" : "no"})`,
  );
  return (
    `It's time to deliver TODAY's results from a scheduled background task you (past-you) set up. ` +
    `The conversation may have been on another topic — pause and deliver this now. ` +
    `Do not call this "tomorrow's" delivery (it's today's) and do not classify it as "background activity to ignore" (it's the active delivery).` +
    artifact
  );
}
```

Replace with:

```typescript
case "job_completed": {
  // M9.4-S4.2-fu2: inline the resolved deliverable content. Earlier fu1
  // pointed Nina at `${run_dir}/deliverable.md` and asked her to Read the
  // file. Sonnet narrates tool calls; the response stream begins with
  // "Let me read that deliverable…". One prompt clause cannot reliably
  // suppress that; the structural fix is to not invite the tool call.
  // `n.summary` is the already-resolved content from summary-resolver
  // (handles 100K cap + ≥10K Haiku condense + heading preservation).
  console.log(
    `[Heartbeat] Delivering job_completed as action request (${n.summary.length} chars summary, run_dir=${n.run_dir ? "logged" : "absent"})`,
  );
  return (
    `It's time to deliver TODAY's results from a scheduled background task you (past-you) set up. ` +
    `The conversation may have been on another topic — pause and deliver this now. ` +
    `Do not call this "tomorrow's" delivery (it's today's) and do not classify it as "background activity to ignore" (it's the active delivery).` +
    `\n\nDeliverable content:\n\n---\n${n.summary}\n---\n\n` +
    `Render this in your voice — pick what matters, structure it, voice it — but do not silently drop sections. ` +
    `The content above is what to deliver; do not invoke any tools to fetch additional context for it.`
  );
}
```

Notes on the change:
- `n.summary` is inlined directly between `---` delimiters so the model treats it as the deliverable, not as framing.
- The trailing clause *"do not invoke any tools to fetch additional context for it"* is belt-and-suspenders — gives the model a positive instruction NOT to tool-call. Won't reliably override Sonnet's narration alone, but combined with not-asking-for-Read-explicitly, the tool-call surface goes from "invited" to "actively discouraged".
- `run_dir` is still logged (provenance/telemetry) but no longer alters the prompt shape.

- [ ] **3.2: Run tests, confirm PASS**

```bash
npx vitest run tests/unit/automations/heartbeat-action-request-prompt.test.ts
```

Expected: all tests PASS (existing fu1 + new fu2).

- [ ] **3.3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean (exit 0).

- [ ] **3.4: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts
git commit -m "fix(s4.2-fu2): inline deliverable content in action-request prompt; stop inviting Read tool narration"
```

---

### Task 4 — Update integration test

**File:** `packages/dashboard/tests/integration/proactive-delivery-aged-conversation.test.ts`

The integration test (S4.2 Task 14) crafts its own `briefPrompt` fixture mimicking the production prompt shape. Update the fixture string to match the new inline shape so the test stays representative.

- [ ] **4.1: Find and update the fixture**

```bash
grep -n "briefPrompt\|Read the file\|Read the deliverable" \
  packages/dashboard/tests/integration/proactive-delivery-aged-conversation.test.ts
```

Find the `briefPrompt` definition (around line 76-78 in the file as of S4.2). Replace from:

```typescript
const briefPrompt =
  `Brief delivery time. Deliverable: /tmp/runs/morning-brief/2026-04-27/deliverable.md\n\n` +
  `Read the file and present its contents to the user now. Render in your voice — pick what matters, structure it, voice it — but do not silently drop sections.`;
```

to:

```typescript
const briefPrompt =
  `It's time to deliver TODAY's results from a scheduled background task you (past-you) set up. ` +
  `Pause and deliver this now.\n\nDeliverable content:\n\n---\n` +
  `## Chiang Mai AQI\n\n**AQI: 145 (Unhealthy for Sensitive Groups)**\nPM2.5: ~52 µg/m³\n` +
  `\n---\n\nRender this in your voice — pick what matters, structure it, voice it — but do not silently drop sections.`;
```

The exact wording matters less than: (a) inline content present between delimiters, (b) no `Read the file`/`Read the deliverable` directive.

- [ ] **4.2: Run, confirm PASS**

```bash
npx vitest run tests/integration/proactive-delivery-aged-conversation.test.ts
```

Expected: 2 tests PASS (50-turn synthetic gravity).

- [ ] **4.3: Commit**

```bash
git add packages/dashboard/tests/integration/proactive-delivery-aged-conversation.test.ts
git commit -m "test(s4.2-fu2): integration test fixture matches new inline-content prompt shape"
```

---

### Task 5 — Update CLAUDE.md

**File:** `packages/dashboard/CLAUDE.md` — "System Prompt Injections — Brain Notifications" section.

The S4.2 Task-12 rewrite documented the action-request pattern but didn't constrain content placement. Add a one-line rule.

- [ ] **5.1: Find the existing "Pattern for action requests" example**

In `packages/dashboard/CLAUDE.md` line ~114-128, the example currently shows:

```typescript
const prompt =
  `Brief delivery time. Deliverable: ${runDir}/deliverable.md\n\n` +
  `Read the file and present its contents to the user now. Render in your voice — ` +
  `pick what matters, structure it, voice it — but do not silently drop sections.`;
```

Replace with:

```typescript
// fu2 (2026-04-29): INLINE the deliverable content. Do NOT reference a
// file path and ask Nina to Read it — Sonnet narrates Read calls and
// the brief opens with "Let me read that deliverable…" leakage.
const prompt =
  `It's time to deliver TODAY's results from a scheduled background task you (past-you) set up. ` +
  `Pause and deliver this now.\n\nDeliverable content:\n\n---\n${resolvedSummary}\n---\n\n` +
  `Render this in your voice — pick what matters, structure it, voice it — but do not silently drop sections.`;
const result = await ci.alert(prompt);
```

- [ ] **5.2: Add a new rule to the Rules block**

In the "Rules:" list (around CLAUDE.md line 148-153), add:

```markdown
- **Inline the deliverable content; do not reference files for the model to read.** Pre-S4.2 used inline content. S4.2 introduced a `Read the deliverable.md` directive which Sonnet narrated as tool-call leakage. Fu2 restored inline content. The artifact still lives at `run_dir/deliverable.md` for provenance/inspection, but the model receives the resolved content directly in the prompt body — no Read call.
```

- [ ] **5.3: Add Why entry**

In the "Why:" block (around CLAUDE.md line 155-158), add a third bullet:

```markdown
- On 2026-04-28–29, Nina's brief openers exposed Read tool narration ("Let me read that deliverable… Let me render this cleanly…") — a structural side effect of asking the model to Read a file path. Fu2 inlines the content so no tool call is invited. Soak surfaced that prompt-level "don't narrate tools" instructions cannot reliably override Sonnet's trained tool-call narration; the structural fix is to not trigger the call.
```

- [ ] **5.4: Commit**

```bash
git add packages/dashboard/CLAUDE.md
git commit -m "docs(s4.2-fu2): CLAUDE.md — inline deliverable content; do not reference files for model to read"
```

---

### Task 6 — Sprint sweep + push

- [ ] **6.1: Full test suite**

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run 2>&1 | tail -15
```

Expected: typecheck clean. All tests pass except documented pre-existing skips (24 CFR/live env-gated).

- [ ] **6.2: Push**

```bash
git push -u origin sprint/m9.4-s4.2-fu2-inline-content
```

Open PR. Title: `fix(m9.4-s4.2-fu2): inline deliverable content; stop inviting Read tool narration`. Body: short — link this plan, link `soak-day-2.md`, list the 4 commits, note "merge enables Day-3 soak observation."

---

### Task 7 — Day-3 observation entry (post-deliveries, 2026-04-30)

After tomorrow's 07:00 + 08:00 BKK deliveries, append observations to `soak-day-3.md`:

- Brief opener wording (verbatim) — does it still say "Let me read"? does it meta-explain the worker contamination?
- Brief body: did Nina render the inline content cleanly? Did she silently drop any sections?
- Relocation opener wording — same checks.
- Did Nina invoke any tools during these turns? (Check journalctl for tool-call events.)
- SDK session id — same as yesterday's `c7c569fd-…`? (Resumed; no fresh-rotation needed for fu2.)

**PASS criteria for fu2:**
1. No "Let me read" / "Let me render" / similar Read-narration phrases in either opener.
2. No meta-explanation of worker contamination as a leading sentence.
3. Brief body content is delivered (sections present).
4. No tool calls in the assistant turn for either delivery.

If pass: continue soak Day-4. If fail: this means inlining alone wasn't enough — Sonnet may narrate even without a tool call invitation, in which case we're at the architectural-question point (back to dev's Day-2 §6) and the next conversation is whether to switch the conversation-layer model (Haiku for delivery turns?) or accept Read-narration as the cost of the action-request principle.

**Note on validator gap (Day-2 Factor b):** unaffected by fu2. Worker contamination still leaks through. Open the validator-enforcement-gap bug as its own thread (`bugs/2026-04-29-validator-enforcement-gap.md`) — half-day investigation by someone, not gating the soak.

---

## Risk log

| Risk | Likelihood | Mitigation |
|---|---|---|
| Inlining huge briefs (37K-character days) bloats the prompt | Low — handled | `summary-resolver` already enforces 100K hard cap and condenses ≥10K via Haiku. The pre-S4.2 path inlined too; same content size envelope. |
| Model still narrates "Let me render this" even without a tool call | Medium | Day-3 is the test. If observed, the next escalation is model-level (Haiku on delivery, or accept narration as residual). Document and re-plan. |
| Model treats the inline content as instructions instead of content-to-render | Low | The `---\n${content}\n---` delimiters explicitly mark content boundaries. Existing fu1 prompt clauses ("render in your voice — pick what matters, structure it") frame intent. |
| Worker contamination (Day-2 Factor b) keeps leaking through despite cleaner prompt | Certain | Independent bug — file separately. fu2 doesn't claim to address it. |
| Test fixture in integration test drifts from the actual prompt over time | Low | Test asserts shape (delimiters, no Read directive), not exact wording. Future prompt edits won't break it unless they reintroduce file references. |

---

## Out of scope

- **Validator enforcement gap** (Day-2 Factor b). Independent framework bug. Open as `bugs/2026-04-29-validator-enforcement-gap.md`. Half-day investigation focused on `mcp/todo-server.ts:107-156` and any non-MCP path that mutates `todos.json`. Not gating the soak.
- **Model swap (Haiku for delivery turns)** to suppress Sonnet's tool-call narration tendencies. Defer until Day-3 evidence rules in or out the simpler inline-content fix. Bigger architecture conversation if needed.
- **Soak metric beyond pass/fail** (Day-2 Open Question 2 — "delivery quality" measurement). Worth a design conversation but not gating any current sprint.
- **Pre-existing automation manifest audit** (any other user-authored worker missing `validation: deliverable_written`). Local-only data; spot-fix when discovered.
