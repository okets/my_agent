# M9.1: Agentic Flow Overhaul — Design Spec

> **Date:** 2026-04-05
> **Status:** Approved
> **Context:** M9-S8 completed with PASS WITH CONCERNS. Nine issues surfaced, clustering into four systemic problems. This milestone fixes the agentic flow so Nina follows orders, delegates reliably, and communicates status.
> **Systemic analysis:** [m9-systemic-issues.md](m9-systemic-issues.md)

---

## Problem Statement

Nina's agentic flow is failing in four ways:

1. **Nina acts inline instead of through the system.** She edits files directly when she should delegate to tracked jobs with paper trails.
2. **The agent is purely reactive.** No autonomous monitoring, no restart recovery, notifications lost in memory.
3. **Worker agents ignore process instructions.** Prompt compliance is ~60-80%. Metadata, frontmatter, and structured deliverables are inconsistently produced.
4. **Infrastructure gaps compound into flow failures.** Silent failures, stale state, and missing data cascade into blocked workflows.

**Root cause:** The system relies on prompt compliance for process-critical flows. Agents optimize for task completion, not process compliance. Any flow that MUST happen needs code enforcement, not prompt enforcement.

---

## Design Principles

1. **Tools, not protocols.** Nina requests through MCP tools; the framework orchestrates.
2. **Code guarantees over prompt instructions.** If data MUST exist, the framework produces or validates it.
3. **Agents are coders, not bureaucrats.** Keep prompts focused on the actual task. Process requirements live in structured checklists, not prose paragraphs.
4. **Status is always queryable.** Pull (tool) always works. Push (notification) is best-effort with retry.
5. **Persistent over ephemeral.** Todos, notifications, and job state survive crashes.

---

## System 1: Universal Todo System

### Purpose

Structured task tracking available to every agent session — Conversation Nina, Working Ninas, any future agent type. Persists beyond context windows and across crashes.

### Storage

Each agent session gets a todo list stored as a JSON file in its working directory:

- **Conversation Nina:** `.my_agent/conversations/{id}/todos.json`
- **Working Nina:** `.my_agent/automations/.runs/{automation-id}/{job-id}/todos.json`

JSON format (small list, needs random access). The file is the source of truth.

### Todo Item Shape

```typescript
interface TodoItem {
  id: string;                          // "t1", "t2", etc.
  text: string;                        // "Write CAPABILITY.md with frontmatter"
  status: "pending" | "in_progress" | "done" | "blocked";
  mandatory: boolean;                  // true = can't be deleted by agent
  validation?: string;                 // validation rule ID (e.g., "capability_frontmatter")
  notes?: string;                      // agent can add context
  created_by: "agent" | "framework" | "delegator";
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `todo_list` | Show all items with their status |
| `todo_add(text)` | Add a new item (agent-created, mandatory=false) |
| `todo_update(id, status, notes?)` | Mark item as in_progress/done/blocked, optionally add notes |
| `todo_remove(id)` | Delete an item — **fails if mandatory=true** |

### Wiring

The todo MCP server is registered in every brain query, same as memory-server or automation-server. Pre-populated for working ninas by the executor (see System 2). Conversation Nina starts with an empty list and creates items from user requests.

---

## System 2: Working Nina Todo Templates

### Purpose

When Conversation Nina delegates work, she defines what "done" looks like. For known job types, the framework adds mandatory process items. Workers start with a structured assignment, not a blank slate.

### Three-Layer Todo Assembly

When the executor spawns a working nina, it builds the todo list from three sources:

| Layer | Source | Mandatory? | Removable? |
|---|---|---|---|
| 1. Delegator's items | `automation.manifest.todos` (from Conversation Nina) | Yes | No |
| 2. Job-type template | Static template (if `job_type` is set) | Yes | No |
| 3. Agent's own items | Working nina adds during execution | No | Yes |

**Layer 1** is the primary plan. Conversation Nina understood the user's request and breaks it down into concrete items. If no Conversation Nina was involved (UI-kicked automation, cron trigger), this layer is empty.

**Layer 2** provides process requirements for known job types. These are static TypeScript templates, not LLM-generated:

```typescript
// packages/dashboard/src/automations/todo-templates.ts

