# M4-S4: External Communications (Notebook Refactor)

> **Status:** Planned
> **Date:** 2026-02-18
> **Depends on:** M4-S3 (Notebook Editing Tool)

---

## Objectives

Refactor the M3-S4 external communications implementation to use the Notebook system:

1. **Remove middleware pattern matching** — No more `detectRuleIntent()` regex
2. **Nina-driven rule management** — She understands intent and uses `notebook_edit`
3. **Simplified message handler** — Reads rules from Notebook (already in prompt)
4. **Stash recovery** — Pop stashed M3-S4 code and adapt

---

## Background

M3-S4 implemented external communications with:
- `rules-loader.ts` — Parses `external-communications.md` for rules
- `detectRuleIntent()` in `chat-handler.ts` — Regex patterns to detect rule commands
- Middleware-driven file updates — User says "block Sarah" → regex matches → file updated

**Problem:** Brittle. User can't say "I had a fight with Sarah, ignore her" because regex doesn't match.

**Solution:** Remove middleware. Nina sees the file in her prompt, understands conversationally, uses `notebook_edit` tool.

---

## Git Workflow

**Current stash state (as of 2026-02-18):**
```
stash@{0}: M3-S4 untracked files (monitoring-config.ts, rules-loader.ts, external.ts)
stash@{1}: M3-S4 external communications implementation (all package/ modifications)
```

```bash
# 1. Ensure M4-S1, S2, S3 are merged to master

# 2. Create branch for this sprint
git checkout master
git checkout -b m4-s4-external-comms

# 3. Pop the stashed M3-S4 implementation (in reverse order)
git stash pop stash@{1}  # Modified files first
git stash pop stash@{0}  # Then untracked files

# 4. Resolve conflicts (runtime/ directory is new, prompt.ts may have changes)

# 5. Refactor to use Notebook
# ... changes described below ...

# 6. Test and commit
```

---

## Tasks

### T1: Remove detectRuleIntent

**File:** `packages/dashboard/src/ws/chat-handler.ts`

Delete:
- `DetectedRule` interface
- `detectRuleIntent()` function
- All code that calls `rulesLoader.appendRule()` based on detected rules

The chat handler should pass messages to the brain without intercepting rule commands.

### T2: Simplify rules-loader.ts

**File:** `packages/dashboard/src/channels/rules-loader.ts`

Keep as **read-only** utility for message-handler:
- `getRuleForContact(channelId, identity)` — Still needed
- `getAllRules(channelId)` — Still needed
- `parseRulesContent()` — Still needed

Remove:
- `appendRule()` — Nina uses `notebook_edit` instead
- Any write operations

Alternatively, **delete entirely** if message-handler can parse rules directly from the Notebook content in Nina's prompt. But having a dedicated parser is cleaner.

### T3: Update message-handler

**File:** `packages/dashboard/src/channels/message-handler.ts`

The message handler processes incoming external messages. It needs to:
1. Check if sender matches a rule
2. Apply the rule (auto-respond, draft, block)

**Current:** Calls `rulesLoader.getRuleForContact()`

**After refactor:** Same behavior, but rules-loader reads from `.my_agent/runtime/external-communications.md` instead of the old location.

Update the rules-loader path:
```typescript
// Old
this.agentDir = agentDir;  // Points to .my_agent/

// New
const rulesPath = path.join(agentDir, 'runtime', 'external-communications.md');
```

### T4: Move/Migrate Rules File

If M3-S4 created rules at `.my_agent/external-communications.md`, move to `.my_agent/runtime/external-communications.md`.

Or update the template from M4-S1 if no rules exist yet.

### T5: Test Conversational Rule Management

With the refactored system:

**Scenario 1: Add rule**
```
User: "Block Sarah, she's been annoying"
Nina: *understands intent*
Nina: *calls notebook_edit({ file: "external-communications", action: "append_to_section", section: "Permanent Rules", content: "- **Sarah**: never respond" })*
Nina: "Done. I'll ignore Sarah's messages from now on."
```

**Scenario 2: Query rules**
```
User: "Who do I have rules for?"
Nina: *reads from her context (Notebook is in system prompt)*
Nina: "You have rules for: Sarah (blocked), Bob (draft only)..."
```

**Scenario 3: Modify rule**
```
User: "Actually, Sarah and I made up. Respond to her warmly now."
Nina: *calls notebook_edit to remove old rule*
Nina: *calls notebook_edit to add new rule*
Nina: "Updated. I'll respond warmly to Sarah now."
```

**Scenario 4: Temporary rule**
```
User: "Ignore Sarah for a week"
Nina: *calls notebook_edit({ section: "Temporary Instructions", content: "- **Sarah** [until 2026-02-25]: Ignore her messages" })*
Nina: "I'll ignore Sarah until February 25th."
```

### T6: Preserve Working Features

From M3-S4 stash, keep:
- External message storage (`external-store.ts` enhancements)
- Monitoring gate for personal channels (`monitoring-config.ts`)
- Draft approval flow (`message-handler.ts` draft generation)
- Dashboard External tab UI (or migrate to Notebook tab)

These features don't depend on the middleware rule detection.

### T7: Update External Tab

The M3-S4 External tab showed external messages with action buttons.

**Options:**
1. Keep External tab as-is — Shows pending external messages, actions open chat context
2. Migrate to Notebook view — External messages appear in `external-communications.md` tab

**Recommendation:** Keep External tab for message list, but "Add Rule" opens chat context for natural language rule setting.

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/dashboard/src/ws/chat-handler.ts` | Remove detectRuleIntent, rule detection code |
| `packages/dashboard/src/channels/rules-loader.ts` | Remove appendRule, update path to runtime/ |
| `packages/dashboard/src/channels/message-handler.ts` | Update rules file path |
| `packages/dashboard/public/index.html` | Update External tab actions if needed |

---

## Verification

1. **No middleware matching:** "I had a fight with Sarah, ignore her" → Nina understands and updates file
2. **Query rules:** "What rules do I have?" → Nina reads from context, lists them
3. **Modify rules:** "Change Sarah from blocked to friendly" → Nina updates correctly
4. **Temporary rules:** "Ignore Bob for 3 days" → Adds with date to Temporary section
5. **Rules still apply:** External message from blocked contact → not processed
6. **Draft flow works:** Contact with draft_only rule → draft appears for approval
7. **Monitoring gate works:** Personal channel message to unmonitored conv → cut at source

---

## Dependencies

- **Upstream:** M4-S3 (notebook_edit tool must work)
- **Downstream:** None (this completes external communications feature)

---

## Stashed Code Reference

The stashed M3-S4 implementation includes:
- `rules-loader.ts` — Keep parsing logic, remove writes
- `monitoring-config.ts` — Keep as-is
- `external-store.ts` enhancements — Keep as-is
- `message-handler.ts` changes — Keep rule application, draft generation
- `chat-handler.ts` changes — Remove rule detection
- Dashboard UI changes — Keep External tab, update actions

---

## Not in Scope

- Auto-expiration of temporary rules (needs scheduler, M5)
- Complex rule conditions (MVP: simple contact matching)
- Rule import/export
