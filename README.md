# my_agent

**A fully autonomous AI agent that runs on your machine, manages its own work, and talks to you wherever you are.**

my_agent is not a chatbot wrapper. It's a framework for building a persistent, self-managing AI agent on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — the same engine that powers Claude Code. Give it a VPS, an API key, and a personality. It handles the rest.

---

## What Makes This Different

### It's an agent, not an assistant

my_agent doesn't wait for your prompts. It runs continuously on its own machine — triaging messages, executing tasks, managing a calendar, remembering conversations, and reporting back when work is done. You interact through WhatsApp or a web dashboard. It interacts with the world.

### Token-smart by design

Most agent frameworks burn Opus tokens on everything. my_agent routes intelligently across Claude's model family:

| Task | Model | Why |
|------|-------|-----|
| Triage, classification, extraction | **Haiku** | Fast, cheap, perfect for structured decisions |
| Task execution, code, research | **Sonnet** | Best cost/capability ratio for real work |
| Planning, review, complex reasoning | **Opus** | Full power only when it matters |

Skills can declare per-phase model preferences — Opus for planning and review, Sonnet for execution. Background queries (naming conversations, extracting entities, scheduling decisions) default to Haiku. The conversation brain runs on whatever model the user picks. The result: OpenClaw-class capabilities at a fraction of the token cost.

### Transparent underwork

When my_agent works, you see what's happening. Tasks are extracted from conversations and tracked as first-class entities with status, phases, and execution logs. Automations run on predictable cron schedules. Jobs report results back to your chat. No black-box "thinking..." spinners — every piece of autonomous work is inspectable, resumable, and auditable.

### Talk to it where you already are

The agent lives on a server. You talk to it from:

- **Web Dashboard** — full-featured UI with chat, task management, calendar, notebook, notifications
- **WhatsApp** — message your agent like a contact. It triages, responds, and works autonomously
- **More coming** — Email (MS365), Discord, and a native iOS app are on the roadmap

### Built on Claude, period

No model-agnostic abstraction tax. my_agent is built exclusively on Claude — the most capable LLM for agentic work — using Anthropic's own Agent SDK. This means native tool use, extended thinking, session persistence, context compression, and subagent spawning. No adapter layers, no lowest-common-denominator APIs. If Claude can do it, my_agent can use it.

---

## Architecture

```
                         PLUGIN LAYER
    ┌─────────────────────────────────────────────────┐
    │  Channel Plugins        Tool Plugins             │
    │  ├── WhatsApp           ├── Calendar (CalDAV)    │
    │  ├── Email (planned)    ├── Desktop Control      │
    │  └── Discord (planned)  └── Playwright           │
    └─────────────────────┬───────────────────────────┘
                          │
                   CORE FRAMEWORK
    ┌─────────────────────▼───────────────────────────┐
    │                                                  │
    │  Event Loop ─── receives events, enriches,       │
    │       │         routes to brain                   │
    │       │                                          │
    │  Conversation Agent ─── persistent brain session │
    │       │   │    personality, memory, triage        │
    │       │   ├── Memory ─── graph + summaries + RAG │
    │       │   ├── Skills ─── markdown at 3 levels    │
    │       │   └── Hooks ──── safety + audit          │
    │       │                                          │
    │  Working Agents ─── spawned per task, isolated    │
    │       │    folders, model-appropriate execution   │
    │       │                                          │
    │  Spaces & Automations ─── cron jobs, triggers,   │
    │       │                    predictable schedules  │
    │       │                                          │
    │  Dashboard ─── Alpine.js + Fastify web UI        │
    └─────────────────────────────────────────────────┘
```

### Two-Agent Architecture

**Conversation Agent** — the personality layer. Persistent session with full memory. Receives messages from all channels, triages, responds, delegates. This is who the user talks to.

**Working Agents** — task executors. Spawned on demand with the right model for the job. Each gets an isolated folder and runs as a Claude Code session. Reports results back to the conversation agent, which presents them naturally.

### Markdown is Source of Truth

Job definitions, facts, configuration, and operational state live in markdown files. SQLite stores run history, search indexes, and caches. Delete the database — the system rebuilds from markdown. Delete markdown — data is lost.

---

## Features

| Feature | Description |
|---------|-------------|
| **Persistent Brain** | Long-running Agent SDK session with personality, memory, and tools. Survives restarts via native session resumption. |
| **Intelligent Model Routing** | Haiku for triage, Sonnet for execution, Opus for planning. Per-task and per-phase overrides. |
| **Folder-Based Tasks** | Every task = a folder with `CLAUDE.md` + `task.md`. Resumable, inspectable, auditable. |
| **Multi-Channel** | WhatsApp (live), Web Dashboard (live). Email, Discord, iOS coming soon. |
| **Graph Memory** | Entity extraction, relationship tracking, daily summaries, semantic search with local embeddings (Ollama). |
| **Spaces & Automations** | Scoped workspaces with cron-triggered jobs. Predictable schedules, transparent execution. |
| **Calendar Integration** | CalDAV (Radicale), scheduled tasks, event dispatch — the agent manages its own schedule. |
| **Visual Pipeline** | Screenshot capture, visual analysis, Playwright browser control, desktop automation (Linux). |
| **Hatching System** | Guided personality creation — name, voice, boundaries, autonomy level. Your agent, your rules. |
| **Safety Hooks** | Pre/post tool-use hooks, audit logging, trust tiers per contact, guardrail enforcement. |
| **Headless Mode** | Run the full agent without HTTP — for testing, CI, or embedding in other systems. |

