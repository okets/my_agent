# M6.9-S4: Agentic Task Executor

**Status:** Design approved
**Parent:** M6.9 Knowledge Lifecycle
**Prerequisite for:** M7 (Coding Projects), M6.8 (Skills Architecture — cwd routing)
**Prior sprint:** [M6.9-S3.5 Review](../../sprints/m6.9-s3.5-conversation-refactor/review.md)

---

## 1. Goal

Upgrade the task executor from a bare text-in/text-out `createBrainQuery` call to a full Agent SDK session with tools, bash, MCP servers, browser automation, and safety hooks. Every task becomes an autonomous agent that can write scripts, fetch data, use the filesystem, and interact with external services — while being unable to damage its own infrastructure.

---

## 2. Task Executor Architecture

### 2.1 Current State

`TaskExecutor.executeQuery()` calls `createBrainQuery(prompt, { model, systemPrompt })`. The brain receives a system prompt and user message, produces text, and returns. No tools, no MCP, no hooks, no temporal context.

### 2.2 New State

Replace `createBrainQuery()` with a full Agent SDK session:

```
Session per task:
├── System prompt (assembleSystemPrompt + temporal context + properties)
├── Tools: Bash, Read, Write, Edit, Glob, Grep
├── MCP servers: memory, knowledge, debrief, playwright
├── Hooks: PreToolUse (infrastructure guard), PostToolUse (audit)
├── cwd: .my_agent/tasks/{task-id}/
└── Model: from task config or preferences default
```

`executeQuery()` becomes: create a session with the full configuration, send the task prompt, collect the response.

