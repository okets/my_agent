# my_agent — Design Document

> **Status:** M1 Complete — M2 In Progress
> **Date:** 2026-02-12 (updated 2026-02-14)
> **Decision:** Replace OpenClaw with Claude Agent SDK-based architecture
> **Project name:** `my_agent`
> **Platform:** WSL (Linux)
> **Structure:** Public framework repo + `.my_agent/` private personality (gitignored, separate repo)

---

## Context

### Why This Change

OpenClaw's architecture has a fundamental mismatch with how users want to work with their agents:

1. **Sessions are black boxes.** You can't see what happened, can't resume, can't interact mid-flight.
2. **No course correction.** "Stop is a blind action — you don't know what you're stopping" (VISION.md Part 5).
3. **Context is trapped.** Sessions live inside WebSocket connections. When they end, the context is gone.

Core need: _"If I tell the agent a customer complained about a bug, it starts a Claude Code session and fixes it. A week later, I want to load that same context and ask for changes. Sessions should be meaningful tools."_

### Why Agent SDK

The Claude Agent SDK is the engine that powers Claude Code, exposed as a programmable library. It provides:

- Same tools, hooks, and skill system as Claude Code
- Long-running agent sessions with automatic context compression
- MCP server integration for external tools
- Session persistence and resume
- Subagent spawning for parallel work

The key insight: **folders as sessions.** Every task gets a project folder. Claude Code sessions run in those folders. Files, git history, CLAUDE.md, and session transcripts persist. Anyone (the agent or user) can open the folder later and continue interactively.

---

## Architecture Overview

Three layers, clean separation of concerns:

```
                         PLUGIN LAYER
    ┌─────────────────────────────────────────────────┐
    │  Channel Plugins        Tool Plugins             │
    │  ├── WhatsApp           ├── GitHub               │
    │  ├── Email (MS365)      ├── Calendar             │
    │  └── (user adds more)   └── (user adds more)     │
    └─────────────────────┬───────────────────────────┘
                          │
                   CORE FRAMEWORK
    ┌─────────────────────▼───────────────────────────┐
    │                                                  │
    │  Event Loop ─── receives events, enriches,       │
    │       │         routes to brain                   │
    │       │                                          │
    │  Agent Brain (Agent SDK) ─── persistent session  │
    │       │   │       with personality, tools, hooks  │
    │       │   │                                      │
    │       │   ├── Memory System ─── graph + daily    │
    │       │   │                     summaries + RAG   │
    │       │   ├── Skill System ─── markdown skills   │
    │       │   │                     at 3 levels       │
    │       │   └── Hook System ──── safety, audit,    │
    │       │                         notifications     │
    │       │                                          │
    │  Task System ─── folder-based (inbox/projects/   │
    │       │          ongoing), spawns Claude Code     │
    │       │                                          │
    │  Dashboard ─── Alpine.js + Fastify, reads        │
    │                filesystem + APIs                  │
    └─────────────────────────────────────────────────┘
                          │
                   PROJECT LAYER
    ┌─────────────────────▼───────────────────────────┐
    │  /home/nina/                                     │
    │  ├── inbox/        Ad-hoc tasks                  │
    │  ├── projects/     Multi-phase project work      │
    │  └── ongoing/      Recurring routines            │
    │                                                  │
    │  Each folder = CLAUDE.md + task.md + files       │
    │  Each folder = resumable Claude Code session     │
    └─────────────────────────────────────────────────┘
```

---

## Core Framework Components

### 1. Event Loop / Orchestrator

The event loop is the system's entry point. It receives events from all sources and routes them to the agent's brain.

**Events:**

- Channel message (WhatsApp, Email, etc.) via webhook
- Cron tick (heartbeat, scheduled routines)
- File change (task.md updated externally)
- Dashboard action (approve, message, control)
- Session completion (Claude Code finished a project task)

**Responsibilities:**

1. **RECEIVE** — webhook/cron/watcher triggers an event
2. **CHECK TRUST TIER** — resolve sender identity, check against trust config
   - Untrusted → auto-acknowledge, escalate to user, skip brain
   - Known/Full → proceed to enrichment
3. **ENRICH** — extract entity mentions, query graph memory, inject context
4. **ROUTE** — pass enriched event to the agent's brain (with trust tier attached)
5. **QUEUE** — ensure events are processed sequentially (no race conditions)

