# M9.4-S4.2 — Soak Day-1 Follow-up Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Land in a small fast PR (or direct push if approved) so it deploys before tomorrow's 07:00 BKK brief.

**Opened:** 2026-04-28
**Origin:** Soak Day-1 case report ([`soak-day-1.md`](soak-day-1.md)) and architect audit response (in conversation log).
**Goal:** Address the four issues surfaced by Day-1 of the soak before Day-2 deliveries.
**Soak status:** stays open. This patch lands within the soak window; Day-2 (2026-04-29) is the test.

---

## What this patch does

Four independent fixes, can land as a single PR:

1. **L3b** — Clear the resumed SDK session for `conv-01KPYCMD9438AYAKX67BZETHTJ` so tomorrow's deliveries land in a fresh session (no inherited conversational gravity from the 3-day dismissive turn pattern).
2. **L6** — Fix the `daily-relocation-session` automation manifest so the validator is actually attached. Today's failure was *not* "validator regex too narrow" — it was "validator never ran" because the manifest's inline todos don't reference it.
3. **L1** — Widen the deliverable validator regex to cover the narration verbs Day-1 surfaced (`I'll start <verb>`, `Let me (get|find|search|locate|create)`, `Now I need`). Defense in depth for any worker the validator IS attached to.
4. **Prompt tightening** — Make `formatNotification.job_completed` explicitly say "today, now" so the model can't pattern-match "tomorrow's brief" from prior transcript turns.

---

## Why each fix matters (compressed evidence)

- **L3b**: same SDK session `167916ef-45ed-4cb2-a8f8-f9bb4db5da18` was resumed for both deliveries today. Conversation has 47 turns including 3 days of dismissive responses. Whether the new systemPrompt reaches a resumed session is inferred-not-verified, but transcript dominance alone is sufficient to explain the dismissive opener bleed-through. Rotating the session decisively tests both hypotheses at once.

- **L6**: `.my_agent/automations/daily-relocation-session.md` has inline todos that don't include `deliverable_written` validator. The validator can't reject what it isn't asked to check. Today the worker emitted a 100% narration deliverable (`I'll start executing… Let me get… Now I need…`) and the system happily forwarded it.

- **L1**: even with L6, the doubled-signal validator's regex doesn't catch the narration verbs the relocation worker actually used (`I'll start executing` ≠ `^I'll start by`, `Let me get` ∉ `(check|look|fetch|read)`). Plan v3 acknowledged opening-only detection as a known residual; soak surfaced exactly that residual.

- **Prompt tightening**: even with a fresh session, the action-request body reads *"scheduled background task you (past-you) set up"* — leaves date framing to the model. Today's deliverable said "April 28" but Nina still labeled it "tomorrow's brief". Closing this gap means future deliveries can't drift to "tomorrow" framing regardless of transcript context.

---

## Tasks

### Task 1 — Worktree

- [ ] **1.1: Create worktree**

```bash
cd /home/nina/my_agent
git worktree add ../my_agent-s4.2-fu1 -b sprint/m9.4-s4.2-fu1-soak-day-1
cd ../my_agent-s4.2-fu1
```

---

### Task 2 — L1: Widen the deliverable validator regex

**File:** `packages/dashboard/src/automations/todo-validators.ts:128-156`
**Test:** `packages/dashboard/tests/unit/automations/deliverable-validator.test.ts`

- [ ] **2.1: Write failing test cases**

Add to `deliverable-validator.test.ts`:

```typescript
it("doubled-signal — rejects 'I'll start executing' (Day-1 soak failure verb)", () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "deliverable.md"),
    "I'll start executing the daily relocation session automation by first checking my todo list. I need to load more tools.\n\n## Report\n**AQI: 145**",
  );
  const result = runValidation("deliverable_written", tmpDir);
  expect(result.pass).toBe(false);
  expect(result.message).toMatch(/narration|stream-of-consciousness|Write tool/i);
});

it("doubled-signal — rejects 'Let me get' / 'Let me find' / 'Let me search' / 'Let me create' / 'Let me locate'", () => {
  for (const opener of [
    "Let me get the necessary tools to research the relocation status.",
    "Let me find the relevant files for today's session.",
    "Let me search for the most recent automation run output.",
    "Let me create a deliverable for today's session.",
    "Let me locate the thailand-relocation knowledge space.",
  ]) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "deliverable.md"),
      `${opener} Now let me check the latest data.\n\n## Report\n**Body**`,
    );
    const result = runValidation("deliverable_written", tmpDir);
    expect(result.pass, opener).toBe(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

it("doubled-signal — rejects 'Now I need to' (weak repeat marker)", () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "deliverable.md"),
    "Now I need to load more tools. Now I need to fetch the AQI data.\n\n## Report\n**AQI: 145**",
  );
  const result = runValidation("deliverable_written", tmpDir);
  expect(result.pass).toBe(false);
});