const CAPABILITY_BUILD: TodoTemplate = {
  items: [
    { text: "Read spec and capability template", mandatory: true },
    { text: "Write CAPABILITY.md with required frontmatter (name, provides, interface, requires.env)",
      mandatory: true, validation: "capability_frontmatter" },
    { text: "Write scripts following template contract", mandatory: true },
    { text: "Run test harness — record pass/fail and latency",
      mandatory: true, validation: "test_executed" },
    { text: "Fill completion report",
      mandatory: true, validation: "completion_report" },
  ]
};

const CAPABILITY_MODIFY: TodoTemplate = {
  items: [
    { text: "Read current CAPABILITY.md + DECISIONS.md history", mandatory: true },
    { text: "Identify change type (configure/upgrade/fix/replace)",
      mandatory: true, validation: "change_type_set" },
    { text: "Apply changes per spec", mandatory: true },
    { text: "Run test harness — record pass/fail and latency",
      mandatory: true, validation: "test_executed" },
    { text: "Fill completion report",
      mandatory: true, validation: "completion_report" },
  ]
};
```

**Layer 3** is the agent's freedom. She can add sub-items as she discovers needs (e.g., "install npm package", "check API rate limits").

### Validation Registry

Each validation rule is a function that checks the agent's actual output:

```typescript
const VALIDATORS: Record<string, (jobDir: string) => ValidationResult> = {
  capability_frontmatter: (dir) => {
    // Check CAPABILITY.md exists and has name, provides, interface fields
  },
  completion_report: (dir) => {
    // Check deliverable has frontmatter with change_type !== "unknown"
  },
  test_executed: (dir) => {
    // Check that test results exist in deliverable
  },
  change_type_set: (dir) => {
    // Check change_type is set and not "unknown"
  },
};
```

When the agent calls `todo_update(id, "done")` on a validated mandatory item:
- **Pass:** Item marked done, agent proceeds.
- **Fail:** Item stays `in_progress`, tool returns: `"Cannot mark done: CAPABILITY.md missing 'name' field. Fix and try again."`

### Job Completion Gating

After the SDK session ends, the executor checks `todos.json`:
- All mandatory items `done` → job status: `completed`
- Mandatory items incomplete → job status: `needs_review`, notification includes what's missing

### Automation Manifest Changes

`create_automation` gets two new fields:

```typescript
create_automation({
  name: "Add Hebrew to STT",
  instructions: "...",
  todos: [                              // NEW: delegator's task breakdown
    { text: "Read current STT config" },
    { text: "Add Hebrew to language list" },
    { text: "Test Hebrew transcription" },
  ],
  job_type: "capability_modify",        // NEW: triggers template merge
  target_path: ".my_agent/capabilities/stt-deepgram",
  trigger: [{ type: "manual" }],
})
```

### Fallback

If an automation has no `todos` and no `job_type` → working nina starts with an empty list and creates her own. This is the recovery path for manually created automations or ad-hoc triggers.

---

## System 3: Heartbeat Jobs Service

### Purpose

An independent monitoring loop that makes Nina no longer purely reactive. Checks job health, delivers notifications, and monitors capability status — independent of user messages.

### Implementation

A `setInterval` loop (30-second tick) inside the dashboard process.

### Per-Tick Checks

#### 3a. Stale Job Detection

- Job has status `running` + `last_activity` in `todos.json` older than 5 minutes → **stale**
- Job has status `running` + no `todos.json` + `created` older than 2 minutes → **stale** (agent never started)
- Stale jobs → mark `interrupted`, create persistent notification with todo progress

`last_activity` is updated every time the working nina calls `todo_update`, so we detect staleness through the todo file — no separate heartbeat mechanism needed.

#### 3b. Pending Notification Delivery

- Read `pending/` directory
- For each notification: attempt delivery via `ConversationInitiator.alert()`
- If delivered: move to `delivered/`
- If no active session: increment `delivery_attempts`, leave in `pending/` for next tick

#### 3c. Capability Health Checks

- Each capability checked once per hour (not every tick)
- Run capability's test script (deterministic, no LLM)
- Previously healthy → now failing: create notification
- Previously failing → now healthy: update status, optionally notify

### Persistent Notification Queue

Replaces the in-memory `SessionManager.pendingNotifications`. Survives restarts.

```
.my_agent/notifications/
  pending/
    {timestamp}-{job-id}.json
  delivered/
    {timestamp}-{job-id}.json
