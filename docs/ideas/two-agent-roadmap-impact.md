# Two-Agent Architecture: Roadmap Impact Analysis

> **Status:** Analysis — Informing transition planning
> **Created:** 2026-03-02
> **Author:** Roadmap Expert (team analysis)
> **Companion docs:**
> - [Two-Agent Architecture](two-agent-architecture.md) — the idea
> - [ROADMAP.md](../ROADMAP.md) — source of truth for milestones

---

## Executive Summary

The two-agent architecture (Conversation Nina + Working Agents) is a **foundational shift** that returns to the original design doc vision of "folders as sessions." It affects every planned milestone while keeping all completed infrastructure intact. The critical insight is that the new architecture **eliminates one layer** (the DB-driven TaskExecutor/TaskScheduler that spawns inline brain queries) and **replaces it with a simpler layer** (folder-based working agents). Much of what was planned for M6.6, M7, and M8 either collapses into this refactor or gets dramatically simplified.

**Recommendation:** Insert a new milestone `M6.7: Two-Agent Refactor` before M6.6. Absorb M6.6 (Agentic Lifecycle) into the refactored working-agent model. Reframe M7 (Coding Projects) as a specialization of the general working-agent pattern.

---

## Original Design Doc vs. Current Implementation vs. New Architecture

### The Original Design Doc Vision (docs/design.md)

The 2026-02-12 design document was explicit about folder-based sessions:

> *"The key insight: folders as sessions. Every task gets a project folder. Claude Code sessions run in those folders. Files, git history, CLAUDE.md, and session transcripts persist. Anyone (the agent or user) can open the folder later and continue interactively."*

The original design showed:
- `inbox/`, `projects/`, `ongoing/` as task folder directories
- Each folder containing `CLAUDE.md + task.md + files`
- Claude Code sessions running IN those folders
- Folder = resumable session state

The task system design spec (`docs/design/task-system.md`) elaborated:
- Anyone can open a task folder: `claude --cwd /path/to/folder/ -p "Continue from task.md"`
- No DB as source of truth — folders ARE the state
- Three types: trivial (no folder), ad-hoc, project, ongoing

### Where Implementation Deviated

M5 (Task System) implemented tasks differently from the original design:

| Aspect | Original Design | M5 Implementation | Deviation |
|--------|----------------|-------------------|-----------|
| Source of truth | Folders | `agent.db` (SQLite) | Major |
| Execution | Claude Code in folder | TaskExecutor inline query | Major |
| Resumability | Folder = session | `sdk_session_id` in DB | Different approach |
| Scheduling | Not specified | CalDAV → TaskScheduler | Reasonable addition |
| Task state | `task.md` | DB rows with status columns | Major |
| Output routing | Not specified | Logs to "Scheduled Events" conversation | Bug (exposed in M6.5-S4) |

The DB-centric implementation solved persistence and indexing but lost the key property: **tasks as self-contained, resumable, folder-based contexts**. The output routing bug that triggered this architecture rethink was a direct consequence of the deviation.

### How New Architecture Realigns

The two-agent architecture restores the original vision with crucial additions:

| Aspect | Original Design | New Architecture | Notes |
|--------|----------------|-----------------|-------|
| Source of truth | Folders | Folders (task.json, plan.md, deliverables/) | Aligned, enhanced |
| Execution | Claude Code in folder | Working agent reads folder | More general — not Claude Code-specific |
| DB role | Not mentioned | Disposable index (rebuilt from folders) | Elegant solution |
| Scheduling | Not specified | task.json recurrence rules | Cleaner than CalDAV |
| Output routing | Not specified | Working agent delivers to channel directly | Fixes the bug |
| Conversation linkage | Not specified | `createdBy: conversation:conv-123` in task.json | New |

The new architecture differs from the original in one key way: **working agents are Agent SDK instances, not Claude Code processes.** The original design assumed Claude Code (`claude --cwd`). The new design uses the Agent SDK's subagent/query mechanism. This is an improvement — it integrates with existing session management, MCP tools, and hooks.

---

## Milestone-by-Milestone Impact Analysis

### M1: Foundation — COMPLETE

**Current status:** Complete (4/4 sprints)

**What was built:** Brain session management, personality loading from CLAUDE.md, auth system, prompt assembly, hatching flow.

