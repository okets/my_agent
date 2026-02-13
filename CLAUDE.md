# my_agent — Developer Guide

> **What:** A framework for building AI assistants on the Claude Agent SDK.
> **How:** Event loop + persistent brain + folder-based tasks + plugin channels.
> **Design:** See `docs/design.md` for the full architecture and rationale.

---

## Project Structure

```
my_agent/                           # PUBLIC REPO (framework)
├── packages/
│   ├── core/                       # Brain, auth, hatching, config, prompt assembly
│   ├── dashboard/                  # Web UI: chat + hatching wizard (Alpine.js + Fastify)
│   ├── memory/                     # Memory system (graph + daily summaries)
│   └── hooks/                      # Safety hooks, audit logging
├── plugins/
│   ├── channel-whatsapp/           # WhatsApp via Baileys
│   ├── channel-email-ms365/        # Email via Microsoft Graph
│   └── ...                         # Users add their own
├── skills/                         # Framework skills (generic)
├── docs/                           # Design docs, architecture
│
└── .my_agent/                      # PRIVATE (gitignored) — agent personality
    ├── brain/                      # Personality, memory, skills
    ├── inbox/                      # Ad-hoc tasks
    ├── projects/                   # Multi-phase projects
    ├── ongoing/                    # Recurring routines
    └── config.yaml                 # Channel config, schedule
```

## Privacy Guardrails

**This is a public repo.** Private data lives ONLY in `.my_agent/` (which is gitignored).

**Three layers of protection are active:**

1. **Git pre-commit hook** — scans staged files against `.guardrails` patterns. Blocks commits containing real names, phone numbers, API keys, or private paths.
2. **Claude Code PostToolUse hook** — checks every Write/Edit against the same patterns. Warns immediately if private data lands in a public file.
3. **This rule** — when writing code or docs in this repo:
   - Use generic examples: `user@example.com`, `+1555000000`, `"your-agent"`
   - Never hardcode real names, credentials, or private paths
   - Reference `.my_agent/` for anything instance-specific
   - Use environment variables (`${ANTHROPIC_API_KEY}`) not literal values
   - If you need to show a real flow, put it in `.my_agent/` not in framework code

**Pattern file:** `.guardrails` — add new patterns when new private data is introduced.

## Key Concepts

- **Folders as sessions** — every task gets a folder with CLAUDE.md + task.md. Resumable via Claude Code.
- **Brain** — long-running Agent SDK session. Receives channel messages, triages, spawns project work.
- **Plugins** — channel-agnostic. WhatsApp, Email, Telegram etc. are plugins, not core.
- **Skills** — markdown files at 3 levels: brain (always on), project (per-task), framework (generic).
- **Hooks** — safety guards + audit at event loop and per-project levels.

## References

| Document | Path | Purpose |
|----------|------|---------|
| Design doc | `docs/design.md` | Full architecture, flows, decisions |
| References | `.my_agent/docs/references.md` | OpenClaw source paths, vision docs, SDK links (private) |
| Agent SDK docs | https://platform.claude.com/docs/en/agent-sdk/overview | Official docs |
| Agent SDK TS repo | https://github.com/anthropics/claude-agent-sdk-typescript | TypeScript SDK |

## OpenClaw Reference

OpenClaw implementation details (file paths, code references) are in `.my_agent/docs/references.md`.
This is kept private since it contains paths specific to the development machine.

## Tech Stack

- **Runtime:** Node.js (TypeScript)
- **Agent:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **API server:** Fastify
- **Dashboard:** Alpine.js + Tailwind CSS
- **Memory (MVP):** `@modelcontextprotocol/server-memory`
- **Memory (later):** Mem0 or Graphiti + Memgraph
- **WhatsApp:** Baileys
- **Email:** Microsoft Graph API
- **Platform:** WSL (Linux on Windows)
- **Services:** systemd user services

## Build & Run

```bash
# Core (M1 — CLI REPL)
cd packages/core && npm install && npx tsx src/index.ts

# Dashboard (M2 — Web UI, in progress)
# cd packages/dashboard && npm install && npm run dev
```

## Milestones

| Milestone | Status | Description |
|-----------|--------|-------------|
| M1: Basic Nina (CLI) | Complete | Brain, hatching, auth, personality, CLI REPL |
| M2: Web UI | In Progress | Chat interface + hatching wizard (Alpine.js + Fastify) |
| M3: WhatsApp Bridge | Planned | WhatsApp channel plugin |
| M4a: Project System | Planned | Folder-based tasks, Claude Code spawning |
| M4b: Memory + Heartbeat | Planned | Graph memory, daily summaries, cron |
| M5: Operations Dashboard | Planned | Task browser, memory viewer, settings |
| M6: Email Support | Planned | Microsoft Graph email channel |

## Sprint Docs

Sprint plans and reviews are in `docs/sprints/`. Each sprint has a `plan.md` and `review.md`.

---

*Created: 2026-02-12*
*Updated: 2026-02-13 — M1 complete, M2 planning*