**Auto-enrichment pipeline** (runs before brain sees the message):

- Extract entity mentions via string matching against known graph entities
- Query graph for matched entities (relationships, recent interactions)
- Inject concise context (~200-500 tokens) into the message
- Cost: ~$0 (local string matching + local DB query)

**Technology:** Node.js/TypeScript, single process. Could be Fastify for webhooks + a scheduler for cron.

### 2. Agent Brain (Agent SDK)

A long-running Agent SDK session that IS the agent. It has:

- **Personality** — loaded from CLAUDE.md / system prompt
- **Core memory** — always loaded (identity, contacts, procedures, preferences)
- **Daily summaries** — last 7 days in system prompt
- **MCP tools** — memory, channels, project management
- **Hooks** — safety guards, audit logging, notifications
- **Skills** — brain-level skills (email management, customer support, etc.)

**Session persistence:**

- The brain is a persistent session that maintains conversation history
- Auto-compresses when approaching context limits
- If process restarts, resumes from disk
- For long time gaps, folder state (task.md) rescues context

**The brain handles:**

- Quick replies (ad-hoc tasks) — inline, no project folder needed
- Task classification — ad-hoc vs project vs ongoing
- Project spawning — creates folders, writes CLAUDE.md, runs `claude` CLI

**Autonomy enforcement:**
The brain checks autonomy mode before executing actions. Enforcement happens at the tool level:

- MCP tools (send_email, send_whatsapp) check autonomy mode before executing
- NotificationService respects autonomy when sessions call notify/escalate
- Claude Code sessions inherit autonomy mode from task.md
- Channel routing — responds via the correct channel
- Memory management — saves insights, updates contacts, creates summaries
- Heartbeat logic — periodic check-ins, proactive notifications

**Context isolation:** For complex ad-hoc tasks, the brain can delegate to subagents to avoid polluting its own context with execution details. Subagents run within the same session, report back, and are cleaned up — keeping the agent's context lean and focused on coordination.

### 3. Task System (Folder-Based)

Every task gets a folder. Three types:

**Ad-hoc (inbox/)**

```
/home/nina/inbox/2026-02-12-check-server-status/
├── CLAUDE.md     # Task context: "Check production server health"
└── task.md       # Status: Complete. Result: "Server up, 230ms response."
```

- Created and handled by the agent's brain directly (or via subagent for complex tasks)
- Short-lived, archived after completion
- May or may not spawn a Claude Code session

**Projects (projects/)**

```
/home/nina/projects/2026-02-12-projectx-login-bug/
├── CLAUDE.md     # Full context: who reported, what repo, constraints
├── task.md       # Phase: executing. Sprint 1 of 2. Status: awaiting review.
├── plan.md       # The approved implementation plan
├── .claude/
│   ├── settings.json   # MCP servers, allowed tools for this project
│   └── skills/         # Project-specific skills (debugging, code-review)
└── src/                # Working files (cloned repo, etc.)
```

- Multi-phase: ideate → plan → execute → complete
- Claude Code sessions run here (resumable via `--continue`)
- Hanan can open in VS Code at any time

**Ongoing (ongoing/)**

```
/home/nina/ongoing/email-management/
├── CLAUDE.md     # The PROCEDURE: "Check inbox every 2h, triage, draft..."
├── task.md       # Schedule: every 2h. Autonomy: 5. Last run: 14:00.
└── logs/
    ├── 2026-02-12-08h.md   # "Processed 3 emails. Flagged 1 urgent."
    ├── 2026-02-12-10h.md
    └── ...
```

- Recurring, triggered by cron schedule
- Each execution creates a log entry
- Procedure defined via a project first ("Ongoing = Project + Routine" per VISION.md)

### 4. Memory System

Three layers of memory:

**Layer 1: Core Memory (always loaded, ~zero retrieval cost)**

```
/home/nina/brain/memory/
├── identity.md        # Personality, voice, boundaries
├── contacts.md        # Key people with roles and preferences
├── procedures.md      # Standard operating procedures
├── preferences.md     # Hanan's preferences
└── learnings.md       # Cross-project learnings
```

Loaded into system prompt. Small, curated, high-value.

**Layer 2: Daily Summaries (proven pattern from OpenClaw)**

```
/home/nina/brain/memory/daily/
├── 2026-02-12.md      # End-of-day summary
├── 2026-02-11.md
└── ...
```