**Impact:** None. Unchanged.

**What's reused:** Everything. The brain's core loop, prompt assembly, auth, hatching — all foundational and correct.

**What needs rethinking:** Nothing. M1 work is solid infrastructure that both Conversation Nina and Working Agents will build on.

---

### M2: Web UI — COMPLETE

**Current status:** Complete (7/7 sprints)

**What was built:** Fastify server, Alpine.js SPA, WebSocket chat with streaming, conversation persistence, mobile layout.

**Impact:** Minimal. The dashboard UI primarily serves Conversation Nina. The task-related views (task list, task detail, calendar) need updating for the new folder-based model, but the chat interface is unchanged.

**What's reused:** All chat infrastructure, WebSocket real-time updates, conversation management.

**What needs rethinking:**
- Task list view currently reads from `agent.db`. Will need to read from folder index instead.
- Calendar view currently reads from CalDAV/Radicale. Will need to read from `/api/calendar/events` backed by task folders.
- Task detail view — minor changes to reflect `task.json` + `plan.md` as source.

**New dependency:** M6.7 (Two-Agent Refactor) affects how task data is sourced for existing dashboard views.

---

### M3: WhatsApp Channel — COMPLETE

**Current status:** Complete (3/3 sprints)

**What was built:** Baileys plugin, QR pairing, identity-based routing, owner conversations, settings view, slash commands.

**Impact:** Mostly unchanged in mechanism, major change in importance. WhatsApp becomes the **primary delivery channel for working agents**. The output routing bug (jokes not delivered to WhatsApp) is fixed by working agents explicitly delivering to channel.

**What's reused:** All channel infrastructure — plugin interface, ChannelManager, message routing, conversations per-channel.

**What needs rethinking:**
- The concept of "Scheduled Events" conversation is eliminated. Working agents deliver directly to the originating channel.
- Channel plugin interface needs a `deliver(message, channelId)` capability that working agents can call without being in a conversation context.

**New dependency created:** Working agents need a way to send to a channel outside of a Conversation Nina session. The channel's `send()` method needs to be accessible to working agents, not just the conversation brain.

---

### M4: Notebook System — COMPLETE

**Current status:** Complete (2/2 sprints)

**What was built:** Notebook file templates, prompt assembly with size limits, dashboard notebook browser.

**Impact:** Unchanged. The notebook is the agent's persistent memory. Working agents access it the same way Conversation Nina does — via MCP tools (`recall`, `remember`) or direct file reads in their task folder context.

**What's reused:** Everything.

**What needs rethinking:** Nothing. The open question from the two-agent architecture doc ("How does the working agent access notebook/memory?") has a clear answer: same MCP tools, working agents get them in their system prompt.

---

### M4.5: Calendar System — COMPLETE (but major rethink needed)

**Current status:** Complete (5/5 sprints)

**What was built:** Radicale CalDAV server, FullCalendar dashboard, tsdav client, ical-expander for RRULE, CalendarScheduler, CalendarRepository interface.

**Impact: MAJOR RETHINK.** The two-agent architecture explicitly eliminates Radicale:

> *"Radicale eliminated as dependency. FullCalendar reads from `/api/calendar/events` backed by our DB."*

**What's reused:**
- FullCalendar frontend — keep as-is, just change the API it reads from
- RRULE expansion logic (ical-expander) — can still be used to expand recurrence rules stored in task.json
- Calendar display concepts (system vs user vs personal calendars) — still valid
- Multi-calendar model — still applies (working agent tasks vs user reminders vs external calendars)

**What gets eliminated:**
- Radicale (CalDAV server) — no longer needed
- tsdav client — no longer needed
- CalendarRepository interface (CalDAV-specific) — replaced with task folder scanning
- CalendarScheduler (polling CalDAV) — replaced with TaskScheduler scanning task folders
- `X-MYAGENT-*` custom properties on iCal events — schedule metadata moves to `task.json`

**What needs building (part of M6.7):**
- `/api/calendar/events` endpoint backed by task folder scan + DB index
- Recurrence rule expansion from `task.json` (can reuse ical-expander logic)
- Migration of existing CalDAV events to task folders

**New dependencies:** M6.7 must include calendar API replacement before calendar UI breaks.

