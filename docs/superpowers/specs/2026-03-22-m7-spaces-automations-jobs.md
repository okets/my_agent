# M7: Spaces + Automations + Jobs — Design Spec

> **Status:** Final draft — CTO review pending
> **Date:** 2026-03-22
> **Scope:** M7 Persistent Workspaces (expanded — replaces original 2-sprint estimate)
> **Supersedes:** Plan A (workspaces), Plan B (spaces+tasks), Plan C draft (spaces+routines+jobs)
> **Validated against:** Codebase audit of 15 critical files, 3-agent stress test, SDK verification

---

## Design Philosophy

> "Nina's space to maintain, the user's to work with and enjoy."

Nina thinks in three concepts:

- **Places** she manages — her toolbox, the user's folders, shared drives, code repos
- **Standing instructions** she follows — "file invoices when they arrive," "check prices every Monday"
- **Work she does** — each time an instruction fires, she does a discrete piece of work and logs it

The user doesn't think about the plumbing. They say "organize my NAS photos" and Nina sets up the space, the automation, and the watch trigger. Photos appear sorted. The user enjoys the result.

---

## Core Principles

1. **Filesystem is source of truth.** Space manifests, automation manifests, and job logs live on disk. agent.db is a derived index, rebuildable by scanning the filesystem. JSONL is valid source-of-truth for append-only data (same pattern as conversation transcripts).
2. **No folder pollution.** External folders (NAS, repos, user's Documents) are never modified by Nina's governance. Manifests and rules live in `.my_agent/`.
3. **Extend, don't rebuild.** The codebase has battle-tested infrastructure (TaskExecutor, ConversationInitiator, SyncService, PostResponseHooks). M7 extends these — it does not create parallel systems.
4. **Tools are living artifacts.** Operational history in `DECISIONS.md`. Maintenance rules in `SPACE.md`. Fix before replace. Future agents read the history before modifying.
5. **Brain and workers never mix.** Brain triages and presents. Workers execute autonomously. Clean separation enforced by tool restrictions. This already works — M7 preserves it.

---

## Entities

### Spaces

A Space is any folder Nina knows about and manages.

**Where they live:**
- Internal (tools, code projects, data): `.my_agent/spaces/{name}/`
- External (shared folders, repos): anywhere on filesystem, including SMB/NFS mounts. `SPACE.md` lives in `.my_agent/spaces/{name}/` and points to the external path via `path` field.

**Manifest format** (`SPACE.md` with YAML frontmatter, read/written via `readFrontmatter()`/`writeFrontmatter()`):

```yaml
---
name: web-scraper
tags: [tool, scraper]             # optional, aids discovery queries
runtime: uv                       # if executable (uv | node | bash)
entry: src/scraper.py             # if it has a defined entry point
io:                                # if it has an I/O contract
  input:
    url: string
    depth: number
  output:
    results: file                  # stdout (JSON) or file (path)
maintenance:                       # for tools — self-repair rules
  on_failure: fix                  # fix | replace | alert
  log: DECISIONS.md
created: 2026-03-22
---

# Web Scraper

Extracts structured data from websites using httpx + selectolux.

## Maintenance Rules

- If scraping fails, read DECISIONS.md for prior fixes before attempting repair
- If site layout changed, update selectors and test
- If fundamentally broken, log in DECISIONS.md and alert owner
- Never silently return empty results
```

**Capability composition — no rigid type system:**

| Fields present | What it is | Tags convention | Example |
|---|---|---|---|
| (none extra) | Data container | `[data]` | Invoice archive |
| `path: /external/...` | External reference | `[shared]` or `[project]` | NAS photos, code repo |
| `runtime` | Code project | `[project]` | A repo with a runtime |
| `runtime` + `entry` + `io` | Tool | `[tool]` | Web scraper, photo deduper |

Capabilities emerge from fields. Tags make discovery fast (`SELECT * FROM spaces WHERE tags LIKE '%tool%'`). A space can evolve: add `entry` + `io` to turn a code project into a tool. No migration, just add fields.

**External space** (shared folder — the external folder stays clean):

```yaml
---
name: nas-photos
tags: [shared]
path: /mnt/nas/photos
created: 2026-03-22
---

# NAS Photos

Family photo library on the NAS. Organized by YYYY/MM/.
```

**Operational history** (`DECISIONS.md`):

Tools and code projects carry a decision log. When Nina modifies, fixes, or replaces a tool, she logs why. Future agents read this before touching the tool.

**Filesystem layout:**

```
.my_agent/spaces/
├── web-scraper/
│   ├── SPACE.md
│   ├── DECISIONS.md
│   └── src/scraper.py
├── invoice-archive/
│   ├── SPACE.md
│   └── 2026/Q1/...
├── nas-photos/
│   └── SPACE.md              # path: /mnt/nas/photos
├── market-data/
│   ├── SPACE.md
│   └── reports/
└── photo-deduper/
    ├── SPACE.md
    ├── DECISIONS.md
    └── src/dedup.py
```

### Automations

An Automation is a standing instruction with a trigger. It lives in `.my_agent/automations/` as a flat markdown file.

**Manifest format:**

```yaml
---
name: File Invoices
status: active                    # active | disabled
trigger:
  - type: channel
    hint: "invoice, receipt, expense"
  - type: watch
    path: /home/nina/Documents/incoming/
    polling: true
spaces: [invoice-archive]
model: sonnet                     # cost control — per-automation model override
notify: immediate                 # immediate | debrief | none
persist_session: false            # SDK session resumption for recurring work
autonomy: full                    # full | cautious | review (prompt-driven)
once: false                       # true = fire immediately, auto-disable after
delivery:                         # optional — channel delivery on completion
  - channel: whatsapp
    content: "Invoice filed: {summary}"
created: 2026-03-22
---

# File Invoices

When an invoice arrives (via WhatsApp or dropped in incoming/),
file it in the invoices folder following the naming convention.

## Rules
- Organize by quarter (Q1-2026/, Q2-2026/)
- PDF only
- Name: YYYY-MM-DD-vendor-amount.pdf
```

**Trigger types:**

| Trigger | Detection mechanism | Consumer |
|---|---|---|
| `schedule` | `cron-parser` evaluates cron expression | AutomationScheduler (polls every 60s) |
| `channel` | Haiku extraction matches message to automation hints | PostResponseHooks (extended) |
| `watch` | Chokidar detects file change at space/external path | WatchTriggerService |
| `manual` | User or brain explicitly fires via MCP tool | `fire_automation` MCP tool |

**Multiple triggers:** An automation can have multiple triggers (array). The invoice automation fires on both channel messages AND file drops.

**One-off automations:** For substantial one-off work, the brain creates an automation with `once: true` and calls `fire_automation` immediately. The automation auto-disables after completion. The file persists as a searchable record.

**Manifest fields reference:**

| Field | Required | Default | Purpose |
|---|---|---|---|
| `name` | Yes | — | Human-readable name |
| `status` | Yes | `active` | `active` or `disabled` |
| `trigger` | Yes | — | Array of trigger definitions |
| `spaces` | No | `[]` | Referenced space names |
| `model` | No | brain default | Model override (haiku/sonnet/opus) |
| `notify` | No | `debrief` | How to notify on completion |
| `persist_session` | No | `false` | Resume SDK session across jobs |
| `autonomy` | No | `full` | Worker autonomy level |
| `once` | No | `false` | Fire once and auto-disable |
| `delivery` | No | `[]` | Channel delivery actions (WhatsApp, email, dashboard) |
| `created` | Yes | — | Creation timestamp |

### Jobs

A Job is a discrete unit of work — one execution of an automation. Jobs are **not files**. They are JSONL log entries, one file per automation:

```
.my_agent/automations/
├── file-invoices.md              # the standing instruction
├── file-invoices.jsonl           # job history (append-only)
├── weekly-price-check.md
└── weekly-price-check.jsonl
```

**Job entry format:**

```jsonl
{"id":"job-01ABC","created":"2026-03-22T14:30:00Z","status":"completed","completed":"2026-03-22T14:30:05Z","summary":"Filed Uber receipt to Q1-2026/","context":{"trigger":"channel","file":"/staging/invoice.pdf"},"sdk_session_id":"sess-xyz"}
{"id":"job-02DEF","created":"2026-03-25T09:00:00Z","status":"failed","summary":"Scraper timeout on competitor-b.com","context":{"trigger":"schedule"}}
{"id":"job-03GHI","created":"2026-03-25T09:05:00Z","status":"needs_review","summary":"Competitor A removed public pricing — significant?","context":{"trigger":"schedule"}}
```

**Job fields:**

| Field | Purpose |
|---|---|
| `id` | Unique job ID (`job-{ulid}`) |
| `created` | Timestamp |
| `status` | `pending` / `running` / `completed` / `failed` / `needs_review` |
| `completed` | Completion timestamp |
| `summary` | Human-readable result summary |
| `context` | Trigger payload — file path, message content, cron tick |
| `sdk_session_id` | Agent SDK session ID (for resume) |
| `run_dir` | Path to ephemeral run directory |

**Why JSONL:** Jobs accumulate (52 invoices/year per automation). JSONL is compact, append-only, and follows the same pattern as conversation transcripts (already JSONL in this codebase). The derived agent.db `jobs` table enables fast timeline queries.

**Job run directories:** Each job gets an ephemeral scratch space at `.my_agent/automations/.runs/{automation-name}/{job-id}/`. Default retention: 7 days. Jobs with `status: needs_review` retain their run directory until resolved. `once: true` automations retain indefinitely.

**Timeline queries:** The derived agent.db indexes jobs for fast queries:
- "What did Nina do yesterday?" → `SELECT * FROM jobs WHERE created > ? ORDER BY created DESC`
- "When was the last invoice filed?" → `SELECT * FROM jobs WHERE automation_id = ? ORDER BY created DESC LIMIT 1`
- Future projection: evaluate active automation cron expressions for a date range.

---

## Architecture: Brain and Workers

M7 preserves the existing brain/worker architecture. It does not redesign it.

### Existing Architecture (verified from code)

| | Conversation Nina (Brain) | Working Nina (Worker) |
|---|---|---|
| **Session** | Per-conversation, long-running (`SessionManager`) | Per-job, independent subprocess (`TaskExecutor`) |
| **Tools** | Read, Glob, Grep, WebSearch, WebFetch, Skill (NO Bash/Write/Edit) | Bash, Read, Write, Edit, Glob, Grep, Skill (NO WebSearch/WebFetch) |
| **MCP** | automation-server, skill-server, memory, conversations, knowledge, debrief | memory, knowledge (subset) |
| **Persona** | Full identity, personality, conversational | "Autonomous task execution agent, not conversational" |
| **Bridge** | Receives completion via `ConversationInitiator.alert()` | Produces results, no way to reach user directly |

**Key property:** Brain cannot execute work (no Bash/Write/Edit). Worker cannot talk to user (no channel tools). Clean separation enforced by tool restrictions (the `WORKER_TOOLS` constant in `task-executor.ts`).

### Workload Distribution

```
User message → Brain (triage, delegate, present)
                  │
                  ├── Simple question → Brain answers directly (no worker)
                  ├── Complex work → create/fire automation → Worker executes
                  └── Ambiguous result → Worker reports → Brain presents → User decides
```

### Human-in-the-Loop via SDK Session Resumption

Workers can halt and resume when human input is needed. This uses the **existing session resumption mechanism** in `TaskExecutor` (lines 379-404):

1. Worker hits decision point → marks job as `needs_review` via MCP tool
2. Worker's SDK session ends normally. Session ID stored in job entry + sidecar file (`.my_agent/automations/.sessions/{name}.json`).
3. `needs_review` status triggers `ConversationInitiator.alert()` → brain presents question to user
4. User responds → brain calls `resume_job(jobId, userResponse)` MCP tool
5. `AutomationExecutor` resumes the session: `createBrainQuery({ resume: storedSessionId, prompt: userResponse })`
6. Worker continues with full prior context — SDK handles session state

**Key:** This is NOT a custom checkpoint pattern. It uses the SDK's native `resume` parameter, already proven for recurring tasks (`persistSession: !!task.recurrenceId` in `task-executor.ts:501`). The only new wiring is `needs_review` → notification.

### Autonomy Tiers (prompt-driven)

```yaml
autonomy: full      # Decide everything. Default for schedule/watch triggers.
autonomy: cautious  # Flag irreversible decisions via needs_review. Resume after user input.
autonomy: review    # Produce plan only. Wait for approval before executing.
```

These change the worker's system prompt instructions. No new infrastructure — same SDK session, different instructions.

---

## Execution Pipeline

### Trigger → Job → Execution → Result

```
Trigger detected
    │
    ▼
AutomationJobService
    ├── Creates job entry in JSONL (status: pending)
    ├── Creates ephemeral run directory
    │
    ▼
AutomationExecutor (extends TaskExecutor pattern)
    ├── Reads automation manifest + referenced SPACE.md files
    ├── Builds system prompt via buildWorkingNinaPrompt() + automation context:
    │     ├── Notebook context, calendar, properties (existing, reused)
    │     ├── Automation rules + instructions (new)
    │     ├── Space manifests + I/O contracts (new)
    │     ├── Maintenance rules for referenced tools (new)
    │     ├── Trigger context/payload (new)
    │     └── Autonomy-level instructions (new)
    ├── Spawns Agent SDK session via createBrainQuery():
    │     ├── model = automation.model ?? brainConfig.model (existing per-task override pattern)
    │     ├── tools = WORKER_TOOLS (Bash, Read, Write, Edit, Glob, Grep, Skill)
    │     ├── cwd = automation run directory
    │     ├── resume = storedSessionId (if persist_session or continuing needs_review)
    │     ├── hooks = existing safety hooks (audit, path restrictions)
    │     ├── mcpServers = memory, knowledge (subset)
    │     └── skills filtered by filterSkillsByTools() (existing pattern)
    ├── Worker executes autonomously
    │     ├── Tool invocation: cd space && runtime run entry '{input}' (via Bash tool, hooks preserved)
    │     ├── Results written to data spaces or run directory
    │     ├── Tool failures → inline repair (read DECISIONS.md, one attempt, log result)
    │     └── If autonomy=cautious and uncertain → mark needs_review, stop
    │
    ▼
AutomationProcessor (adapts TaskProcessor pattern)
    ├── Updates job JSONL entry (status: completed/failed/needs_review)
    ├── Stores SDK session ID if persist_session=true or needs_review
    ├── If delivery actions → DeliveryExecutor (WhatsApp, email, dashboard — existing)
    │     └── Channel-specific formatting (WhatsApp limits, email rich — existing in TaskExecutor)
    ├── If notify=immediate → ConversationInitiator.alert()
    │     └── Falls back to ConversationInitiator.initiate() if no active conversation (15min threshold)
    ├── If notify=debrief → batched for morning debrief
    ├── If needs_review → ConversationInitiator.alert() with question from run directory
    └── App event emission → StatePublisher → WebSocket broadcast (dashboard real-time update)
```

### Per-Trigger-Type Flows

#### Schedule trigger

```
AutomationScheduler (polls every 60s)
  → Queries agent.db: SELECT * FROM automations WHERE trigger_type='schedule' AND status='active'
  → Evaluates cron via cron-parser against current time (timezone-aware, reuses isDue() patterns)
  → If due → AutomationJobService.createJob() → execution pipeline
```

**When automation manifest changes:** AutomationSyncService (chokidar) detects file change → re-parses frontmatter → updates agent.db. Next poll cycle reads new cron. No restart.

#### Channel trigger

```
User sends "here's my invoice" on WhatsApp
  → ChannelMessageHandler routes to brain session (existing flow)
  → Brain responds (may or may not match automation)
  → PostResponseHooks fires (after every response, fire-and-forget — existing pattern):
      → Extended extractTaskFromMessage() with Haiku:
          Input: user message + assistant response + active automation hints from agent.db
          Output: { matched_automation?, confidence, extracted_context } OR { new_task }
      → If automation matched → fire_automation(id, extracted_context)
      → If brain already fired it → skip (dedup via 5-minute window, existing pattern)
      → If new task needed → existing task extraction flow (preserved)
```

**Why Haiku extraction:** Structured input validation + semantic matching. Extends the existing `extractTaskFromMessage()` (269 lines, `task-extractor.ts`) — already runs on every message, already uses Haiku, already has retry logic and structured output. The extraction prompt gains an "active automations" section; the output schema gains a `matched_automation` field. Existing task extraction path is preserved alongside.

**When automation manifest changes:** AutomationSyncService updates agent.db. The extraction prompt's automation hints are rebuilt from agent.db on each call (cheap — Haiku reads a compact list). Brain's system prompt also updated via dynamic block + cache invalidation.

#### Watch trigger

```
File saved to /mnt/nas/photos/IMG_1234.jpg
  → WatchTriggerService (chokidar, polling mode for NAS)
  → Debounces by space: if N files arrive within 5 seconds, batch into one job
  → Resolves path → automation(s) via internal map (path → automationId[])
  → AutomationJobService.createJob() with context: { trigger: "watch", files: [...], event: "add" }
  → Execution pipeline
```

**When automation manifest changes:** AutomationSyncService emits `automation:updated` event. WatchTriggerService compares current watchers against agent.db watch triggers. Tears down stale watchers, registers new ones. No restart.

**Network mounts:** Chokidar uses `usePolling: true` (already used by memory SyncService for WSL2 compatibility). Configurable interval. On mount drop: chokidar `error` event → retry with `computeBackoff()` (existing utility) → `ConversationInitiator.alert()` if persistent.

#### Manual trigger

```
User: "Run the price check now"
  → Brain calls fire_automation("weekly-price-check") MCP tool
  → AutomationJobService.createJob() → execution pipeline
```

#### One-off automation

```
User: "Research coworking spaces in Tel Aviv"
  → Brain creates automation: create_automation({ once: true, trigger: "manual", ... })
  → Brain immediately calls fire_automation()
  → Worker executes → results delivered to user
  → Automation auto-disabled (status: disabled)
  → File persists as searchable record
```

### Concurrency Model

**Per-automation semaphore:** One concurrent job per automation. Different automations run in parallel.

```typescript
const runningJobs = new Map<automationId, Promise<void>>();
```

**Per-trigger-type behavior:**
- **Watch:** Debounce by space — rapid file events within 5 seconds batched into one job
- **Schedule:** Per-automation semaphore — one cron job at a time per automation
- **Channel:** Parallel — each user request gets immediate response, no queuing

### Execution Mode

**Agent-mode only for MVP.** All jobs run through the Agent SDK (`createBrainQuery()`), preserving the existing safety hook pipeline (audit logging, path restrictions). The tool's shell command (`cd space && runtime run entry '{input}'`) is invoked through the agent's Bash tool, which goes through hooks.

The `model` field on the automation manifest controls cost:
- Opus: complex research, multi-step analysis
- Sonnet: standard work (default)
- Haiku: simple maintenance, summaries

Direct shell exec mode (zero LLM cost) is a **future optimization** — it bypasses the hook pipeline and needs its own safety integration before it's safe to enable.

---

## Tool Lifecycle

Tools are spaces with `runtime` + `entry` + `io`. Their lifecycle is emergent from the automation execution pipeline — no separate tool framework needed.

### Creation

Brain creates a `once: true` automation: "Build a web scraper tool." Worker (Opus, agent mode) creates the space directory, writes SPACE.md + code + DECISIONS.md, bootstraps runtime (`uv init && uv add`), tests. SpaceSyncService detects SPACE.md → indexes into agent.db.

The worker's system prompt includes a "Tool Space Creation Guide" — SPACE.md format, directory conventions, runtime setup commands per runtime type.

### Discovery

MCP tool `list_spaces` with filters: `tags`, `runtime`, `search`. Brain uses LLM judgment over descriptions + tags. Query: `SELECT * FROM spaces WHERE tags LIKE '%tool%'`.

### Invocation

Via Bash tool (hooks preserved):

```bash
cd .my_agent/spaces/web-scraper && uv run src/scraper.py '{"url":"https://example.com"}'
```

**Error detection hierarchy:**
1. Exit code != 0 → crash (programmatic)
2. Empty stdout → no results (programmatic)
3. Invalid JSON → garbage output (programmatic)
4. Semantic issues → LLM judgment

**Output mode** declared in `io.output`: `stdout` (JSON to stdout) or `file` (writes to space directory).

**Timeout:** Inherits Bash tool's default timeout for MVP.

### Failure and Repair

Inline repair by the same executor, guided by SPACE.md `maintenance` section:

1. Tool fails → executor reads `maintenance.on_failure` field
2. If `fix`: reads DECISIONS.md + source code, makes ONE repair attempt, retests
3. If fixed: logs fix in DECISIONS.md, continues job
4. If still broken: marks job failed, logs in DECISIONS.md
5. If `replace`: creates new tool space, deprecates old one
6. If `alert`: notifies user via ConversationInitiator, does not touch tool

**Repair boundaries:** One attempt per job. No unbounded repair loops.

### Evolution

No formal versioning — DECISIONS.md is the changelog. For changes to shared tools:

1. Query dependents: `SELECT * FROM automations WHERE spaces LIKE '%tool-name%'` (reverse index)
2. Ensure backward compatibility with optional params and defaults
3. Test with sample inputs for all dependent automation use cases
4. Update DECISIONS.md

### Secrets

Tools inherit the process environment for MVP. Tool-specific secrets use namespace prefixes (e.g., `SCRAPER_PROXY_KEY` in the main `.env`).

---

## Shared Folder Governance

A shared folder = an external space + an automation with a watch trigger.

**The space** (in `.my_agent/spaces/{name}/`) points to the external path. The external folder is never modified by Nina's governance layer.

**The automation** defines the rules and watches for changes:

```yaml
# .my_agent/automations/sort-nas-photos.md
---
name: Sort NAS Photos
status: active
trigger:
  - type: watch
    space: nas-photos
    events: [add]
    polling: true
    interval: 5000
spaces: [nas-photos, photo-deduper]
notify: none
---

When new photos appear on the NAS:
1. Deduplicate by hash, keep highest resolution
2. Organize by EXIF date into YYYY/MM/
3. Strip location metadata for privacy
```

**SMB/NFS mounts:** Chokidar polling mode (`usePolling: true`). On mount drop: retry with `computeBackoff()` (existing utility), alert user if persistent.

---

## Sync Infrastructure

### FileWatcher Utility (extracted from SyncService)

The existing `SyncService` (`packages/core/src/memory/sync-service.ts`, 359 lines) is tightly coupled to memory/embeddings (chunks markdown, generates embeddings, stores in MemoryDb). It cannot be extended directly for spaces and automations.

**Extract the watch+debounce+hash pattern** into a reusable `FileWatcher` utility:
- Chokidar configuration (polling support, exclude patterns)
- File change debouncing (1.5s default)
- SHA256 hash-based change detection (skip unchanged files)
- Full sync on startup (scan → diff against DB → add/update/remove)
- EventEmitter for sync events

Build sync services on top:

| Service | Watches | Processes | Indexes into |
|---------|---------|-----------|-------------|
| `SpaceSyncService` | `.my_agent/spaces/*/SPACE.md` | Parse YAML frontmatter, extract capabilities, tags | agent.db `spaces` table |
| `AutomationSyncService` | `.my_agent/automations/*.md` | Parse YAML frontmatter, extract triggers, spaces refs | agent.db `automations` table |
| `WatchTriggerService` | External paths from watch triggers | Detect file events, resolve to automations | Fires automation jobs |

**Existing `SyncService`** (memory) stays untouched initially. Refactored to use `FileWatcher` internally when convenient (not a blocker).

### Derived Database Schema (agent.db)

```sql
-- Spaces table (derived from SPACE.md files)
CREATE TABLE spaces (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  tags TEXT,                             -- JSON array
  runtime TEXT,
  entry TEXT,
  io TEXT,                               -- JSON io contract
  maintenance TEXT,                      -- JSON maintenance config
  description TEXT,                      -- markdown body (for search)
  indexed_at TEXT NOT NULL
);

-- Automations table (derived from automation .md files)
CREATE TABLE automations (
  id TEXT PRIMARY KEY,                   -- filename without .md
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  trigger_config TEXT NOT NULL,          -- JSON array of trigger definitions
  spaces TEXT,                           -- JSON array of space names
  model TEXT,
  notify TEXT DEFAULT 'debrief',
  persist_session INTEGER DEFAULT 0,
  autonomy TEXT DEFAULT 'full',
  once INTEGER DEFAULT 0,
  delivery TEXT,                         -- JSON delivery actions
  created TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

-- Jobs table (derived from JSONL files, for timeline queries)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created TEXT NOT NULL,
  completed TEXT,
  summary TEXT,
  context TEXT,                          -- JSON trigger payload
  sdk_session_id TEXT,
  run_dir TEXT,
  FOREIGN KEY (automation_id) REFERENCES automations(id)
);
CREATE INDEX idx_jobs_automation ON jobs(automation_id);
CREATE INDEX idx_jobs_created ON jobs(created);
CREATE INDEX idx_jobs_status ON jobs(status);
```

**Rebuild guarantee:** Delete agent.db → restart → SpaceSyncService scans `SPACE.md` files, AutomationSyncService scans automation manifests, job JSONL files are re-indexed. Nothing lost.

### Event Chain (sync → downstream)

```
File change detected (chokidar)
  → SyncService parses and updates agent.db
  → Emits sync event
  → Downstream consumers react:
      ├── SystemPromptBuilder.invalidateCache()     # brain sees updated automation hints
      ├── AutomationScheduler re-reads schedules    # schedule triggers updated
      ├── WatchTriggerService updates watchers       # watch triggers added/removed
      └── StatePublisher broadcasts to dashboard     # UI updated in real-time
```

This follows the existing pattern: memory SyncService → cache invalidation → work loop pattern reload (app.ts lines 804-808).

---

## Brain Integration

### System Prompt: Automation Awareness

Add a **dynamic block** to `assembleSystemPrompt()` (`packages/core/src/prompt.ts`):

```
## Active Automations

You have these standing instructions. When a user's message matches one, call fire_automation().

- File Invoices (hints: invoice, receipt, expense) → files in invoice-archive
- Weekly Price Check (schedule: Mon 9am) → scrapes competitor prices
- Sort NAS Photos (watch: /mnt/nas/photos) → deduplicates and organizes
```

**Token budget:** ~50 characters per automation. At 20 automations = ~1000 characters. At 50+ automations, switch to pull model (brain queries `list_automations` MCP tool on demand).

**Cache invalidation:** AutomationSyncService sync events trigger `promptBuilder.invalidateCache()` (same pattern as memory sync, app.ts:806). Brain sees updated hints on next conversation turn.

### Channel Trigger: Haiku Semantic Matching

The existing `PostResponseHooks` → `extractTaskFromMessage()` flow (fire-and-forget after every response) is the integration point for channel triggers.

**Extend `extractTaskFromMessage()`** (`packages/dashboard/src/tasks/task-extractor.ts`, 269 lines) to include automation matching:

```
Current Haiku prompt:
  "Should this conversation create a task? Extract if yes."

Extended Haiku prompt:
  "Should this conversation create a task? OR does it match one of these active automations?
   Active automations: [{name, hints, description}]
   If automation match: return { matched_automation, confidence, extracted_context }
   If new task: return { task extraction as before }
   If neither: return { shouldCreateTask: false }"
```

This preserves:
- The existing extraction schema and retry logic (MAX_ATTEMPTS = 2)
- The 5-minute dedup window (don't fire if brain already handled it)
- The fire-and-forget pattern (non-blocking)
- Multi-task extraction support (already implemented, lines 76-78)

**Input validation:** Haiku extracts structured context (vendor name, amount, file type) from unstructured messages. This validated context flows into the job's `context` field, giving the worker clean inputs instead of raw message text.

### MCP Tools: automation-server.ts

New MCP server registered in the brain session:

| Tool | Description | Used by |
|---|---|---|
| `create_automation` | Create a new automation manifest | Brain (from conversation) |
| `fire_automation` | Trigger an automation with context | Brain (channel trigger), PostResponseHooks |
| `list_automations` | Query active automations with filters | Brain (discovery, triage) |
| `resume_job` | Resume a needs_review job with user input | Brain (HITL flow) |
| `list_spaces` | Query spaces with capability filters | Brain (tool discovery) |
| `create_space` | Create a new space directory + manifest | Brain / Worker |

Pattern: `tool(name, description, schema, handler)` via `createSdkMcpServer()` — same as existing `task-tools-server.ts` (302 lines).

**Preserved MCP tools:** `create_task`, `revise_task`, `search_tasks` remain available. Old task system coexists.

### Media Staging

WhatsApp images arrive as base64 `ImageBlock` in the brain's context (`brain.ts:55-58`). For automations that process files, media needs to be on disk.

**Add `.my_agent/staging/` directory.** Transport plugins save incoming media there before brain processing. Brain gets file paths in conversation context, not base64. Jobs reference staging paths in trigger payload.

---

## Existing Infrastructure: What to Extend

### TaskExecutor → AutomationExecutor

`TaskExecutor` (`packages/dashboard/src/tasks/task-executor.ts`, 548 lines) already handles:
- SDK session resumption via `db.getTaskSdkSessionId()` / `updateTaskSdkSessionId()` (lines 379-404)
- Fallback from resume to fresh session when stale (lines 383-395)
- Session persistence for recurring work (`persistSession: !!task.recurrenceId`, line 501)
- Per-task model override (`task.model ?? brainConfig.model`, line 377)
- MCP servers + hooks injection (lines 428-429, 498-500)
- Skill filtering by worker tool set (`filterSkillsByTools`, lines 177-179)
- Working Nina persona via `buildWorkingNinaPrompt()` (lines 471-476)
- `<deliverable>` tag extraction for channel delivery (lines 65-76)
- Channel-specific formatting constraints (WhatsApp limits, email rich, etc.) (lines 101-128)
- Execution logging via JSONL (lines 198-214)
- Calendar + notebook context injection (lines 283-297, 438-452)
- Prior context injection for recurring tasks (lines 283-297)

**AutomationExecutor extends this.** Additions:
- Reads automation manifest instead of Task entity
- Injects space manifests + I/O contracts into system prompt
- Injects maintenance rules for referenced tools
- Injects trigger context/payload
- Injects autonomy-level instructions
- Session ID stored in job JSONL + sidecar file (not task DB column)

**Does NOT duplicate:** Prompt assembly, SDK query construction, session resumption, skill filtering, deliverable extraction, logging, hook wiring, channel formatting.

### TaskProcessor → AutomationProcessor

`TaskProcessor` (`packages/dashboard/src/tasks/task-processor.ts`, 349 lines) already handles:
- Delivery via `DeliveryExecutor` for WhatsApp, email, dashboard (lines 148-165)
- Result delivery to linked conversations (lines 198-278)
- `notifyOnCompletion`: "immediate" vs "debrief" modes (lines 254-256)
- ConversationInitiator integration with alert → initiate fallback (lines 253-277)
- Status report loading from task workspace (lines 302-318)
- WebSocket broadcasting for real-time dashboard updates (lines 323-347)

**AutomationProcessor adapts this.** Changes:
- Reads from automation manifest + job JSONL instead of Task entity
- `needs_review` → triggers `ConversationInitiator.alert()` (wires the current dead end)
- Delivery actions from automation manifest `delivery` field

### PostResponseHooks → Extended for Automation Matching

`PostResponseHooks` (`packages/dashboard/src/conversations/post-response-hooks.ts`, 72 lines) already:
- Runs after every assistant response, fire-and-forget (line 30-33)
- Calls `extractTaskFromMessage()` with Haiku (line 44)
- Checks 5-minute dedup window (lines 52-58)
- Detection only — logs warnings, doesn't auto-create (line 8)

**Extension:** Add automation matching to the extraction call. If matched → fire automation. If brain already handled → skip (existing dedup). Existing task extraction path preserved alongside.

### ConversationInitiator → Reuse As-Is

`ConversationInitiator` (`packages/dashboard/src/agent/conversation-initiator.ts`, 231 lines):
- `alert(prompt)` — injects into active conversation (15-minute activity threshold)
- `initiate(options)` — creates new conversation if none active
- Already used by TaskProcessor (lines 260-277) and WorkLoopScheduler (lines 793-807)

**Zero new code needed** for automation completion notification.

### WorkLoopScheduler → Keep Separate (NOT Absorbed)

`WorkLoopScheduler` (`packages/dashboard/src/scheduler/work-loop-scheduler.ts`, 996 lines) has **hard-coded handlers** via a switch statement (lines 413-431): `debrief-prep`, `daily-summary`, `weekly-review`, `weekly-summary`, `monthly-summary`. Each handler is 200+ lines of custom aggregation logic reading from ConversationManager, TaskManager, NotificationService, knowledge staging, properties, calendar.

**These are memory maintenance jobs, NOT user automations.** They stay in WorkLoopScheduler.

**Coexistence:**
- WorkLoopScheduler continues for memory maintenance (unchanged)
- AutomationScheduler handles user-defined automations (new)
- End state: 3 schedulers (Calendar, WorkLoop, Automation) — each with clear responsibility

**`isDue()` reuse:** The `isDue()` function in `work-patterns.ts` (lines 60-206) with timezone awareness is production-tested. AutomationScheduler can reuse timezone resolution patterns. New automations use cron via `cron-parser`.

---

## App Integration

### Initialization Order (App.create())

New services initialize after ConversationManager (needs agent.db) but before WorkLoopScheduler:

```
... existing init ...
→ ConversationManager (agent.db ready)
→ SpaceSyncService (new — indexes spaces into agent.db)
→ AutomationSyncService (new — indexes automations into agent.db)
→ AutomationScheduler (new — reads schedule triggers from agent.db)
→ WatchTriggerService (new — registers chokidar watchers from agent.db)
→ AutomationProcessor (new — handles job lifecycle)
→ WorkLoopScheduler (existing — memory maintenance, unchanged)
... rest of existing init ...
```

Uses the existing **lazy getter pattern** for cross-service references (avoids circular initialization).

### App Service Namespaces

Following `AppTaskService` pattern (thin wrappers with event emission):

```typescript
app.spaces.create(input): Space
app.spaces.list(filter?): Space[]
app.spaces.findByName(name): Space | null

app.automations.create(input): Automation
app.automations.list(filter?): Automation[]
app.automations.fire(id, context?): Job
app.automations.resume(jobId, userInput): Job
```

### App Events

```typescript
interface AppEventMap {
  // ... existing events preserved ...
  'space:created': Space;
  'space:updated': Space;
  'space:deleted': string;
  'automation:created': Automation;
  'automation:updated': Automation;
  'automation:triggered': { automation: Automation; job: Job };
  'job:started': Job;
  'job:completed': Job;
  'job:failed': Job;
  'job:needs_review': Job;
}
```

StatePublisher subscribes → WebSocket broadcast → dashboard real-time updates (free, existing pattern).

---

## Package Structure

New files in `packages/dashboard/src/automations/`:

```
packages/dashboard/src/automations/
├── automation-manager.ts          # Manifest CRUD (filesystem primary + DB index)
├── automation-executor.ts         # Extends TaskExecutor pattern
├── automation-processor.ts        # Adapts TaskProcessor pattern
├── automation-scheduler.ts        # Cron evaluation + job creation
├── automation-job-service.ts      # JSONL lifecycle (create, update, query)
├── watch-trigger-service.ts       # Chokidar on external paths
└── index.ts
```

New files in `packages/core/`:

```
packages/core/src/
├── spaces/
│   ├── types.ts                   # Space, Automation, Job type interfaces
│   └── index.ts
├── sync/
│   ├── file-watcher.ts            # Extracted watch+debounce+hash utility
│   └── index.ts
└── spaces/
    └── space-sync-service.ts      # SPACE.md → agent.db (framework-level)
```

New MCP server:

```
packages/dashboard/src/mcp/
└── automation-server.ts           # create/fire/list/resume automation tools
```

---

## Migration

### What Changes

| Current | New | Strategy |
|---|---|---|
| `tasks` table in agent.db (primary store) | `automations` + `jobs` tables (derived index) | Additive — both coexist |
| `create_task` MCP tool | `create_automation` + `fire_automation` | Both available |
| `TaskManager` CRUD | `AutomationManager` filesystem CRUD | Parallel, no conflict |
| Task folders (`.my_agent/tasks/{id}/workspace/`) | Automation run dirs + spaces | Old preserved until verified |
| `.my_agent/inbox/` | Automations with `trigger: manual, once: true` | Preserved, no writes |
| `.my_agent/projects/` | Spaces with external paths | Preserved, no writes |
| `.my_agent/ongoing/` | Automations with schedule/watch triggers | Preserved, no writes |

### What Does NOT Change

| Component | Why |
|---|---|
| WorkLoopScheduler | Memory maintenance — hard-coded handlers, NOT generic automations |
| CalendarScheduler | CalDAV polling — different domain |
| TaskManager + `create_task` | Old tasks coexist for backward compat |
| ConversationManager | Independent of automations |
| Memory SyncService | Separate concern |
| TransportManager | Infrastructure, unaffected |
| Brain persona + prompt | Extended with automation block, not replaced |
| `revise_task` MCP tool | Preserved — model for future `revise_job` |

### Migration Steps (S5)

1. Both systems running. No deletions.
2. Convert existing task folders to automation manifests where appropriate
3. Extract reusable task workspaces into spaces
4. Verify: scan new manifests → compare with original data
5. New work flows through `create_automation` + `fire_automation`
6. Old tasks age out naturally (completed tasks stay, no cleanup)
7. After CTO verification, stop writing to old task folders

**Work patterns are NOT migrated.** Memory maintenance stays in WorkLoopScheduler.

---

## Sprint Breakdown

| Sprint | Name | Scope |
|---|---|---|
| **S1** | Space Entity | `FileWatcher` utility (extracted from SyncService). Space model + types. `SPACE.md` manifest format. `SpaceSyncService`. agent.db `spaces` table. MCP tools: `create_space`, `list_spaces`. Internal + external spaces. |
| **S2** | Tool Spaces | Tool invocation via shell convention (through Bash tool, hooks preserved). I/O contract in manifest. `DECISIONS.md` lifecycle. Maintenance rules in SPACE.md. Tool creation template in worker prompt. Inline repair protocol (one attempt). |
| **S3** | Automations | Automation model + types. Manifest format. `AutomationSyncService`. `AutomationJobService` (JSONL lifecycle). `AutomationExecutor` (extends TaskExecutor). `AutomationProcessor` (adapts TaskProcessor). `AutomationScheduler` (cron-parser). MCP tools: `create_automation`, `fire_automation`, `list_automations`, `resume_job`. Per-automation concurrency semaphore. Automation hints in brain system prompt (dynamic block + cache invalidation). |
| **S4** | Triggers + Governance | `WatchTriggerService` (chokidar on external paths, polling for NAS/SMB). Watch trigger debouncing by space. Channel trigger via extended PostResponseHooks + Haiku extraction. Media staging directory. `needs_review` → ConversationInitiator wiring. SDK session resumption for HITL. |
| **S5** | Migration + Integration | Migrate existing tasks to automations. Extract reusable task workspaces into spaces. Headless App API (`app.spaces.*`, `app.automations.*`). App event wiring + StatePublisher. End-to-end verification of all 4 trigger types. Timeline queries (past from jobs, future from cron projection). |

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| AutomationExecutor wrapping TaskExecutor is ~200 lines of new prompt assembly code | Medium | Pattern is clear from existing TaskExecutor |
| Watch trigger concurrency — 10 files on NAS = 10 simultaneous API calls | High | Debounce by space (batch rapid events within 5s window) |
| Haiku extraction extension could break existing task detection | Medium | Additive schema change; existing path preserved; test both |
| agent.db schema changes (3 new tables) | Low | Additive — no existing table modifications |
| Prompt bloat from automation hints in brain system prompt | Medium | ~50 chars/automation; pull model at 50+ |
| JSONL job files grow unbounded | Low | 7-day retention for run dirs; future: JSONL rotation |
| 3 schedulers (Calendar, WorkLoop, Automation) after M7 | Low | Clear responsibility boundaries; no overlap |
| `needs_review` notification — 15-min activity threshold | Low | ConversationInitiator falls back to `initiate()` (existing behavior) |

---

## What This Plan Does NOT Do

- No dashboard UI for spaces or automations (future milestone)
- No space-scoped CLAUDE.md or skills loading (future)
- No direct shell exec mode (needs hook integration first)
- No cross-agent space sharing (single agent only)
- No formal tool versioning (DECISIONS.md is sufficient)
- No webhook or API event triggers (beyond file watching)
- No WorkLoopScheduler migration (memory maintenance stays separate)
- No automated regression testing for tools (convention-based via system prompt)

---

## Dashboard UI Changes

### Design Language

All UI follows the existing Tokyo Night theme, glass-strong panels, SVG icons (no emojis). Mockups are in `.superpowers/brainstorm/831611-1774235026/`.

### Home Tab: Two-Row Grid + Timeline

Desktop layout — compact 2x2 grid above the timeline:

```
┌─────────────────┬──────────────────┐
│ Spaces (5)      │ Automations (4)  │
│ web-scraper     │ 3 active         │
│ nas-photos +3   │ Last fired: 2h   │
├─────────────────┼──────────────────┤
│ Notebook        │ Conversations    │
│ 12 files        │ 3 recent         │
└─────────────────┴──────────────────┘
┌────────────────────────────────────┐
│ Timeline                           │
│ ● 9:00 AM  Price Check   schedule │
│ — NOW —                            │
│ ● 2h ago   Filed invoice  channel │
│ ● yesterday Sorted photos  watch  │
└────────────────────────────────────┘
```

Mobile layout — stacked compact cards with chevron expand/popover:

```
┌────────────────────────────────────┐
│ Spaces          5        ▼ │
├────────────────────────────────────┤
│ Automations     3 active   ▼ │
├────────────────────────────────────┤
│ Notebook        12 files   ▼ │
├────────────────────────────────────┤
│ Conversations   3 recent   ▼ │
└────────────────────────────────────┘
┌────────────────────────────────────┐
│ Timeline (same as desktop)         │
└────────────────────────────────────┘
```

Tapping a mobile widget card opens a popover (existing mobile pattern).

### Drill-Down Pattern

Same as existing (tasks, conversations, notebook):

1. **Home widget** — compact summary (count, last activity)
2. **Click widget** → opens browser tab (full searchable list)
3. **Click item** → opens detail tab (space or automation)
4. **Chat tag injected** — brain gets context when discussing the item

### Timeline

**Content:** Past jobs + NOW marker + future projected automation runs + calendar events. Order: past-to-future (chronological), consistent with existing timeline and calendar view.

**Job cards show:**
- Time (relative for today, absolute for older)
- Parent automation name
- Trigger badge (schedule / channel / watch / one-off)
- Summary text (one line)
- Status via dot color: green (completed), red (failed), amber (needs review), blue (scheduled/running), purple (calendar)

**Running jobs** get a pulsing blue dot and spinner badge.

**Needs review jobs** get amber highlight with the question as summary text.

**Future items:** Projected from active automation cron expressions. Calendar events from CalDAV. Clicking a future projected run opens the parent Automation tab.

**All timeline items click → Automation detail tab.**

### Old Tasks

Deleted. Clean slate. No migration UI, no legacy badges. Timeline shows jobs only.

### Space Detail Tab

Split-panel layout: file tree (left) + content preview / property view (right).

**File tree has two sections:**
- **Nina's Files** (top) — `SPACE.md` (manifest badge), `DECISIONS.md` (history badge). These are operational files.
- **Content** (below divider) — the actual space payload: src/, tests/, config files. Tree with folder expand/collapse, file type SVG icons, size indicators.

**When SPACE.md is selected:** Right panel shows property view with inline-editable fields:
- Inline-editable name in header bar
- Tag chips with add/remove (pill style, x-on-hover)
- Property rows: key-value pairs that look like text until hovered/focused, then show subtle underline
- Runtime as dropdown, entry point as editable mono text
- I/O contract as clean `name : type` table
- On-failure as toggle pills (fix / replace / alert)
- Maintenance rules as left-bordered list
- Description as readable text

**When DECISIONS.md is selected:** Right panel shows rendered markdown (decision history).

**When a content file is selected:** Right panel shows syntax-highlighted code preview or file preview.

**Header bar:** Space name (editable), tag chips, "Run" button (for tools).

**Footer:** "Referenced by automations" section — clickable links to automation tabs.

**Design principle:** Fields appear as content until interacted with. No visible form borders, no labeled input boxes. Edits write back to SPACE.md frontmatter via `writeFrontmatter()`.

### Automation Detail Tab

**Adapts emphasis based on type:**

**Recurring automation (active):**
- Header: inline-editable name, "active" status pill, "Fire now" + "Disable" buttons
- Triggers section: cards showing trigger type icon + config (cron with human-readable translation, channel hints, watch paths)
- Configuration: space chips (clickable → open space tab), model selector (dropdown), notify toggle pills (immediate / debrief / none), autonomy toggle pills (full / cautious / review)
- Instructions: left-bordered rule items
- Job history: chronological list with status dots (green/red/amber), dates, summaries, trigger badges. "N total" count.

**One-off automation (completed/disabled):**
- Header: name, "completed" status pill, "Run again" button
- **Result card is front and center** — the finding/deliverable, with completion time, duration, model used
- Configuration below (secondary): spaces, model, created date
- Original request: the instructions that were given

### Spaces Browser Tab

Full list of all spaces with search/filter. Each row shows:
- Space name + tags
- Capability indicators (runtime, entry point present)
- Path (for external spaces)
- Last used date
- Referencing automation count

### Automations Browser Tab

Full list of all automations with search/filter. Each row shows:
- Automation name + status pill (active/disabled)
- Trigger type icons
- Referenced spaces as chips
- Last fired date
- Job count

### WebSocket Real-Time Updates

New state messages following existing pattern:
- `state:spaces` → Updates `Alpine.store("spaces").items`
- `state:automations` → Updates `Alpine.store("automations").items`
- `state:jobs` → Updates timeline items

Triggered by App events (`space:created`, `automation:triggered`, `job:completed`, etc.) via StatePublisher (existing pattern).

### Sprint Scope

| Sprint | UI work |
|---|---|
| S1 | Spaces widget + browser tab + detail tab with tree view + property view |
| S2 | Tool-specific UI: "Run" button, I/O contract display, maintenance section |
| S3 | Automations widget + browser tab + detail tab. Timeline updated to show jobs. Automation MCP tools → chat tag injection. |
| S4 | Watch trigger status indicators. Timeline: needs_review amber highlight. |
| S5 | Delete old task UI. Future projected runs on timeline. End-to-end polish. |

---

## Appendix: Codebase Reference Map

Files that M7 extends or adapts (NOT replaces):

| File | Lines | M7 relationship |
|------|-------|-----------------|
| `dashboard/src/tasks/task-executor.ts` | 548 | **Pattern source** for AutomationExecutor. Session resumption, prompt assembly, deliverables, channel formatting all reused. |
| `dashboard/src/tasks/task-processor.ts` | 349 | **Pattern source** for AutomationProcessor. Delivery, notification, result broadcasting reused. |
| `dashboard/src/tasks/task-extractor.ts` | 269 | **Extended** with automation matching in Haiku prompt. Existing extraction preserved. |
| `dashboard/src/conversations/post-response-hooks.ts` | 72 | **Extended** to fire automations when Haiku matches. Existing 5-min dedup preserved. |
| `dashboard/src/scheduler/work-loop-scheduler.ts` | 996 | **NOT modified.** Memory maintenance stays. Coexists with AutomationScheduler. |
| `dashboard/src/scheduler/work-patterns.ts` | 433 | `isDue()` timezone patterns reusable. Cadence format coexists with cron. |
| `dashboard/src/scheduler/event-handler.ts` | 249 | **NOT modified.** Calendar events stay as tasks. Future: calendar → automations. |
| `dashboard/src/mcp/task-tools-server.ts` | 302 | **NOT modified.** `create_task`, `revise_task` preserved. Pattern source for automation-server.ts. |
| `dashboard/src/agent/conversation-initiator.ts` | 231 | **Reused as-is.** alert/initiate pattern for automation notifications. |
| `dashboard/src/app.ts` | 900+ | **Extended** with new service init, events, app namespaces. |
| `core/src/brain.ts` | 193 | **Unchanged.** `createBrainQuery()` already supports resume + model override. |
| `core/src/prompt.ts` | 516 | **Extended** with automation hints dynamic block. Cache invalidation wired. |
| `core/src/memory/sync-service.ts` | 359 | `FileWatcher` extracted as utility. SyncService refactored to use it. |
| `dashboard/src/conversations/db.ts` | 700+ | **Extended** with new tables: spaces, automations, jobs. Existing tables unchanged. |