- Created during evening heartbeat
- Last 7 days loaded in system prompt
- Older ones searchable via memory tools
- Provides temporal context

**Layer 3: Graph Memory (structural relationships, searchable)**

Database: Start with Anthropic MCP Memory Server (MVP), upgrade to Mem0 or Graphiti + Memgraph later.

Entities: people, organizations, projects, tools, concepts
Relations: works_at, uses, depends_on, contacted, decided
Observations: timestamped facts attached to entities

**MCP tools exposed to brain and project sessions:**

- `search_memory(query)` — semantic search across all memory
- `save_insight(topic, content)` — store a learning or pattern
- `get_contact(name)` — retrieve contact info + interaction history
- `get_project_summary(name)` — retrieve completed project summary

**Auto-enrichment (before messages reach the brain):**

1. String match message against known entity names in graph
2. Query graph for matched entities (concise summaries)
3. Inject as context (~200-500 tokens)
4. Brain gets enriched message, no manual search needed

**Entity disambiguation:** Multiple matches → inject all, let Claude's reasoning pick the right one. New entity not in graph → enrichment returns nothing, brain creates new entity if appropriate.

**Progressive upgrade path:**

- Phase 1: Anthropic MCP Memory Server (file-based, zero infra)
- Phase 2: Mem0 with graph memory (auto entity extraction)
- Phase 3: Graphiti + Memgraph (temporal reasoning, high performance)

### 5. Skill System

Skills are markdown files that give the agent specialized capabilities. Same format as Claude Code skills.

**Three levels:**

1. **Brain skills** — always available to the agent's brain

   ```
   /home/nina/brain/.claude/skills/
   ├── email-management/SKILL.md
   ├── customer-support/SKILL.md
   └── task-triage/SKILL.md
   ```

2. **Project skills** — per-project, assigned when creating the folder

   ```
   /home/nina/projects/login-bug/.claude/skills/
   ├── debugging/SKILL.md
   └── code-review/SKILL.md
   ```

   The agent's brain selects relevant skills when creating a project folder.

3. **Framework skills** — shipped with the framework (generic)
   ```
   /framework/skills/
   ├── task-management/SKILL.md
   ├── memory-management/SKILL.md
   └── communication/SKILL.md
   ```

Users can create custom skills, share them, or override framework defaults.

### 6. Hook System

Hooks run at lifecycle points for safety, audit, and control.

**Brain hooks (event loop level):**

- PreMessage: validate incoming messages, rate limiting
- PostMessage: audit log, update daily summary data
- OnError: escalate to Hanan, save state

**Project hooks (Claude Code level, per-folder .claude/hooks.json):**

- PreToolUse (Bash): block destructive commands (rm -rf, git push --force)
- PreToolUse (Write): prevent writing to paths outside project folder
- PostToolUse: log all actions for audit trail
- Stop: update task.md with final state, notify brain

**Safety defaults (always on):**

- Block destructive filesystem operations
- Block outbound network calls to unknown hosts
- Require review for git push, deploy commands
- Log all Bash commands to audit file

### 7. Communication Between Brain and Project Sessions

Project sessions communicate back via **NotificationService** available in each project:

**Methods provided:**
| Method | Behavior |
|---|---|
| `notify(message)` | Fire-and-forget status update. Session continues. |
| `request_review(plan)` | Saves state to task.md, notifies brain/Hanan, exits cleanly. |
| `escalate(problem)` | Urgent notification. Saves state, exits. |
| `ask_quick(question)` | Blocks briefly (30-min timeout). For quick decisions. |

**Resume flow (after review/escalation):**

1. Project session exits cleanly, state saved in task.md
2. Hanan approves (via WhatsApp, dashboard, or opening folder in VS Code)
3. If via channel/dashboard: brain spawns `claude --continue --cwd /project/folder/ -p "Approved with feedback: ..."`
4. If via VS Code: Hanan interacts directly, session resumes interactively
5. Both work — the folder is the state, not the process

### 8. Dashboard

Alpine.js + Fastify + Tailwind. Built in phases — chat first (M2), then operations dashboard (later milestones).

**Phase 1: Chat UI (M2)**

The primary interface for talking to the agent. Serves as both the hatching wizard (first-run setup) and the ongoing chat interface.