**Risk:** The Radicale elimination is a significant infrastructure change. The 5 sprints of CalDAV work (M4.5) produced infrastructure that is now being replaced. The FullCalendar UI is preserved, but the backend changes substantially.

---

### M5: Task System — COMPLETE (but major rethink needed)

**Current status:** Complete (10/10 sprints)

**What was built:** Task entity in `agent.db`, TaskExecutor (SDK session-based), TaskScheduler (polls DB), NotificationService, task-conversation linking, task list UI, work+deliverable architecture, live dashboard state publishing.

**Impact: MAJOR RETHINK.** The new architecture changes the fundamental model:

| M5 Current | Two-Agent Target |
|-----------|-----------------|
| Tasks are rows in `agent.db` | Tasks are folders with `task.json` |
| TaskExecutor runs brain query inline | Working agent spawned per task |
| TaskScheduler polls DB | TaskScheduler scans task folders |
| Output → Scheduled Events conversation | Output → channel delivery |
| DeliveryExecutor routes output | Working agent handles delivery directly |

**What's reused:**
- NotificationService — working agents use this for escalate/notify/request_input
- Task classification logic (trivial/ad-hoc/project/ongoing) — unchanged
- Task UI components (StatusBadge, DetailHeader) — keep, data source changes
- Live dashboard (WebSocket state publishing) — keep, source changes to folder scan
- Work + Deliverable architecture — the concept survives, deliverables go to `deliverables/` folder

**What gets replaced:**
- TaskExecutor — replaced by working agent spawn mechanism
- TaskScheduler — rewritten to scan task folders instead of DB
- `agent.db` tasks table — becomes a derived index rebuilt from folders
- Session continuity via `sdk_session_id` for tasks — working agents are stateless (folder is state)

**What's deferred (M5-S7: Request/Input Blocking):** This was deferred in M5. The two-agent architecture provides a cleaner answer via the `Escalate`, `Request input`, and `Notify` tools for working agents. Can be implemented properly in M6.7.

---

### M6: Memory — COMPLETE

**Current status:** Complete (9/9 sprints)

**What was built:** Markdown notebook, SQLite search index, hybrid BM25 + vector search, embeddings plugin system, five agent tools, dashboard memory browser, pre-compaction flush.

**Impact:** Unchanged in design. Enhanced in reach.

**What's reused:** Everything. The memory system is used by both Conversation Nina (as before) and Working Agents (new).

**What changes:**
- Working agents get the memory MCP tools in their system prompt. They can `recall()` before starting work, `remember()` after completing.
- The fact that working agents are separate processes (not the same SDK session as Conversation Nina) means they write to notebook independently. The file watcher (M6-S4) handles propagation.
- Open question: does `daily_log()` from a working agent write to the same daily file as Conversation Nina? Yes — the daily log is a shared resource.

---

### M6.5: Agent SDK Alignment — COMPLETE

**Current status:** Complete (4/4 sprints)

**What was built:** MCP tool infrastructure, subagent definitions (researcher/executor/reviewer), hook factory, full session management rewrite using SDK `resume: sessionId`, server-side compaction.

**Impact:** Foundational for the new architecture. The MCP tools and hook infrastructure built here are exactly what working agents will use.

**What's reused:**
- MCP memory server — working agents use this
- MCP channel stub — will be fleshed out for working agent delivery
- MCP task stub — becomes the working agent's folder management interface
- Hook factory (audit + safety) — applied to working agents
- Subagent definitions — the `executor` subagent pattern is close to what working agents become