```

Notification shape:
```json
{
  "job_id": "job-abc123",
  "automation_id": "build-stt-capability",
  "type": "job_completed",
  "summary": "Hebrew STT support added. Test: PASSED (1.2s)",
  "todos_completed": 7,
  "todos_total": 8,
  "created": "2026-04-05T14:23:00Z",
  "delivery_attempts": 0
}
```

### Notification Delivery Unification

`AutomationProcessor.handleNotification()` no longer manages its own delivery logic. It writes to the persistent notification queue. The heartbeat service handles all delivery — immediately or on next turn. One delivery path instead of two.

---

## System 4: Enforcement Hooks

### Purpose

Code-level enforcement that prevents shortcuts and self-harm. Moves process compliance from prompts to hooks.

### Hook 1: Source Code Protection (All Ninas)

**Trigger:** Write/Edit to project codebase (`packages/`, `skills/`, `docs/`, `scripts/`, root config files)

**Action:** Block. Return: "This path is developer-maintained code. You cannot modify it. If something needs fixing, escalate to the user."

**Why:** Nina should never modify her own framework code. Prevents self-harm. Read access is unrestricted.

### Hook 2: Capability Routing (Conversation Nina)

**Trigger:** Write/Edit to `.my_agent/capabilities/`, `.my_agent/spaces/`, `.my_agent/config.yaml`

**Action:** Block. Return: "Direct edits to this path are not allowed. Use `create_automation` with a tracked job to modify this through the proper flow."

**Why:** Forces Conversation Nina to delegate infrastructure changes through the automation system, which creates paper trails and uses todo-driven execution.

### Hook 3: Todo Completion (Working Nina)

**Trigger:** Job executor checks `todos.json` after SDK session ends.

**Action:** If mandatory items incomplete → job status set to `needs_review` instead of `completed`. Notification includes incomplete items.

**Why:** The final safety net. Even if per-item validation was somehow bypassed, the job can't close with incomplete mandatory work.

### Updated Trust Model

| Trust Level | Hooks |
|---|---|
| **Conversation Nina (brain)** | Audit + Source code protection + Capability routing |
| **Working Nina (task)** | Audit + Bash blocker + Infrastructure guard + Source code protection + Todo completion |
| **Subagent** | Audit + Bash blocker + Path restrictor + Source code protection |

---

## System 5: Status Communication

### Purpose

Nina always knows the status of every job and can communicate it accurately. Three channels ensure nothing falls through.

### Enhanced `check_job_status`

Returns todo progress, not just metadata:

```json
{
  "status": "running",
  "automation": "Add Hebrew to STT",
  "started": "2026-04-05T14:20:00Z",
  "todos": {
    "completed": ["Read current STT config", "Add Hebrew to language list"],
    "in_progress": ["Run test harness"],
    "pending": ["Identify change type", "Fill completion report"]
  }
}
```

### System Prompt Enrichment

#### Active Working Agents (every turn)

Already exists. Enhanced with todo progress:

```
[Active Working Agents]
- "Add Hebrew to STT" (job-abc123): running, 3/6 items done,
  currently: "Run test harness"
```

#### Pending Briefing (after restart or idle)

New section, populated from persistent notification queue:

```
[Pending Briefing]
The following events occurred since your last interaction:
- Job "Add Hebrew to STT" was interrupted (server restart). 
  Completed: 4/7 items. Remaining: run test harness, identify change type, fill completion report.
- Capability "stt-deepgram" health check: PASSED.