```
Fastify server (packages/dashboard/):
  Static files:   Alpine.js SPA (public/)
  REST:           /api/hatching/* (setup wizard steps)
  REST:           /api/uploads (file attachments)
  WebSocket:      /api/chat/ws (streaming chat)
```

**Chat features (reference: OpenClaw dashboard):**

- Real-time token streaming with delta-based rendering
- Thinking blocks — auto-expand during thinking, auto-collapse on response, toggle
- Markdown rendering (GFM: code blocks, tables, links, images)
- File uploads (drag-drop, paste, click) with preview strip
- Slash command autocomplete — typing `/` shows available commands
- Tool-based interactive UI — agent can present selects, multi-selects, text inputs
- Dark theme, responsive layout

**Phase 2: Operations Dashboard (future)**

```
Fastify API (additional routes):
  GET /api/tasks         → scans inbox/, projects/, ongoing/
  GET /api/task/:folder  → reads CLAUDE.md + task.md
  GET /api/sessions/:id  → lists Claude Code sessions in folder
  GET /api/memory/graph  → queries graph DB
  GET /api/memory/daily  → reads daily summary files
  POST /api/approve/:id  → sends approval to event loop
  WebSocket /ws          → real-time updates via file watchers
```

**Operations dashboard shows:**

- Task browser: inbox/projects/ongoing with live status
- Project detail: CLAUDE.md, task.md, session history, approve/reject buttons
- Memory viewer: graph visualization, contacts, daily summaries
- Settings: auth profiles, model config, channel management
- Controls: pause/resume ongoing tasks, approve reviews
- "Open in VS Code" deep links for any project folder

### 9. Authentication

Supports both Claude subscriptions (Pro/Max) and API keys. Inspired by OpenClaw's auth UX.

**Auth sources (resolution order):**

1. **Environment variables** — `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (always wins)
2. **Central auth file** — `.my_agent/auth.json` (persistent, managed via hatching/dashboard)
3. **Error with guidance** — if neither found, guides user through setup

**Supported methods:**

| Method      | Token Prefix       | Source                                              | Billing                      |
| ----------- | ------------------ | --------------------------------------------------- | ---------------------------- |
| API Key     | `sk-ant-...`       | [Anthropic Console](https://console.anthropic.com/) | Pay-per-use                  |
| Setup-Token | `sk-ant-oat01-...` | `claude setup-token` CLI command                    | Subscription quota (Pro/Max) |

**Central auth file** (`.my_agent/auth.json`):

```json
{
  "version": 1,
  "activeProfile": "default",
  "profiles": {
    "default": {
      "provider": "anthropic",
      "method": "setup_token",
      "token": "sk-ant-oat01-..."
    }
  }
}
```

This file lives in `.my_agent/` (gitignored from framework repo, committed to private brain repo). Multiple profiles support future multi-provider or failover scenarios.

**Hatching flow (auth step):**

1. Check for existing env vars → if found, confirm and skip
2. Ask: "API key (pay-per-use) or Claude subscription (Pro/Max)?"
3. **Subscription path:** Guide user to run `claude setup-token`, validate prefix (`sk-ant-oat01-`) and length (80+ chars)
4. **API key path:** Prompt for key, detect env var if present
5. Store in `.my_agent/auth.json`, set as active profile
6. Verify auth works (test API call)

**Runtime resolution** (`resolveAuth()`):

```typescript
// 1. Env var override
if (process.env.ANTHROPIC_API_KEY) return { type: "api_key", source: "env" };
if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
  return { type: "setup_token", source: "env" };

// 2. Auth file
const auth = readAuthFile(agentDir);
if (auth?.activeProfile) return auth.profiles[auth.activeProfile];

