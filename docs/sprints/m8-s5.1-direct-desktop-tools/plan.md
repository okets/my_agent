# M8-S5.1: Direct Desktop Tools — Implementation Plan

> **Goal:** Replace desktop subagent with direct MCP tools on both Ninas, matching the Playwright pattern.
> **Design spec:** [`2026-04-02-direct-desktop-tools-design.md`](../../superpowers/specs/2026-04-02-direct-desktop-tools-design.md)
> **Prerequisite:** M8-S5 (established the 6 MCP tool definitions)

---

## Context

M8-S5 introduced `AgentComputerUseService` — a subagent that spawns a separate Agent SDK session for desktop work. CTO identified this as an architectural gap: "if an agent does work, it should leave a paper trail." Adversary agent debate concluded that direct MCP tools (like Playwright) is the right pattern. Working Ninas already have paper trails via the job system.

## Tasks

- [x] **Task 1: Create `desktop-action-server.ts`** — 6 direct MCP tools (screenshot, click, type, key, scroll, wait) using X11Backend + VAS. Scale factor computed at server creation. Each tool returns image + screenshot URL.
- [x] **Task 2: Wire into shared MCP pool + clean up** — Register via `addMcpServer` in app.ts. Remove `AgentComputerUseService`, `desktop_task`, `handleDesktopTask`, `ComputerUseServiceLike`, `app.desktopComputerUse`. Slim `desktop-server.ts` to `desktop_info` only.
- [x] **Task 3: Update desktop-control skill** — Rewrite for direct tool usage. Add screenshot sharing guidance.
- [x] **Task 4: E2E browser test (Conversation Nina)** — Dashboard chat → ask Nina to screenshot VS Code ROADMAP.md → direct tools used → inline image displayed. PASS.
- [x] **Task 5: Fix MCP server factory for concurrent sessions** — In-process SDK MCP servers bind to one transport. Working Nina failed with "Already connected." Fix: `addMcpServerFactory()` creates fresh instances per session. Updated session-manager.ts and automation-executor.ts.
- [x] **Task 6: E2E verification (Working Nina)** — CTO tested via WhatsApp: spawned a one-off Working Nina job for desktop screenshot. Confirmed working after factory fix.

## Verification

Sprint verified when:
1. Conversation Nina uses direct desktop tools from dashboard chat — PASS
2. Working Nina uses direct desktop tools from a job — PASS (CTO verified)
3. No subagent spawned, no `AgentComputerUseService` involved — CONFIRMED (deleted)

---

*Plan written: 2026-04-02*
