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
- **Self-evolving infrastructure** — APIs that serve agents, maintained by agents. See below.

## Self-Evolving Infrastructure

> *"The API is for agents, maintained by agents."*

**Philosophy:** When agents (Claude Code, QA agents, dev agents) need capabilities that don't exist, they should document the need, implement the solution, and continue working. Humans review in sprint review.

**Pattern:** Every sprint team includes a QA agent that:
1. Tests changes using the Debug/Admin API
2. Documents missing capabilities in `WISHLIST.md`
3. Spawns subagents to implement missing endpoints
4. Continues testing with new capabilities

**Why:** Agents discover needs faster than humans can anticipate. Let agents solve their own problems, under human review.

**Design doc:** `docs/design/self-evolving-infrastructure.md`
**API spec:** `docs/design/debug-api.md`

**Trust gradient:**
| Agent | Use API | Extend API | Modify Core |
|-------|---------|------------|-------------|
| QA Agent | ✓ | ✓ (subagent) | ✗ |
| Dev Agent | ✓ | ✓ | ✓ (reviewed) |
| Brain | ✓ (limited) | ✗ | ✗ |

## References

| Document | Path | Purpose |
|----------|------|---------|
| Roadmap | `docs/ROADMAP.md` | **Source of truth** for milestones, sprints, work breakdown |
| Design doc | `docs/design.md` | Full architecture, flows, decisions |
| Design specs | `docs/design/*.md` | Detailed specs (channels, conversations, etc.) |
| Self-evolving infra | `docs/design/self-evolving-infrastructure.md` | Philosophy: APIs for agents, by agents |
| Debug API | `docs/design/debug-api.md` | Debug/Admin API specification |
| Procedures | `docs/procedures/*.md` | Team workflows (overnight sprints, etc.) |
| References | `.my_agent/docs/references.md` | OpenClaw source paths, vision docs, SDK links (private) |
| Agent SDK docs | https://platform.claude.com/docs/en/agent-sdk/overview | Official docs |
| Agent SDK TS repo | https://github.com/anthropics/claude-agent-sdk-typescript | TypeScript SDK |

## Sprint Workflows

**Two modes of execution:**

| Mode | When | Decision Handling | Deliverable |
|------|------|-------------------|-------------|
| **Normal Sprint** | Daytime, CTO available | Block → escalate → wait | Incremental commits |
| **Overnight Sprint** | Async, CTO reviews later | Decide → log → continue | Branch + artifacts |

**Overnight procedure:** `docs/procedures/overnight-sprint.md`
- Works on feature branch
- Logs all decisions in DECISIONS.md
- Logs deviations in DEVIATIONS.md
- Includes Opus review + QA test report
- CTO reviews and merges in morning

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

## Agent SDK Development Rule

When modifying any of the following, **invoke the `claude-developer-platform` skill first** to verify current SDK APIs and types:

- `packages/core/src/brain.ts` — query options, session management
- `packages/core/src/mcp/` — MCP tool definitions, `createSdkMcpServer` usage
- `packages/core/src/agents/` — subagent definitions (`AgentDefinition` shape)
- `packages/core/src/hooks/` — hook callbacks, `HookCallbackMatcher` wiring
- Any file importing from `@anthropic-ai/claude-agent-sdk`

**Why:** The Agent SDK evolves across releases. Type signatures, option shapes, and hook event names may change. Always check the current SDK docs before assuming an API shape.

**Key SDK types (M6.5-S1):**
- `Options.mcpServers` — MCP server configs (use `createSdkMcpServer()`)
- `Options.agents` — `Record<string, AgentDefinition>`
- `Options.hooks` — `Partial<Record<HookEvent, HookCallbackMatcher[]>>`
- `HookCallback` — `(input: HookInput, toolUseID, options) => Promise<HookJSONOutput>`
- `tool(name, description, schema, handler)` — creates MCP tool definitions

## Build & Run

```bash
# Core (M1 — CLI REPL)
cd packages/core && npm install && npx tsx src/index.ts

# Dashboard (M2 — Web UI, in progress)
# cd packages/dashboard && npm install && npm run dev
```

## Roadmap

**Source of truth:** [`docs/ROADMAP.md`](docs/ROADMAP.md)

The roadmap contains:
- Milestone status and progress
- Sprint plans and reviews
- Design spec traceability
- Dependency graph
- Work breakdown

**Current:** M2 Web UI (S1 complete, S2-S5 pending)

---

*Created: 2026-02-12*
*Updated: 2026-02-18 — Added self-evolving infrastructure philosophy*