// 3. Guide user
throw new AuthNotConfiguredError("Run /my-agent:auth to set up authentication");
```

**Dashboard integration (future):** Settings page for managing auth profiles — add/remove keys, switch active profile, test connection, view usage.

### 10. First-Run Setup (Hatching)

Modular onboarding that runs on first launch. Each step implements the `HatchingStep` interface and doubles as a standalone `/my-agent:*` command for re-configuration anytime.

**Architecture:**

```typescript
interface HatchingStep {
  name: string; // Used as command: /my-agent:{name}
  description: string; // Shown in help and hatching flow
  required: boolean; // Must complete during hatching?
  run(rl: readline.Interface, agentDir: string): Promise<void>;
}
```

**Steps:**

| Step            | Required | Command                     | What It Does                             |
| --------------- | -------- | --------------------------- | ---------------------------------------- |
| Identity        | Yes      | `/my-agent:identity`        | Name, purpose, key contacts              |
| Personality     | Yes      | `/my-agent:personality`     | Choose from 7 archetypes or write custom |
| Auth            | Yes      | `/my-agent:auth`            | API key or subscription setup            |
| Operating Rules | No       | `/my-agent:operating-rules` | Autonomy level, escalation rules, style  |

**Interfaces:**

- **CLI (M1):** readline-based sequential prompts. Functional, used as dev fallback.
- **Web (M2):** Browser-based wizard with rich form components (dropdowns, cards, validation). REST-based: `GET /api/hatching/step/:name` returns field metadata, `POST` submits data. Step logic is shared between CLI and web via extracted pure functions.

**Flow:**

1. First visit (web) or first run (CLI) → hatching wizard
2. Required steps run in sequence
3. Optional steps offered (complete now or later via `/my-agent:*` commands)
4. Writes `.hatched` marker — subsequent visits skip hatching

**Extensibility:** Future milestones add steps (channels, memory backends, etc.) by implementing `HatchingStep`. Steps auto-discover from the skills directory.

---

## Plugin System

### Channel Plugin Interface

A channel plugin provides:

1. **Inbound adapter** — webhook endpoint or polling mechanism for receiving messages
2. **Outbound tools** — MCP tools for sending messages (send_text, send_media, etc.)
3. **Auth flow** — how to set up credentials
4. **Configuration schema** — what config the plugin needs

```typescript
interface ChannelPlugin {
  id: string; // "whatsapp", "email-ms365", "telegram"
  name: string; // Human-readable name

  // Webhook registration
  registerWebhook(app: FastifyInstance): void;

  // MCP server definition
  mcpTools: MCPToolDefinition[]; // Tools exposed to the brain

  // Auth
  setupAuth(config: any): Promise<void>;

  // Config schema
  configSchema: ZodSchema;
}
```

### First-Party Plugins

**channel-whatsapp** — Baileys (WhatsApp Web), QR auth, WebSocket monitoring
**channel-email-ms365** — Microsoft Graph API, OAuth 2.0, webhook + polling

Both based on existing OpenClaw implementations. Same libraries, same auth, different wrapping.

### User Configuration

```yaml
# config.yaml
auth:
  file: ./auth.json # Central auth file (managed by hatching/dashboard)
  # Env vars ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN override auth.json

brain:
  model: claude-sonnet-4-5
  personality: ./brain/CLAUDE.md
  skills: ./brain/skills/
  memory:
    daily: ./brain/memory/daily/
    core: ./brain/memory/core/
    graph:
      backend: mcp-memory-server # or "mem0" or "graphiti"

channels:
  - plugin: channel-whatsapp
    config:
      authDir: ./auth/whatsapp
      dmPolicy: allowlist
      allowFrom: ["+1555000000"]

  - plugin: channel-email-ms365
    config:
      clientId: "${MS365_CLIENT_ID}"
      tenantId: "${MS365_TENANT_ID}"
      userEmail: "agent@example.com"
      dmPolicy: allowlist
      allowFrom: ["hanan@example.com.com"]

heartbeat:
  interval: 15m
  prompt: "Check active tasks, pending reviews, and proactive opportunities."

tasks:
  inbox: ./inbox/
  projects: ./projects/
  ongoing: ./ongoing/

dashboard:
  port: 3456
```

---

## Key Flows

### Flow 1: WhatsApp Message → Quick Reply

```
1. WhatsApp webhook → event loop
2. Event loop: extract entities → query graph → enrich message
3. Pass to brain: "[Context: Sarah Chen, CTO TechCorp...] Hanan: send Sarah the pricing"
4. Brain: classifies as ad-hoc, handles inline
   → search_memory("TechCorp pricing") → finds past quote
   → Drafts email, asks for approval