---

## Quick Start

### Prerequisites

- Node.js 22+
- An [Anthropic API key](https://console.anthropic.com/)
- A Linux machine (your own, a VPS, or a Raspberry Pi)

### Install

```bash
git clone https://github.com/okets/my_agent.git
cd my_agent

# Install core
cd packages/core && npm install && cd ../..

# Install dashboard
cd packages/dashboard && npm install && cd ../..

# Install WhatsApp plugin (optional)
cd plugins/channel-whatsapp && npm install && cd ../..
```

### Configure

```bash
# Set your Anthropic API key
cp packages/dashboard/.env.example packages/dashboard/.env
# Edit .env and add your key
```

### Run

```bash
# Start the dashboard (web UI + agent brain)
cd packages/dashboard && npm run dev
```

Open `http://localhost:4321`. The hatching wizard walks you through creating your agent's personality on first launch.

To connect WhatsApp, pair via QR code in the settings panel. Your agent gets its own number.

---

## Project Structure

```
my_agent/
├── packages/
│   ├── core/              # Brain, auth, config, prompt assembly, model routing
│   └── dashboard/         # Web UI + API server (Fastify + Alpine.js)
├── plugins/
│   └── channel-whatsapp/  # WhatsApp channel via Baileys
├── skills/                # Framework-level skills
├── docs/                  # Design docs, architecture, 50+ sprint records
│
└── .my_agent/             # YOUR agent's private data (gitignored)
    ├── brain/             # Personality, voice, philosophy
    ├── notebook/          # Contacts, standing orders, preferences
    ├── inbox/             # Ad-hoc tasks
    ├── projects/          # Multi-phase project work
    ├── ongoing/           # Recurring routines
    └── config.yaml        # Channel config, model preferences, schedule
```

The framework is public. Your agent's personality, memory, and private data live in `.my_agent/` — fully separated and never committed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (TypeScript) |
| Agent Engine | [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) |
| Models | Claude Opus / Sonnet / Haiku (routed per task) |
| API Server | Fastify |
| Frontend | Alpine.js + Tailwind CSS (no build step) |
| Database | SQLite (better-sqlite3) + sqlite-vec |
| Memory | Graph memory + semantic search (Ollama / nomic-embed-text) |
| Calendar | Radicale (CalDAV) + tsdav + FullCalendar |
| WhatsApp | Baileys |
| Desktop | xdotool + scrot (Linux), Playwright |

---

## Project Status

**863 tests** across 50+ sprints. 8 milestones complete. Actively developing M8.

| Milestone | Status | Highlights |
|-----------|--------|------------|
| M1: Foundation | Done | Agent brain, hatching, auth, CLI REPL |
| M2: Web UI | Done | Dashboard, streaming chat, mobile-responsive layout |
| M3: WhatsApp | Done | Channel plugin system, Baileys, slash commands |
| M4: Notebook | Done | Persistent markdown notebook for the agent |
| M4.5: Calendar | Done | CalDAV, scheduled tasks, event dispatch |
| M5: Tasks | Done | Folder-based tasks, execution engine, live dashboard |
| M6: Memory | Done | Graph memory, daily summaries, semantic search, RAG |
| M6.5-M6.10 | Done | SDK alignment, two-agent refactor, lifecycle, knowledge, skills, headless app |
| M7: Spaces & Automations | Done | Scoped workspaces, cron jobs, automation pipelines |
| **M8: Visual & Desktop** | **Active** | Screenshot pipeline, desktop control, Playwright |

### Roadmap

| Milestone | What's coming |
|-----------|--------------|
| **M9: Channel SDK** | Transport abstraction, Email (MS365), Discord |
| **M10: External Comms** | Contact routing rules, approval flows for outbound messages |
| **M11: iOS App** | Native mobile app with full chat and push notifications |
| **M12: Hardening** | Auth, backup/restore, auto-update, macOS backend |
| **M13: Release** | Security audit, documentation, public launch |

---

## How Autonomous Work Stays Transparent

```
You (WhatsApp): "Check if the API is still throwing 500s on /users"

  ┌─ Conversation Agent (brain) ──────────────────────┐
  │  Triages → creates task → spawns working agent     │
  │  Model: Haiku (triage) → Sonnet (execution)        │
  └────────────────────────────────────────────────────┘
       │
       ▼
  ┌─ Working Agent (isolated folder) ─────────────────┐
  │  hits the API, analyzes response, writes findings  │
  │  Status visible in dashboard: "Running → Done"     │
  └────────────────────────────────────────────────────┘
       │
       ▼
You (WhatsApp): "Still 500ing. Stack trace points to a null
               user.org reference. Want me to look at the code?"
```

Every step is a file you can read. Every job has a schedule you can predict. Every result comes back through your channel.

---

## Development

```bash
# Run tests
cd packages/core && npm test
cd packages/dashboard && npm test

# Lint + format
cd packages/core && npm run lint && npm run format
cd packages/dashboard && npm run format
```

Design documents, architecture decisions, and sprint history: `docs/`

---

## Contributing

Active development. To get oriented, start with `docs/design.md`.

Areas where contributions are especially welcome:
- **Channel plugins** — Email, Discord, Telegram, Slack
- **Desktop backends** — macOS (Accessibility API), Wayland
- **Skills** — reusable markdown skills for common agent workflows

---

## License

MIT

---

Built exclusively on [Claude](https://claude.ai) by Anthropic. Powered by the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript).