it("doubled-signal — still accepts 'I need to flag' single weak match (FP guard)", () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "deliverable.md"),
    "I need to flag — AQI sensors at North-East station were offline today.\n\n## Report\n**AQI: estimated 145**\nPM2.5: ~52 µg/m³",
  );
  const result = runValidation("deliverable_written", tmpDir);
  expect(result.pass).toBe(true);
});
```

- [ ] **2.2: Run, confirm FAIL**

```bash
cd packages/dashboard
npx vitest run tests/unit/automations/deliverable-validator.test.ts
```

- [ ] **2.3: Widen the regex**

In `packages/dashboard/src/automations/todo-validators.ts`, update the two pattern arrays:

```typescript
const STRONG_OPENERS = [
  /^Let me start by\b/i,
  /^I'll start (by|executing)\b/i,                          // M9.4-S4.2-fu1: cover "I'll start executing"
  /^I'll help (you )?(condense|summarize|format)\b/i,
  /^Now I'll (start|check|look)\b/i,
  /^Here'?s what I'?ll do\b/i,
  /^Let'?s check\b/i,
];
const SECOND_MARKERS =
  /\b(Now let me|Now I need(?: to)?|Let me (check|look|fetch|read|get|find|search|create|locate)|I'll (check|fetch|read|look|get|find|search|create|locate))\b/gi;
```

Notes:
- `I'll start (by|executing)` — covers Day-1's verb without breaking the FP guard ("I need to flag" still passes because it's not "I'll start").
- `Now I need(?: to)?` — covers the new weak marker observed today.
- `(get|find|search|create|locate)` added to both `Let me` and `I'll` weak patterns.

- [ ] **2.4: Run, confirm PASS** — all new tests + the existing FP guard test ("I need to flag") all pass.

- [ ] **2.5: Commit**

```bash
git add packages/dashboard/src/automations/todo-validators.ts \
        packages/dashboard/tests/unit/automations/deliverable-validator.test.ts
git commit -m "fix(s4.2-fu1): widen deliverable validator regex (L1) — cover Day-1 soak narration verbs"
```

---

### Task 3 — Prompt tightening: "today, now" in `formatNotification.job_completed`

**File:** `packages/dashboard/src/automations/heartbeat-service.ts:382-394`
**Test:** `packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts`

- [ ] **3.1: Write failing tests**

Append to the existing describe block:

```typescript
it("prompt explicitly says 'now' to anchor delivery in present time", () => {
  const prompt = format({
    job_id: "j1", automation_id: "morning-brief", type: "job_completed",
    summary: "summary", run_dir: "/tmp/x",
    created: "2026-04-28T00:01:00Z", delivery_attempts: 0,
  });
  expect(prompt).toMatch(/\bnow\b/i);
});

it("prompt warns against 'tomorrow' / 'background' framing (Day-1 soak failure modes)", () => {
  const prompt = format({
    job_id: "j1", automation_id: "morning-brief", type: "job_completed",
    summary: "summary", run_dir: "/tmp/x",
    created: "2026-04-28T00:01:00Z", delivery_attempts: 0,
  });
  // The body must explicitly forbid the dismissal patterns Nina produced
  // on Apr 25–28 (mislabeling today's brief as "tomorrow's", calling
  // active delivery "background activity").
  expect(prompt).toMatch(/\btomorrow\b/i);    // mentioned, in a forbidding context
  expect(prompt).toMatch(/\bbackground\b/i);  // mentioned, in a forbidding context
});

it("prompt includes interruption-tolerance framing", () => {
  const prompt = format({
    job_id: "j1", automation_id: "morning-brief", type: "job_completed",
    summary: "summary", run_dir: "/tmp/x",
    created: "2026-04-28T00:01:00Z", delivery_attempts: 0,
  });
  // "the conversation may have been on another topic — pause and deliver"
  expect(prompt).toMatch(/pause|interrupt|other topic|in the middle/i);
});
```

- [ ] **3.2: Run, confirm FAIL**

- [ ] **3.3: Tighten the prompt body**

Replace the `job_completed` branch in `formatNotification` (`heartbeat-service.ts:382-394`) with:

```typescript
case "job_completed": {
  // M9.4-S4.2: action-request framing. Past-you scheduled this delivery;
  // present-you is being asked to render and present it now. Reference
  // the artifact by file path; render in voice; do not silently drop
  // sections.
  // M9.4-S4.2-fu1: explicit "today, now" anchor + interruption-tolerance
  // clause. Day-1 soak surfaced "tomorrow's brief" mislabeling and
  // "background activity" dismissal patterns bleeding from prior turns.
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

- [ ] **3.4: Run, confirm PASS**

```bash
npx vitest run tests/unit/automations/heartbeat-action-request-prompt.test.ts
```

Expected: 7 existing + 3 new = 10 tests PASS. Existing assertions on "deliver/present/render", "voice", "silently drop", "Background work results" absent — all still hold.

- [ ] **3.5: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts
git commit -m "fix(s4.2-fu1): tighten action-request prompt — explicit 'today, now' + anti-tomorrow/background clauses"
```

---

### Task 4 — Sprint sweep + push

- [ ] **4.1: Full test suite**

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run 2>&1 | tail -15
```

Expected: typecheck clean. All tests pass except documented pre-existing skips (24 CFR/live env-gated).

- [ ] **4.2: Push**

```bash
git push -u origin sprint/m9.4-s4.2-fu1-soak-day-1
```

---

### Task 5 — L6: Fix the relocation worker manifest (LOCAL DATA, NOT IN PR)

**File:** `~/my_agent/.my_agent/automations/daily-relocation-session.md` (gitignored — local edit, no commit)

The manifest has 4 inline todos and no `deliverable_written` validator. Add a final todo with the validator attached. Worker must use the Write tool to emit deliverable.md.

- [ ] **5.1: Edit the manifest**

Open `~/my_agent/.my_agent/automations/daily-relocation-session.md` and update the `todos:` block from:

```yaml
todos:
  - text: Read roadmap from thailand-relocation space
  - text: Check recent conversations for completed tasks and update roadmap
  - text: Research today's top tasks with real, current specifics
  - text: "Send focused session message: today's 1-3 tasks + week glimpse"
```

to:

```yaml
todos:
  - text: Read roadmap from thailand-relocation space
  - text: Check recent conversations for completed tasks and update roadmap
  - text: Research today's top tasks with real, current specifics
  - text: "Compose the focused session message: today's 1-3 tasks + week glimpse"
  - text: "Use the Write tool to emit deliverable.md with the focused session message — content only, no narration of process. This is the LAST step before marking done."
    validation: deliverable_written
```

The fourth todo is now "compose" (planning), and the new fifth todo is the explicit Write-tool emit step with `deliverable_written` attached.

- [ ] **5.2: Audit other user-authored automations with `notify: immediate` and inline todos**

```bash
for f in ~/my_agent/.my_agent/automations/*.md; do
  if grep -q "^notify: immediate" "$f" 2>/dev/null && grep -q "^todos:" "$f" 2>/dev/null; then
    if ! grep -q "validation: deliverable_written" "$f" 2>/dev/null; then
      echo "MISSING_VALIDATOR: $f"
    fi
  fi
done
```

For each "MISSING_VALIDATOR" file: same edit pattern as 5.1 — add a final todo with `validation: deliverable_written`. If the user is unavailable, leave the audit results in `soak-day-1-followup-notes.md` for the user to review.

- [ ] **5.3: Manifest changes are local-only — note in DECISIONS.md**

```bash
cat >> docs/sprints/m9.4-s4.2-action-request-delivery/DECISIONS.md <<'EOF'

## D4: User-authored automation manifests need explicit deliverable validators

**Date:** 2026-04-28 (Soak Day-1 follow-up)

The `generic` and `research` todo templates (S4.2 Task 5) include a Write-tool-only deliverable todo with `validation: deliverable_written`. But automations with **inline todos** in their manifest (like `daily-relocation-session.md`) override the template, and those inline todos may not include the validator.

**Decision:** for now, audit and patch user-authored manifests one-by-one. Document the pattern (a final "Use the Write tool to emit deliverable.md … validation: deliverable_written" todo) so future authors include it.

**Future work (deferred — not this sprint):** at automation registration time, force-attach a `deliverable_written` validator to any manifest with `notify: immediate` or `notify: debrief` that doesn't already have one. Lifts the responsibility off the author.
EOF

git add docs/sprints/m9.4-s4.2-action-request-delivery/DECISIONS.md
git commit -m "docs(s4.2-fu1): D4 — user-authored automation manifests need explicit deliverable validators"
git push
```

---

### Task 6 — L3b: Clear the SDK session id (LOCAL DATA, NOT IN PR)

This is a one-shot manual operation on the live database. Do this **after** Task 4 PR merges, and **after** Task 5 manifest edits land — so tomorrow's brief is the test of all four fixes together.

The conversation `conv-01KPYCMD9438AYAKX67BZETHTJ` keeps being resumed with the same SDK session because that ID is stored in `dashboard.db`. Clearing it forces a new SDK session on next turn while preserving the on-disk transcript.

- [ ] **6.1: Confirm the conversation row + sdk_session_id**

The dashboard uses `better-sqlite3`. Use a node one-liner so we don't need the `sqlite3` CLI:

```bash
cd ~/my_agent/packages/dashboard
node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.HOME + '/my_agent/.my_agent/dashboard.db', { readonly: true });
const row = db.prepare(\"SELECT id, sdk_session_id FROM conversations WHERE id = 'conv-01KPYCMD9438AYAKX67BZETHTJ'\").get();
console.log(row);
db.close();
"
```

Expected output: `{ id: 'conv-01KPYCMD9438AYAKX67BZETHTJ', sdk_session_id: '167916ef-45ed-4cb2-a8f8-f9bb4db5da18' }`

If the column name or table name differs, adjust the query (look at `packages/dashboard/src/conversations/db.ts` schema for the truth).

- [ ] **6.2: Clear the field**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.HOME + '/my_agent/.my_agent/dashboard.db');
const result = db.prepare(\"UPDATE conversations SET sdk_session_id = NULL WHERE id = 'conv-01KPYCMD9438AYAKX67BZETHTJ'\").run();
console.log('rows updated:', result.changes);
db.close();
"
```

Expected: `rows updated: 1`.

- [ ] **6.3: Restart the dashboard service** so any cached `SessionManager` instance for this conversation is dropped:

```bash
systemctl --user restart nina-dashboard.service
sleep 5
journalctl --user -u nina-dashboard.service -n 20 --no-pager | grep -iE "error|started" | head
```

Expected: service reports started; no errors. Note: this also picks up the new build from Task 4's merge (assuming master is deployed — if not, deploy the build first).

- [ ] **6.4: Confirm next turn creates a new session**

After tomorrow's 07:00 BKK brief lands, run the read query from Step 6.1 again. The `sdk_session_id` should be a **new** ID (not `167916ef-…`).

---

### Task 7 — Day-2 observation entry (post-deliveries, 2026-04-29)

After tomorrow's 07:00 + 08:00 BKK deliveries, append observations to `soak-day-2.md`:

- Brief opener wording (verbatim — does it still say "tomorrow's brief"? does it narrate "Let me grab it"?)
- Brief body completeness (sections present?)
- Relocation deliverable cleanliness (validator should now reject contaminated runs — was this run rejected, or did it pass? if rejected, did the worker get a retry signal?)
- New SDK session ID confirmed
- Pass/fail per the architect's rubric: no "tomorrow", no "background", no tool narration, brief delivers, relocation delivers (or fail-loud retries)

If pass: continue soak Day-3.
If fail: file `soak-day-2.md` and pause for re-plan; consider L5 (verify SDK on resume directly).

---

## Risk log

| Risk | Likelihood | Mitigation |
|---|---|---|
| L3b breaks something downstream — code that expects `sdk_session_id` to be set | Low | The SessionManager already handles `sdk_session_id = null` (cold start path). Verified at `session-manager.ts` initialization. |
| Widened validator regex causes false positives on legitimate worker output | Medium | The FP guard test ("I need to flag") still passes. New patterns are still narrow (`I'll start (by\|executing)` not `^I\b`). If a real worker hits FP, widen the FP allowlist. |
| Tightened prompt makes Nina robotic / over-corrects | Medium | Day-2 watch: if she opens with "TODAY's brief, NOW:" verbatim, the language is too prescriptive — soften "Do not call this..." to a positive form ("Frame it as today's, active, in front of you"). |
| L6 manifest edit + service restart drops in-flight automations | Low | Restart is 5–10 seconds. No active conversations expected at this hour. |
| The fix lands but Day-2 still fails (deeper SDK issue or transcript dominance) | Medium | This is exactly what L5 is for. Don't conclude "S4.2 is wrong" — conclude "RC1 needs verification." |

---

## Out of scope

- L5 (verify SDK behavior on resume directly via SDK source / probe). Defer to Day-3+ if Day-2 still shows opener bleed-through. If L3b alone fixes the opener, L5 is unnecessary.
- L7 (force-attach `deliverable_written` validator at automation registration time for any `notify: immediate` or `notify: debrief` worker). Bigger framework change; tracked in D4 as deferred.
- Migration of all existing user-authored automations to use the strengthened template. Audit-only this round (Task 5.2); patch only the broken ones.