5. Brain → WhatsApp: "Ready to send Sarah the updated pricing ($5.5K/mo). Approve?"
6. Hanan: "Yes"
7. Brain → Email: sends to sarah@techcorp.com
8. Brain → WhatsApp: "Sent!"
9. Brain: creates /inbox/2026-02-12-techcorp-pricing/ with task.md (complete)
```

### Flow 2: Project Creation → Execution → Resume

```
1. Hanan on WhatsApp: "Customer found a login bug in ProjectX"
2. Brain classifies: project (needs investigation + fix)
3. Brain creates folder:
   /projects/2026-02-12-projectx-login-bug/
   ├── CLAUDE.md    (task context, customer info from memory, repo URL)
   ├── task.md      (status: investigating, phase: ideation)
   └── .claude/     (skills: debugging, code-review; hooks: safety)
4. Brain spawns: claude --cwd /projects/.../login-bug/ -p "Investigate the login bug. Details in CLAUDE.md."
5. Claude Code investigates, reproduces, writes findings to task.md
6. Session calls: request_review("Root cause found. Plan: refactor auth module.")
   → Saves state, notifies brain, exits
7. Brain → WhatsApp: "Found the bug. Auth module needs refactoring. Approve plan?"
8. Hanan: "Go ahead, but don't touch SSO"
9. Brain spawns: claude --continue --cwd /projects/.../login-bug/ -p "Approved. Constraint: don't touch SSO."
10. Claude Code implements fix, creates commits, updates task.md: complete
11. Brain → WhatsApp: "Login bug fixed. PR ready for review."

12. A WEEK LATER: Hanan opens /projects/2026-02-12-projectx-login-bug/ in VS Code
    → Full context available (CLAUDE.md, task.md, git history, session transcript)
    → "Also fix the forgot-password flow, same pattern"
    → Claude Code continues with complete context
```

### Flow 3: Ongoing Task Setup and Execution

```
1. User: "Take over our email management"
2. Brain: classifies as ongoing (needs procedure definition first)
3. Brain creates PROJECT first:
   /projects/2026-02-12-email-management-setup/
   → Ideation: What does email management mean? What accounts? What rules?
   → Planning: Document the procedure, define schedule
   → Output: procedure document
4. Brain creates ONGOING folder:
   /ongoing/email-management/
   ├── CLAUDE.md     # Procedure from the project
   ├── task.md       # Schedule: every 2h, autonomy: 5
   └── logs/
5. Event loop registers cron: every 2h
6. Every 2h:
   → Cron fires → event loop → brain
   → Brain reads /ongoing/email-management/CLAUDE.md
   → Brain checks email (via Email MCP tool)
   → Brain triages, drafts replies, flags urgent
   → Brain writes log: /ongoing/email-management/logs/2026-02-12-14h.md
   → If urgent: Brain → WhatsApp to Hanan immediately
```

### Flow 4: Heartbeat

```
1. Cron fires every 15 minutes
2. Event loop → brain: "Run heartbeat check"
3. Brain:
   → Scan active tasks (projects/ with status != complete)
   → Check pending reviews (any task.md with AWAITING_REVIEW)
   → Check ongoing routines (any overdue?)
   → Check for proactive opportunities (birthdays, follow-ups, deadlines)
4. If anything needs attention:
   → WhatsApp to Hanan: "3 items: login-bug awaiting review, email routine overdue, Sarah's birthday tomorrow"
5. If nothing: silent (no spam)
6. End of day: write daily summary to /brain/memory/daily/2026-02-12.md
```

---

## Deployment

### Platform: WSL (Recommended)

**Why WSL over Windows:**

- Claude Code and Agent SDK are designed for Unix environments
- Bash tool works natively (no PowerShell translation)
- Systemd for service management
- File watchers work reliably
- Git and Node.js tooling is native

**Process management:**

```
systemctl --user enable nina-brain     # Brain + event loop
systemctl --user enable nina-dashboard # Dashboard
```

**Resources:**

- CPU: 1 vCPU (idle most of the time, bursts during work)
- RAM: ~500MB (Node.js process + in-memory caches)
- Disk: grows with projects (git repos, logs, memory DB)
- Network: outbound HTTPS to api.anthropic.com + channel APIs

### Secrets Management

**Two locations for secrets:**

```
.my_agent/auth.json              # Anthropic auth (API key or subscription token)
                                 # Managed via hatching, /my-agent:auth, or dashboard