Inform the user about these naturally. For interrupted jobs, ask whether to resume or discard.
```

#### Conversation Nina's Own Pending Tasks

```
[Your Pending Tasks]
- ☐ Check calendar for tomorrow's meetings (pending)
- ✓ Send summary to the group chat (done)
```

### Three Delivery Channels

| Channel | Mechanism | When |
|---|---|---|
| **User asks** (pull) | `check_job_status` MCP tool | On demand — always works |
| **Job completes** (push) | Heartbeat delivers from persistent queue | Within 30s of event |
| **Conversation starts** (briefing) | System prompt includes pending notifications + tasks | Every new turn |

---

## System 6: Restart Recovery

### Purpose

When the dashboard restarts, no work is silently lost. Running jobs are detected, users are notified, and work can resume.

### Recovery Sequence

Runs synchronously on dashboard startup, before accepting connections.

**Step 1: Mark interrupted jobs**

All jobs with status `running` or `pending` created before process start time → status: `interrupted`. Summary includes todo progress from `todos.json` on disk.

New job status: `interrupted` — distinct from `failed` (agent errored) and `completed`. An interrupted job can be **resumed**.

**Step 2: Create notifications**

Each interrupted job gets a persistent notification in `pending/`:

```json
{
  "type": "job_interrupted",
  "job_id": "job-abc123",
  "automation": "Add Hebrew to STT",
  "todos_completed": 4,
  "todos_total": 7,
  "incomplete_items": ["Run test harness", "Identify change type", "Fill completion report"],
  "resumable": true
}
```

**Step 3: Clean stale once-automations**

Delete automation manifests where `once: true` and status is `completed`.

**Step 4: Re-scan capabilities**

Update registry with current health. A capability might have been mid-modification when the restart happened.

**Step 5: Start heartbeat service**

First tick picks up persistent notifications from Step 2 and attempts delivery.

### Job Resumption

When the user says "resume it", Nina calls `resume_job({ job_id })`. The executor:

1. Reads existing `todos.json` — knows what's done and what's left
2. Attempts SDK session resume using stored `sdk_session_id`
3. Injects system message: "You were interrupted. Items 1-4 are done. Continue from item 5."
4. Working nina picks up where she stopped

If the SDK session can't be resumed (expired):

1. Start fresh session
2. Pre-populate todo list with same items, completed ones marked done
3. Inject: "Previous session expired. Your todo list shows items 1-4 completed. Verify and continue from item 5."

---

## Infrastructure Fixes

These are targeted fixes for specific M9-S8 issues that the major systems don't directly cover.

### Fix 1: Scanner Loudness (Issue 8)

Scanner returns invalid capabilities with `status: "invalid"` and `error` field instead of silently skipping. Heartbeat service picks up invalid capabilities and creates notifications.

### Fix 2: findById Reads from Disk (D3)

`findById()` reads the automation markdown file from disk (source of truth), not from SQLite (derived index). Follows the project's core principle.

### Fix 3: Builder Prompt Simplification (D1)

Builder prompt stripped from ~143 lines to ~60 lines. Only contains: build instructions, template reference, escalation rules. All process requirements (frontmatter, completion report, test recording) handled by mandatory todo items with validators. No competing YAML examples.

### Fix 4: target_path from Manifest (D2)

`target_path` read directly from `automation.manifest.target_path` (YAML field set by `create_automation`). No regex extraction from instructions text. No dependence on the builder passing it through.

---

## Issue Resolution Map

| M9-S8 Issue | Resolution | System |
|---|---|---|
| 1: Inline fallback | Capability routing hook blocks direct edits | Enforcement Hooks |
| 2: Notifications don't reach user | Persistent queue + heartbeat retry delivery | Heartbeat Service |
| 3: No resume after restart | Recovery sequence + todo persistence + resume flow | Restart Recovery |
| 4: Concurrent voice blocked | **Deferred** to voice sprint | — |
| 5: Private data in output | Not a problem — `.my_agent/` is private | Dropped |
| 6: Stale running jobs | Heartbeat detects stale activity, restart marks interrupted | Heartbeat + Restart |
| 7: Stale once:true automations | Startup cleanup | Restart Recovery |
| 8: Scanner silently skips | Scanner returns errors + heartbeat notifies | Infrastructure Fix |
| 9: change_type "unknown" | Todo template + completion_report validator | Todo Templates |
| D1: Builder prompt confusion | Prompt stripped, process in todo list | Todo Templates |
| D2: target_path failures | Read from manifest field | Infrastructure Fix |
| D3: findById empty instructions | Read from disk, not SQLite | Infrastructure Fix |

---

## Out of Scope

- **Voice-specific issues** (concurrent messages, voice UX) → separate voice sprint after M9.1
- **Dashboard UI for todo management** → future enhancement
- **New capability templates** → added as job types are identified
- **Conversation Nina prompt tuning for delegation** → small item within sprints, not a major system

---

## Dependencies

- M9 (capability system — todo templates build on the existing capability lifecycle)
- M7 (automations & jobs — todo system integrates with the automation executor)
- No external dependencies

---

*Design approved: 2026-04-05*
*Architects: CTO + Claude Code*