**What changes:**
- The `researcher`, `executor`, `reviewer` subagent definitions were built as SDK subagents (running inside the brain's session). Working agents are a different model — they run in their own sessions, not as subagents of Conversation Nina.
- The `resume: sessionId` pattern for TaskExecutor (M6.5-S2) is replaced by working agents that are stateless (they read the folder each time).

**Key insight:** The M6.5 work validated the SDK foundation. The two-agent architecture is the next correct use of that foundation.

---

### M6.6: Agentic Lifecycle — PLANNED (major impact)

**Current status:** Planned, design complete, 4 sprints defined

**What was planned:** WorkLoopScheduler, morning-prep job, daily-summary job, heartbeat, fact extraction pipeline, work-patterns.md, current-state.md, context refresher on resume.

**Impact: PARTIAL ABSORPTION.** The two-agent architecture answers the question posed in the design doc:

> "M6.6 Agentic Lifecycle — Work loop jobs become ongoing task folders"

**Analysis:**

| M6.6 Feature | Status in Two-Agent Architecture |
|-------------|----------------------------------|
| `current-state.md` + temporal context | Unchanged — still needed, still valuable. Conversation Nina loads it on every new session. |
| Context refresher on resume | Unchanged — still needed for resumed conversations when notebook changed. |
| WorkLoopScheduler | Replaced by TaskScheduler scanning `ongoing/` task folders. Morning-prep, daily-summary, heartbeat become ongoing task folders. |
| Morning-prep job | Becomes an ongoing task folder: `ongoing/morning-prep/`. Working agent runs it. |
| Daily-summary job | Becomes an ongoing task folder: `ongoing/daily-summary/`. Working agent runs it. |
| Heartbeat (responsibility scanning) | Becomes an ongoing task folder: `ongoing/heartbeat/`. Working agent scans ongoing folders for due responsibilities. |
| Fact extraction (post-conversation) | Stays in AbbreviationQueue — this is triggered by conversation idle, not a scheduled task. Unchanged. |
| `work-patterns.md` + responsibilities | Unchanged concept. Working agents read it to understand their scope. |
| Terms of responsibility | Unchanged. These are ongoing task folders with recurrence rules. |

**What M6.6 becomes:** Significantly simpler. The WorkLoopScheduler is no longer a new scheduler class — it's just the existing TaskScheduler recognizing ongoing task folders. Morning-prep, daily-summary, and heartbeat are themselves working agents with ongoing task folders.

**What still needs building (from M6.6 that survives):**
- `current-state.md` mechanism (S1) — still needed, unchanged
- Context refresher on resume (S1) — still needed, unchanged
- Fact extraction pipeline (S3) — still needed, unchanged
- `work-patterns.md` schema + hatching step (S3) — still needed, unchanged
- E2E validation (S4) — still needed

**What collapses:** WorkLoopScheduler as a new class (becomes TaskScheduler's handling of ongoing folders). Heartbeat as a code concept (becomes a working agent). Background query utility (working agents handle this natively).

**Recommendation:** M6.6 scope should be updated to remove the WorkLoopScheduler and heartbeat-as-code. Instead, M6.6 delivers: (a) current-state.md + temporal context, (b) context refresher, (c) fact extraction pipeline, (d) work-patterns.md + hatching step. The scheduling of background work flows from M6.7 (task folder infrastructure).

---

### M7: Coding Projects — PLANNED (major simplification)

**Current status:** Planned, design complete

**What was planned:** Internal projects (folder templates, autonomous Claude Code sessions), user code session relay, stream-json streaming, process supervision (non-LLM), systemd watchdog, active session streaming.

**Impact: MAJOR SIMPLIFICATION.** The two-agent architecture is already the coding project model.

**Analysis:**

The M7 design spec says:
> *"Claude Code is a capable executor. Given clear instructions and the right workflows, it can work autonomously. Nina's role is supervision (process-level, not LLM-level) and communication routing."*

The two-agent architecture says:
> *"Working agents don't need resumable sessions. Each spawn reads the task folder's living documents. Fresh spawns, living documents."*

These are the same pattern. The distinction M7 made between "Nina supervises Claude Code" and "Nina is a coordinator" dissolves when working agents ARE the executor. The key differences:

| M7 Design | Two-Agent Reality |
|-----------|------------------|
| Spawns Claude Code subprocess | Spawns working agent (Agent SDK) |
| `--output-format stream-json` for streaming | SDK streaming (existing pattern) |
| Process-level supervision (PID checks) | Agent SDK handles lifecycle |
| `--continue` for session resume | Folder is state — no session to resume |
| DECISIONS.md, DEVIATIONS.md per project | Same — these are conventions in the task folder |

**What survives from M7:**
- Internal project folder templates (CLAUDE.md, task.md, DECISIONS.md, etc.) — these become the standard task folder structure, applied universally
- The sprint plan structure within task folders — still valuable
- Self-evolving infrastructure patterns (WISHLIST.md) — unchanged
- User code project relay — this specific use case (relay for user's external repo) is distinct and still needs implementation

**What changes:**
- "Spawn Claude Code" → "Spawn working agent" — the executor mechanism
- Process supervision (PID, systemd watchdog) — working agents run inside the existing server process. No subprocess management needed for Agent SDK queries. The process supervision concern is eliminated.
- `stream-json` streaming — replaced by SDK streaming which is already implemented
- The M7 "Prototype Checklist" for Claude Code subprocess behavior — no longer relevant

**What M7 becomes:** A narrower milestone. It delivers:
1. Task folder templates (CLAUDE.md, task.md, DECISIONS.md) standardized for all task types
2. User code project relay (unique use case — still needed)
3. Dashboard visibility for active working agents (streaming, progress)

**Recommendation:** M7 scope significantly reduced. Much of it is delivered by M6.7. M7's remaining value is the user code relay (agent watches an external repo, relays to user) and enhanced dashboard visibility for working agent sessions.

---

### M8: Operations Dashboard — PLANNED (partially simplified)

**Current status:** Planned, design complete

**What was planned:** Task browser (inbox/projects/ongoing), project detail view, memory viewer, work loop status panel, responsibility manager, settings.

**Impact: PARTIALLY SIMPLIFIED.** The folder-based task model makes the dashboard simpler in some ways and same in others.

**What changes:**
- Task browser reads from folder scan + DB index instead of `agent.db` directly. Same UI, different backend.
- "Work loop status panel" showing `current-state.md` contents and active responsibilities — still needed, same design.
- "Open in VS Code" deep links — these become more powerful and important now that tasks are real folders.
- Project detail view — now shows `plan.md`, `deliverables/`, and `notes.md` from the task folder.

**What stays the same:**
- Memory viewer (notebook browser, search) — unchanged
- Settings — unchanged
- The overall information architecture (inbox/projects/ongoing/archive) — unchanged

**What gets easier:**
- Task detail view can literally serve the raw markdown files from the task folder. No need to reconstruct state from DB events. `plan.md` IS the plan. `notes.md` IS the notes.
- "Open in VS Code" links point to actual folders containing the full context.

**What gets harder:**
- Task browser needs folder scanning, which is slower than a DB query. The disposable SQLite index is the answer — keep it as an index for fast listing.

---

### M9: Email Channel — PLANNED

**Current status:** Planned, design complete

**What was planned:** Microsoft Graph MCP plugin, dedicated role (agent's email), personal role (user's email via responsibility), OAuth 2.0, thread management.

**Impact: Unchanged in design, enhanced in execution.** The two-agent architecture makes the email use case cleaner.

**What changes:**
- Email drafting and sending is a working agent task. User says "draft a reply to Bob" → Conversation Nina creates a task folder → working agent drafts → delivers via email channel.
- Personal role email monitoring becomes an ongoing task folder (heartbeat reads email, decides what to surface).
- The "delivery channel" for working agents includes email — `task.json` can specify `delivery.channel: "email"`.

**What stays the same:**
- Channel plugin interface — unchanged
- OAuth flow — unchanged
- Thread management — unchanged
- The two channel roles (dedicated vs personal) — unchanged

---

### M10: External Communications — PLANNED

**Current status:** Planned, deferred from M3/M4

**What was planned:** Personal channel role, ruleset model, approval flows, external communications UI.

**Impact: Unchanged in design.** The ruleset model and approval flows are a policy layer on top of channel delivery. Working agents obey the same autonomy rules that TaskExecutor currently checks.

**What changes:**
- Approval flows become working-agent-native. A working agent uses the `Escalate` tool to request approval before sending an external message.
- The stashed M3-S4 code may need adapting to work with the new working-agent delivery model.

---

## Answers to Key Questions

### 1. Does M6.6 (Agentic Lifecycle) get absorbed?

**Partially absorbed.** The scheduling infrastructure (WorkLoopScheduler) is absorbed into the general task folder model — background jobs become ongoing task folders. However, the high-value M6.6 features survive independently:

- `current-state.md` — still needed, unchanged
- Context refresher on resume — still needed, unchanged
- Fact extraction pipeline — still needed, unchanged
- `work-patterns.md` — still needed, unchanged

M6.6 should be **refocused** to deliver these features, with the scheduling aspect handled by M6.7's TaskScheduler.

### 2. Does M7 (Coding Projects) get simplified?

**Significantly simplified.** The core M7 value proposition (autonomous coding with folder-based context) IS the two-agent architecture. What remains of M7:

- User code project relay (still distinct and valuable)
- Task folder template standards
- Enhanced streaming visibility for working agents in dashboard

The Claude Code subprocess supervision, stream-json parsing, and process-level watchdog concerns are eliminated.

### 3. What happens to M4.5 (Calendar) infrastructure if Radicale is eliminated?

**Radicale and tsdav are eliminated.** The FullCalendar UI is preserved. M6.7 must build the replacement `/api/calendar/events` endpoint backed by task folder scan + DB index. The 5 sprints of CalDAV work built valuable concepts (multi-calendar model, RRULE expansion) but the infrastructure layer is replaced.

**Transition plan:**
1. M6.7 implements `/api/calendar/events` backed by task folders
2. FullCalendar continues to work (same API contract)
3. Existing CalDAV events migrated to task folders
4. Radicale service stopped and removed

### 4. How does M8 (Operations Dashboard) change if tasks are folder-based?

**Simplification in detail views, same in overview.** Task browser still shows inbox/projects/ongoing lists. Detail views become richer because they can show actual folder contents (plan.md, deliverables, notes) instead of reconstructed DB state. "Open in VS Code" links become deeply useful.

### 5. What is the new milestone ordering? What's the new critical path?

**New ordering:**

```
M1–M6.5 (complete) → M6.7: Two-Agent Refactor → M6.6: Agentic Lifecycle (refocused) → M7 (reduced) → M8 → M9 → M10
```

**M6.7 is the new critical path gating.** Everything else depends on:
- Task folder structure (task.json schema, directory conventions)
- Working agent spawn mechanism
- TaskScheduler folder-based polling
- Calendar API replacement
- DB index (rebuilt from folders)

### 6. Should there be a new milestone M6.7?

**Yes, strongly recommended.** This should be `M6.7: Two-Agent Refactor`. It delivers:

1. **Task folder infrastructure** — `task.json` schema, directory conventions (inbox/, projects/, ongoing/), folder creation API
2. **Working agent spawn** — mechanism to start a working agent from a task folder
3. **TaskScheduler rewrite** — scan task folders instead of DB, detect due tasks
4. **Calendar API replacement** — `/api/calendar/events` backed by task folders, Radicale decommissioned
5. **DB index layer** — lightweight SQLite index rebuilt from folder scans (fast queries for UI)
6. **Channel delivery for working agents** — working agents can send to channels without being in a conversation
7. **Escalate / Notify / Request-Input tools** — working agent MCP tools for user interaction
8. **Migration** — existing DB tasks → task folders, existing CalDAV events → task.json

---

## What Can Be Reused vs. What Changes

### Fully Reusable (No Changes)

| System | Component | Why Unchanged |
|--------|-----------|---------------|
| M1 | All | Core brain infrastructure correct |
| M2 | Chat, WebSocket, conversations | Conversation Nina uses this as-is |
| M3 | Channel plugin, Baileys, routing | Routing model unchanged |
| M4 | Notebook files, dashboard browser | Memory is shared resource |
| M6 | Memory tools, embeddings, search | Working agents use same tools |
| M6.5 | MCP servers, hook factory | Working agents use same infrastructure |

### Partially Reusable (Adaptation Needed)

| System | What to Reuse | What to Adapt |
|--------|--------------|--------------|
| M4.5 Calendar | FullCalendar UI, RRULE concepts, multi-calendar model | Replace Radicale backend with folder-based API |
| M5 Task System | NotificationService, task UI components, live dashboard, work+deliverable concept | Rewrite TaskExecutor/TaskScheduler, move source of truth to folders |
| M6.6 Agentic Lifecycle (planned) | current-state.md, context refresher, fact extraction, work-patterns.md | Remove WorkLoopScheduler as new class (it's now TaskScheduler) |
| M7 Coding Projects (planned) | Folder templates, DECISIONS.md pattern, user code relay concept | Remove Claude Code subprocess supervision; working agent is the executor |
| M8 Operations Dashboard (planned) | Information architecture, memory viewer | Task browser reads from folders/index; detail views show folder contents |

### Replaced

| System | Old Approach | New Approach |
|--------|-------------|-------------|
| Task execution | TaskExecutor (inline brain query) | Working agent (separate SDK session) |
| Task storage | `agent.db` tasks table (source of truth) | Task folders (source of truth) |
| Task scheduling | CalDAV events → CalendarScheduler | task.json recurrence → TaskScheduler |
| Calendar backend | Radicale + tsdav | Folder scan + DB index + REST API |
| Output routing | "Scheduled Events" conversation | Working agent delivers to target channel |

---

## New Dependencies Created by Architecture Change

1. **Working agent mechanism** gates everything in M6.7+. Must be built first.
2. **Folder scan → DB index** is the new foundation for task UI and TaskScheduler. Must be reliable.
3. **Channel delivery for working agents** (send outside of conversation context) is needed before any scheduled task can deliver results.
4. **task.json schema** must be finalized before folder creation, task browser, calendar API, or scheduler can be built.
5. **Calendar API replacement** must land before M4.5 infrastructure is decommissioned. FullCalendar must continue working throughout the transition.
6. **Migration path** (DB tasks + CalDAV events → task folders) must be validated before old infrastructure is removed.

---

## Revised Roadmap Summary

| Milestone | Status | Impact | Action |
|-----------|--------|--------|--------|
| M1 Foundation | Complete | None | Keep as-is |
| M2 Web UI | Complete | Minimal | Task views update in M6.7 |
| M3 WhatsApp | Complete | Minimal | Channel delivery for working agents in M6.7 |
| M4 Notebook | Complete | None | Keep as-is |
| M4.5 Calendar | Complete | Major | Replace backend in M6.7, keep FullCalendar UI |
| M5 Task System | Complete | Major | Refactor in M6.7; DB becomes index |
| M6 Memory | Complete | None | Working agents use same tools |
| M6.5 SDK Alignment | Complete | Foundation | MCP tools + hooks ready for working agents |
| **M6.7 Two-Agent Refactor** | **NEW** | **Foundational** | **Insert here — critical path** |
| M6.6 Agentic Lifecycle | Planned → Refocused | Partial | Remove WorkLoopScheduler; keep current-state.md + context refresher + fact extraction + work-patterns |
| M7 Coding Projects | Planned → Reduced | Major simplification | Remove subprocess supervision; focus on user code relay + dashboard visibility |
| M8 Operations Dashboard | Planned → Simplified | Moderate | Same IA, folder-backed detail views |
| M9 Email Channel | Planned | Unchanged | Email as working agent delivery channel |
| M10 External Comms | Planned | Unchanged | Policy layer over working agent delivery |

---

## Suggested M6.7 Sprint Breakdown

### S1: Task Folder Infrastructure
- Define `task.json` schema (id, title, type, status, schedule, delivery, recurrence)
- Directory conventions (`.my_agent/tasks/inbox/`, `projects/`, `ongoing/`)
- Folder creation API (`POST /api/tasks` → creates folder)
- Folder scanner (reads all task folders, builds in-memory index)

### S2: Working Agent Spawn
- Working agent spawn mechanism (Agent SDK query with task folder context)
- System prompt template for working agents (lean, task-focused)
- Escalate / Notify / Request-Input MCP tools for working agents
- Working agent delivery to channel (outside conversation context)

### S3: TaskScheduler + Calendar Replacement
- TaskScheduler rewrite (scans task folders, detects due tasks, spawns working agents)
- RRULE expansion from task.json recurrence field
- `/api/calendar/events` endpoint backed by task folder scan
- FullCalendar frontend points to new endpoint (calendar UI unchanged)
- Decommission Radicale + tsdav

### S4: DB Index + Migration
- SQLite index (lightweight, rebuilt from folder scans)
- Task browser reads from index (fast queries)
- Live dashboard WebSocket updates on folder changes (reuse SyncService)
- Migration: existing DB tasks → task folders
- Migration: existing CalDAV events → task.json

### S5: E2E Validation
- E2E tests for full working agent lifecycle (create folder → schedule → spawn → deliver)
- Calendar CRUD via UI (creates task folders)
- Radicale fully removed, no regressions
- Human-in-the-loop validation

---

*Created: 2026-03-02*
*Analysis by: Roadmap Expert (team analysis)*