.my_agent/.env (or systemd EnvironmentFile)
├── ANTHROPIC_API_KEY            # Override: takes precedence over auth.json
├── CLAUDE_CODE_OAUTH_TOKEN      # Override: subscription token from env
├── MS365_CLIENT_ID              # Channel plugin secrets
├── MS365_CLIENT_SECRET
├── MS365_REFRESH_TOKEN
├── GITHUB_TOKEN
└── (other service keys)
```

**Separation of concerns:**

- **Anthropic auth** → `auth.json` (managed by framework, editable via dashboard)
- **Service secrets** → `.env` file (channel plugins, external APIs)
- **Env vars** → always override file-based config (for CI, containers, systemd)

---

## Migration from OpenClaw

### What Carries Over

| Asset                                 | Status                                   |
| ------------------------------------- | ---------------------------------------- |
| WhatsApp auth (Baileys session)       | Keep auth directory, same library        |
| Email auth (MS365 OAuth tokens)       | Keep tokens, same Graph API client       |
| Dashboard code (Alpine.js + Tailwind) | Adapt to new API, keep styling           |
| Model eval tool                       | Independent, no changes needed           |
| MEMORY.md content                     | Migrate to brain/memory/core/ files      |
| Daily summaries                       | Copy to brain/memory/daily/              |
| Skills                                | Copy SKILL.md files to brain/skills/     |
| VISION.md and roadmap                 | Reference documents, no migration needed |

### What Gets Replaced

| OpenClaw Component                   | Replaced By                           |
| ------------------------------------ | ------------------------------------- |
| Gateway (Fastify WebSocket)          | Event loop + Dashboard Fastify        |
| Channel plugin system                | Channel MCP plugins                   |
| Agent runtime                        | Claude Agent SDK                      |
| Session management                   | Folder-based + Claude Code sessions   |
| Memory indexer (SQLite + embeddings) | Graph memory MCP server               |
| Heartbeat runner                     | Cron in event loop                    |
| Hook system                          | Agent SDK hooks + Claude Code hooks   |
| Skill loader                         | Agent SDK skill loading (same format) |

### Migration Steps

1. Set up the new system alongside OpenClaw (both can run)
2. Migrate WhatsApp auth (copy Baileys auth directory)
3. Migrate Email auth (copy OAuth tokens)
4. Migrate memory (core files + daily summaries)
5. Migrate skills (copy SKILL.md files)
6. Test: verify channels work in new system
7. Switch: point webhook URLs to new system
8. Decommission OpenClaw

---

## Project Structure

**Single folder: `/home/nina/my_agent/`**
Public framework repo + `.my_agent/` private personality (gitignored, committed to separate repo).

```
/home/nina/my_agent/                    ← PUBLIC REPO (framework)
├── packages/
│   ├── core/                           # Event loop, task system, plugin interface
│   ├── dashboard/                      # Operations console (Alpine.js + Fastify)
│   ├── memory/                         # Memory system (graph + daily summaries)
│   └── hooks/                          # Safety hooks, audit logging
├── plugins/
│   ├── channel-whatsapp/               # WhatsApp via Baileys
│   ├── channel-email-ms365/            # Email via Microsoft Graph
│   └── ...
├── skills/                             # Framework skills (generic)
├── docs/
│   └── design.md                       # This design document
├── examples/
│   └── basic-assistant/                # Minimal setup guide
├── .gitignore                          # Ignores .my_agent/
├── CLAUDE.md                           # Framework dev instructions
└── README.md
│
└── .my_agent/                          ← PRIVATE REPO (agent personality)
    ├── brain/
    │   ├── CLAUDE.md                   # Agent's personality + system prompt
    │   ├── memory/
    │   │   ├── core/                   # identity.md, contacts.md, procedures.md
    │   │   └── daily/                  # End-of-day summaries
    │   └── skills/                     # Agent-specific skills
    ├── auth.json                       # Anthropic auth (API key or subscription token)
    ├── inbox/                          # Ad-hoc tasks
    ├── projects/                       # Multi-phase project work
    ├── ongoing/                        # Recurring routines
    ├── config.yaml                     # Channel config, schedule, plugins
    └── .env                            # Service API keys (MS365, GitHub, etc.)