**Session persistence:**
- One-off tasks: `persistSession: false` — no session files left behind
- Recurring tasks with `recurrenceId`: `persistSession: true` + session resumption via stored SDK session ID. Resumable sessions let recurring tasks build on prior context (e.g., a daily check that remembers yesterday's findings).

### 2.3 Task Folder as cwd

Each task already has a log file at `.my_agent/tasks/logs/{task-id}.jsonl`. The task folder is extended to a full working directory:

```
.my_agent/tasks/{task-id}/
├── task.jsonl          (execution log)
├── workspace/          (task artifacts — scripts, downloads, temp files)
└── .claude/            (future: M6.8 task-specific skills)
```

The `cwd` of the Agent SDK session is set to this folder. The task agent can create files, run scripts, and organize its work here. This also prepares for M6.8's `settingSources: ['project']` which will auto-discover skills from `{cwd}/.claude/skills/`.

**Migration:** Existing log files stay at `tasks/logs/{task-id}.jsonl` — no migration of old data. New tasks create the `tasks/{task-id}/` directory structure. `TaskLogStorage` is updated to write to the new path for new tasks. Old task logs remain readable at their original paths (TaskLogStorage checks both locations).

**Note on bash pattern guards:** The regex matching for destructive commands is best-effort, not a security boundary. Commands can be obfuscated (`rm -r -f /`, piped through `xargs`, etc.). The real protection is that the agent runs as a non-root user (`nina`) with OS-level permissions. The hooks catch obvious mistakes, not adversarial attacks.

### 2.4 Session Configuration

```typescript
// Extend existing createBrainQuery / BrainSessionOptions with cwd and tools
const query = createBrainQuery(taskPrompt, {
  model: taskModel,
  systemPrompt: await buildAgenticSystemPrompt(task, brainConfig),
  cwd: taskDir,
  tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
  mcpServers: [memoryServer, knowledgeServer, debriefServer, playwrightServer],
  hooks: infrastructureHooks,
  persistSession: !!task.recurrenceId,  // only persist for recurring tasks
});
```

**Token cost optimization:** Use deferred tool loading (`defer_loading: true`) for MCP tools. Only core tools (Bash, Read, Write, Edit, Glob, Grep ~3K tokens) load upfront. MCP tools from memory, knowledge, debrief, and Playwright are deferred and discovered on demand via Tool Search (~500 tokens). This reduces system prompt from ~77K to ~8.7K tokens per task — an 85% reduction. See [Anthropic advanced tool use guidance](https://www.anthropic.com/engineering/advanced-tool-use).

```
Always loaded:  Bash, Read, Write, Edit, Glob, Grep    (~3K tokens)
Deferred:       MCP memory, knowledge, debrief, Playwright  (loaded on demand)
Tool Search:    discovers relevant tools per task       (~500 tokens)
```

**Implementation approach:** The current `createBrainQuery()` in `core/src/brain.ts` only supports `model`, `systemPrompt`, and `resume`. It has no tool/hook/MCP support. The task executor should bypass `createBrainQuery` and use the Agent SDK directly — `import { Session } from '@anthropic-ai/claude-agent-sdk'` (or equivalent). Use the `claude-developer-platform` skill before implementation to confirm current SDK session creation API, tool registration, and hook wiring.

---

## 3. Infrastructure Protection Hooks

### 3.1 PreToolUse: Infrastructure Guard

Extends the existing hook factory at `packages/core/src/hooks/factory.ts` (`createHooks('task', { agentDir })`). The factory already produces a bash blocker (PreToolUse) + audit logger (PostToolUse). The infrastructure guard adds file path protection for Write/Edit tools alongside the existing bash pattern blocking.

Uses the existing hook output shape from `packages/core/src/hooks/safety.ts` (e.g., `createBashBlocker()` pattern with `hookSpecificOutput.hookEventName: 'PreToolUse'`).

**Protected file paths (block Write, Edit, Bash writes/deletes):**

| Pattern | Why |
|---------|-----|
| `brain/CLAUDE.md` | Identity — conversation Nina's domain |
| `brain/skills/*` | Brain-level skills |
| `config.yaml` | Agent configuration |
| `.env` | Secrets |
| `auth/*` | Channel credentials |
| `*.db` | Databases (agent.db, memory.db) |
| `.guardrails` | Safety patterns |
| `.git/hooks/*` | Git hook scripts |
| `*.service` (systemd units) | Service definitions |

**Protected bash patterns (block execution):**

| Pattern | Why |
|---------|-----|
| `rm -rf /` or `rm -rf /*` | Root-level recursive delete |
| `systemctl stop nina-*` | Stopping own services |
| `systemctl disable nina-*` | Disabling own services |
| `git push --force` (to master/main) | Destructive force push |
| `DROP TABLE` / `DROP DATABASE` | Database destruction |
| `kill` targeting nina processes | Killing own processes |
| `chmod 000` / `chown` on protected paths | Permission destruction |

**Hook behavior:**
- Returns `{ permissionDecision: "deny", permissionDecisionReason: "..." }` for blocked operations
- Returns `{ systemMessage: "..." }` alongside deny, so the brain understands why and can try alternatives
- Passes through (no decision) for all other operations
- **Fail-closed on hook error** — if the infrastructure guard throws, the operation is denied. A bug in the guard should not silently disable protection of identity files and config. (The audit hook is the opposite — permissive on error, since logging failure should not block work.)

### 3.2 PostToolUse: Audit Log

Logs every tool call to the task's JSONL execution log:

```json
{"type": "tool_use", "tool": "Bash", "input": {"command": "curl ..."}, "timestamp": "...", "taskId": "..."}
```

Non-blocking (`async: true`). No decision power — pure recording.

### 3.3 What Is NOT Protected

Everything outside the protected list is fair game:
- Task workspace files (create, modify, delete freely)
- Notebook entries (knowledge, daily logs, lists)
- Properties (status.yaml — Nina updates these during conversation)
- Temp files, downloaded data, script outputs
- Network access (curl, fetch, API calls)
- Package installation (uv, npm)

---

## 4. System Prompt: Temporal Context + Properties

### 4.1 Current Gap

`assembleSystemPrompt()` includes identity, notebook, daily logs, calendar, skills — but NOT:
- Current time (the brain has no clock)
- Dynamic properties (timezone, location, availability from `properties/status.yaml`)

Conversation Nina gets these from `SystemPromptBuilder`. Task executor bypasses that entirely.

### 4.2 Fix

Add temporal context and properties injection to the task executor's prompt assembly in `buildFreshQuery()`:

```
[Temporal Context]
Current time: 2026-03-14 14:30:00 (Asia/Bangkok)
[End Temporal Context]

[Dynamic Status]
location: Currently in Chiang Mai, Thailand
timezone: Asia/Bangkok
availability: No fixed return date
[End Dynamic Status]
```

Implementation:
1. Call `loadProperties(agentDir)` — already exists in `prompt.ts`, just not wired
2. Call `resolveTimezone()` from `WorkLoopScheduler` — or extract the timezone resolution logic into a shared utility (it reads from properties, then preferences, then falls back to UTC)
3. Format current time using the resolved timezone
4. Prepend to system prompt or append as a section

### 4.3 Shared Timezone Resolution

`WorkLoopScheduler.resolveTimezone()` reads from properties → preferences → UTC fallback. This logic should be extracted to a shared utility so the task executor can use it without depending on the scheduler instance.

```typescript
// New: packages/dashboard/src/utils/timezone.ts
export async function resolveTimezone(agentDir: string): Promise<string> {
  // 1. Check properties/status.yaml for timezone
  // 2. Fall back to preferences.timezone
  // 3. Fall back to "UTC"
}
```

---

## 5. notifyOnCompletion in Task Extraction

### 5.1 Extraction Prompt Update

In `task-extractor.ts`, add `notifyOnCompletion` to the extraction schema and prompt:

```
Set notifyOnCompletion based on the user's intent:
- "immediate" — user wants to hear back ("message me", "let me know",
  "tell me", "remind me", "send me", "notify me", "report back")
- "debrief" — background work, no urgency ("check daily", "keep an eye on",
  "when you get a chance", "log this")
- Omit if unclear — system defaults apply (immediate→immediate, scheduled→debrief)
```

### 5.2 Type Update

`ExtractedTask` gains:

```typescript
notifyOnCompletion?: "immediate" | "debrief" | "none"
```

### 5.3 Passthrough

In `post-response-hooks.ts:65`, pass `notifyOnCompletion` to `taskManager.create()`:

```typescript
const task = this.deps.taskManager.create({
  ...existing fields,
  notifyOnCompletion: extracted.notifyOnCompletion,
});
```

---

## 6. Install uv + Playwright for Both Ninas

### 6.1 Install uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Verify: `uv --version`. Available to both conversation and task sessions via Bash.

### 6.2 Playwright MCP Server

The Playwright plugin is already enabled for Claude Code. For Agent SDK sessions (conversation Nina + task executor), register the Playwright MCP server:

```typescript
// In session config mcpServers array:
playwrightMcpServer  // browser automation tools
```

Both `session-manager.ts` (conversation Nina) and the new task executor session setup get the Playwright MCP server.

### 6.3 What Is NOT In Scope

- Claude Code plugins (superpowers, code-review, etc.) — these are developer tools, not agent tools
- Skills loading via `settingSources` — that's M6.8
- Custom MCP servers beyond what exists — memory, knowledge, debrief, playwright is the full set for now

---

## 7. Files Changed

| File | Changes |
|------|---------|
| `dashboard/src/tasks/task-executor.ts` | Replace `createBrainQuery` with Agent SDK session, add temporal context, set cwd |
| `core/src/hooks/factory.ts` | Extend `createHooks('task', ...)` with infrastructure file path guards |
| `core/src/hooks/safety.ts` | Add Write/Edit file path guard alongside existing bash blocker |
| `dashboard/src/utils/timezone.ts` | New: shared timezone resolution (extracted from WorkLoopScheduler) |
| `dashboard/src/scheduler/work-loop-scheduler.ts` | Use shared timezone utility |
| `dashboard/src/agent/session-manager.ts` (or `session-registry.ts`) | Add Playwright MCP server to conversation Nina |
| `dashboard/src/tasks/task-extractor.ts` | Add notifyOnCompletion to extraction prompt + schema |
| `dashboard/src/conversations/post-response-hooks.ts` | Pass notifyOnCompletion through |
| `dashboard/src/index.ts` | Wire MCP servers and hooks into task executor |
| (no change to `core/src/tasks/types.ts` — `notifyOnCompletion` already exists on `Task` and `CreateTaskInput` from S3.5) | |

---

## 7. Status Reports + Task Revision

### 7.1 Status Reports

Every working Nina writes a `status-report.md` to its task folder at the end of execution. This is a system prompt instruction, not code — the agent is told to always produce one.

Contents: what was done, what was found, artifacts created, issues/concerns.

Purpose: If the SDK session expires or can't be resumed, the status report provides enough context for a fresh session to continue the work.

### 7.2 `revise_task` MCP Tool

When conversation Nina presents task results (via immediate notification or debrief) and the user requests corrections, conversation Nina calls `revise_task`:

```
revise_task({ taskId: "task-xxx", instructions: "Change the chart to weekly instead of daily" })
```

Behavior:
- Validates task is `completed` or `needs_review`
- Appends revision instructions to the task (with pointer to `status-report.md` for context)
- Resets status to `pending`
- Triggers re-execution via TaskProcessor
- TaskExecutor resumes the same SDK session (stored session ID), so the agent has full context

If session resume fails, falls back to a fresh session — the status report provides the prior context.

### 7.3 Per-task Model Override

Tasks can specify `model` (e.g. `"claude-opus-4-6"`) to override the default. Set via API or future skill config. Enables Opus for planning tasks, Sonnet for execution.

### 7.4 Files Changed

| File | Changes |
|------|---------|
| `dashboard/src/tasks/working-nina-prompt.ts` | Status report instruction in persona |
| `dashboard/src/mcp/task-revision-server.ts` | New: `revise_task` MCP tool |
| `dashboard/src/agent/session-manager.ts` | `addMcpServer()` for post-init registration |
| `dashboard/src/index.ts` | Wire task-revision server |
| `dashboard/src/tasks/task-manager.ts` | `update()` supports `instructions` field |
| `core/src/tasks/types.ts` | `model` field on Task and CreateTaskInput |

---

## 8. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Task tries to delete brain/CLAUDE.md | PreToolUse hook denies with message explaining why |
| Task tries `rm -rf /` via bash | Hook denies, brain gets system message suggesting safer alternative |
| Task needs to write to notebook/ | Allowed — notebook is not infrastructure |
| Task runs a long uv script (>5 min) | Agent SDK session handles naturally, no special timeout |
| Task creates files in workspace/ | Normal — that's what the workspace is for |
| Recurring task resumes with stale session | Falls back to fresh session (existing behavior) |
| Hook itself throws an error | Operation proceeds (permissive on error) |
| Playwright browser fails to launch | Task reports error, doesn't crash the dashboard |
| Task extraction can't determine notifyOnCompletion | Omits it, system defaults apply |
| User requests correction to task results | Conversation Nina calls `revise_task`, executor resumes session |
| Revision on expired SDK session | Falls back to fresh session; status-report.md provides context |
| Revision on running task | `revise_task` rejects — task must be completed first |
| Multiple revisions on same task | Each appends to instructions; session builds on prior context |

---

## 9. Test Strategy

- **Unit tests:** Infrastructure guard hook — verify deny for each protected pattern, verify allow for normal operations
- **Unit tests:** Audit hook — verify JSONL log entry format
- **Unit tests:** Timezone resolution utility — verify properties → preferences → UTC fallback
- **Unit tests:** notifyOnCompletion extraction — verify "message me" → immediate, "check daily" → debrief
- **Integration:** Create a task via API with `notifyOnCompletion: "immediate"`, verify it runs with full tool access and sends WhatsApp notification
- **Integration:** Create a task that runs `uv run` to execute a Python script, verify output
- **Integration:** Verify infrastructure guard blocks write to brain/CLAUDE.md
- **Browser verification:** Playwright MCP available in conversation Nina session

---

## 10. Relationship to Future Milestones

| Milestone | How S4 Enables It |
|-----------|-------------------|
| **M6.8 Skills** | Task cwd enables `settingSources: ['project']` skill discovery. Drop skills into `.claude/skills/` in task folder → auto-loaded. |
| **M7 Coding Projects** | Working Agent = S4's agentic task executor pointed at a code repo. Tools, hooks, cwd already wired. |
| **M9/M10 External Comms** | Working Agent for external contacts uses the same agentic session. |

---

*Created: 2026-03-14*