```

---

## What This Achieves (Mapping to VISION.md)

| Vision Requirement        | How It's Addressed                                                             |
| ------------------------- | ------------------------------------------------------------------------------ |
| Part 1: Identity          | CLAUDE.md personality, core memory files                                       |
| Part 2: Task System       | Folder-based: inbox/projects/ongoing with phases                               |
| Part 3: Autonomy & Bounds | Hook system + permissionMode + task metadata                                   |
| Part 4: Observability     | task.md IS the source of truth. Folders are transparent.                       |
| Part 5: Course Correction | Open folder in VS Code = full control. Approve/reject from dashboard/WhatsApp. |
| Part 6: Cost Control      | API spending limits, model routing, Ollama degraded mode                       |
| Part 7: External Comms    | Channel plugins with trust tiers in hooks                                      |
| Part 8: Growth            | Agent modifies its own skills, memory, procedures                              |
| Part 9: Pain Points       | ALL addressed (observability, session resume, phase discipline, pause/resume)  |
| Part 10: Architecture     | Clean, extensible, built on tools Hanan already uses daily                     |

---

## Milestones

> **Source of truth:** [`ROADMAP.md`](ROADMAP.md) — sprint breakdowns, status, dependencies.
>
> **Design specs:** See `design/` folder for detailed architecture.

### M1: Foundation (CLI) — COMPLETE

Personality + memory running in `.my_agent/`. Speak via CLI REPL.

- First-run hatching: identity, personality, auth, operating rules (modular `HatchingStep` system)
- Auth: supports both API keys and Claude subscriptions via `auth.json` + env var override
- Agent SDK brain running in `.my_agent/` with personality from `brain/CLAUDE.md`
- System prompt assembled from brain files + skills (auto-discovered)
- `/my-agent:*` commands for re-configuring any hatching step anytime

### M2: Web UI

Replace CLI with a browser-based interface. Chat + hatching wizard.

- Fastify server serving Alpine.js + Tailwind SPA (`packages/dashboard/`)
- Web-based hatching wizard (replaces CLI readline prompts)
- Chat interface with real-time streaming, thinking blocks, markdown rendering
- File uploads (drag-drop, paste, click)
- Slash command autocomplete (typing `/` shows available commands)
- Tool-based interactive UI (agent presents selects, multi-selects to user)
- Design reference: OpenClaw dashboard (visual design + feature patterns)
- Verification: fresh start → browser shows wizard → complete setup → chat works with streaming

### M3: WhatsApp Channel

First external channel plugin with **dedicated role** (agent owns the identity).

- WhatsApp MCP plugin (Baileys, reuse existing auth)
- Immediate processing: message arrives → agent responds
- Escalation policies for autonomous communication
- Event loop receives webhook, passes to brain
- Brain responds via WhatsApp MCP tool
- Verification: send WhatsApp message, get agent response

### M4a: Task System

Folder creation, Claude Code spawning, task lifecycle, **scheduled tasks**.

- Task classification (ad-hoc / project / ongoing)
- Folder creation with CLAUDE.md + task.md + .claude/ setup
- Claude Code session spawning via `claude` CLI
- NotificationService (notify, request_review, escalate)
- Resume flow (`claude --continue` on approval)
- **Scheduled tasks**: cron-based recurring work (e.g., "summarize my inbox every morning")
- Verification: send "fix a bug in X" → project folder created → Claude Code works → requests review → approve → completes

**After M4a: The agent can develop itself.** Later milestones become the agent's own projects.

### M4b: Memory

Graph memory, daily summaries, auto-enrichment.

- Anthropic MCP Memory Server integration (entities, relations, observations)
- Auto-enrichment pipeline (entity extraction → graph query → context injection)
- Daily summary generation
- Ongoing task support (procedure folders + execution logs)
- Verification: agent remembers cross-project context

### M5: Operations Dashboard

Expand the web UI with task management, memory viewer, and settings.

- Task browser: inbox/projects/ongoing with live status
- Project detail: CLAUDE.md, task.md, approve/reject, session history
- Memory viewer, daily summaries
- Settings: auth profiles, model config, channels
- "Open in VS Code" deep links
- Ideally the agent builds this itself with review

### M6: Email Channel

Email channel plugin with **both roles** (dedicated + personal).

- Microsoft Graph MCP plugin (reuse graph-client.ts from OpenClaw)
- **Dedicated role**: agent's own email (info@company.com), immediate processing
- **Personal role**: user's email (user@company.com), on-demand processing only
- OAuth 2.0 auth flow
- Webhook for inbound (dedicated), on-demand reads (personal)
- Send/reply/thread for outbound
- Migrate from OpenClaw (swap tokens)

---

_Design document created: 2026-02-12_
_Updated: 2026-02-14 — Channel architecture, milestone clarifications_
