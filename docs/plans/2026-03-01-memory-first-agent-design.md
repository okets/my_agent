# Memory-First Agent Design

> **Status:** Approved
> **Created:** 2026-03-01
> **Author:** Design session with Hanan

---

## Problem Statement

During live testing, the agent was asked "What's the weather like?" and responded:

> "I don't know your location."

The agent has a `recall()` tool. It has instructions to search memory before asking. But it ignored them and asked directly.

**Why?** Because memory use is an *instruction* competing with 50 other instructions. The model treats it as optional. This is the "optional memory" problem.

---

## Vision

A human executive assistant doesn't frantically Google things while you're talking. They prepare your briefing book overnight. They already know your preferences, your schedule, your contacts.

The agent should work the same way:
- **Proactive connection** — agent brings up relevant context unprompted
- **Seamless continuity** — conversations feel like they never ended
- **Deep understanding** — agent grasps nuance, not just facts
- **Passive absorption** — agent learns from conversations without explicit "remember this" commands

---

## Core Insight

The solution isn't "make the agent always search." It's "make the agent rarely NEED to search because context is pre-loaded."

This requires thinking about the agent's work OUTSIDE of conversations. A human EA has their own work schedule — morning prep, monitoring throughout the day, post-meeting notes, weekly reviews. Our agent should too.

---

## Design: Agent Work Loop + Temporal Anchoring

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     BACKGROUND (Work Loop)                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Morning Prep (scheduled)                                   │
│   └─ Review calendar, pending tasks, recent facts            │
│   └─ Write → notebook/operations/current-state.md            │
│                                                              │
│   Post-Conversation (10-min idle trigger)                    │
│   └─ Existing: AbbreviationQueue summarizes transcript       │
│   └─ NEW: Extract facts → notebook/knowledge/                │
│                                                              │
│   Weekly Review (scheduled)                                  │
│   └─ Promote consistent weak facts → strong (reference/)     │
│   └─ Archive stale facts                                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  CONVERSATION (new or resumed)                │
├──────────────────────────────────────────────────────────────┤
│   NEW conversation:                                          │
│   → Fresh session, fresh system prompt, everything current   │
│                                                              │
│   RESUMED conversation:                                      │
│   → Resume SDK session (preserve full history + nuance)      │
│   → Check: operations/ or reference/ changed since last msg? │
│      └─ YES: Inject context refresher with current state     │
│      └─ NO: Continue normally                                │
│   → Model has BOTH: conversation nuance + fresh state        │
└──────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. `current-state.md` — Dynamic Context (Zero Code Changes)

A file in `notebook/operations/` that captures the agent's current understanding of the user's state. Auto-injected by existing `loadNotebookOperations()` in `prompt.ts`.

```markdown
## Current State (updated 07:00)
- Location: Berlin (travel until Mar 5)
- Focus: Memory-first agent design
- Next: 10:30 standup with team
- Pending: 2 tasks due today
```

**Why this works:** The work loop keeps this file current. Every new session loads it automatically. The agent "already knows" without searching.

#### 2. Context Refresher on Resume

Conversations are always resumable — we never invalidate SDK sessions. Instead, when a resumed conversation detects that the notebook has changed, a context refresher is injected alongside the user's message.

```
User resumes conversation from yesterday
    → SDK session resumes (full history preserved)
    → Check: operations/ or reference/ mtime > lastMessageAt?
    → YES: prepend context refresher to message
    → Agent has conversation nuance + fresh state
```

**Scoped change detection:** Only track mtime on `notebook/operations/` and `notebook/reference/` — these are the auto-injected directories. Changes to `knowledge/`, `lists/`, or `daily/` are irrelevant (not in the system prompt).

**Files to modify:**
- `packages/dashboard/src/agent/session-manager.ts` — track `lastMessageAt`, inject refresher when notebook changed

#### 3. Temporal Context Injection

Inject timestamps so the model knows when context was built vs. current time.

```markdown
## Temporal Context
Current time: 2026-03-01 09:15
Session started: 2026-03-01 09:10
Notebook last updated: 2026-03-01 07:00 (morning prep)
```

The model can reason about staleness naturally — "we last spoke yesterday afternoon" — without special code.

#### 4. WorkLoopScheduler

A new scheduler following the `TaskScheduler` pattern. Triggers periodic agent work.

```typescript
// packages/dashboard/src/scheduler/work-loop-scheduler.ts
export class WorkLoopScheduler {
  private jobs: Map<string, WorkLoopJob> = new Map();

  register(job: WorkLoopJob): void { /* ... */ }

  start(): void {
    setInterval(() => this.checkAndRun(), 60_000);
  }

  private async checkAndRun(): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (this.isDue(job)) {
        await this.executeJob(job);
      }
    }
  }
}
```

**Jobs to register:**
- `morning-prep` — runs at 8am, writes `current-state.md`
- `daily-summary` — runs at EOD, consolidates learnings
- `weekly-review` — runs Sunday, promotes facts, archives stale data

**Model policy:** All work loop jobs use **Haiku** — cheap, fast, sufficient for structured background work. The main model (Opus/Sonnet) is reserved for conversations and high-effort tasks only.

**Heartbeat filtering:** The heartbeat evaluates responsibilities by cadence — a weekly responsibility is only checked when `lastTriggered + cadence < now`. This prevents wasted evaluation cycles.

**Token budget:** `current-state.md` must stay within **500-1000 chars** — a concise briefing, not a report. The morning prep prompt enforces this limit.

#### 5. Fact Extraction Pipeline

Run fact extraction **in parallel** with summarization on the **original transcript** — not chained after summarization. Summarization is lossy compression; fact extraction needs precision. Different goals, different prompts, same input.

```typescript
// In AbbreviationQueue.abbreviateConversation():
const [abbreviation, extractedFacts] = await Promise.all([
  this.summarize(turns),           // existing: lossy compression for search
  this.extractFacts(turns),        // new: precision extraction for notebook
]);
await this.saveAbbreviation(conversationId, abbreviation);
await this.persistFacts(extractedFacts); // → notebook/knowledge/
```

Both are Haiku calls on the full transcript. One extra Haiku call per idle conversation — negligible cost, significantly better fact quality.

**What to extract:**
- Explicit preferences ("I prefer X", "always do Y")
- Contact info (names, relationships)
- Location/schedule patterns
- Decisions and commitments

---

## Notebook Injection Scope

| Directory | Auto-injected? | Purpose |
|-----------|----------------|---------|
| `notebook/reference/*` | Yes | Always-on context (contacts, preferences) |
| `notebook/operations/*` | Yes | Operational state (`current-state.md`) |
| `notebook/daily/` | Today + yesterday | Recent activity |
| `notebook/knowledge/*` | No (searchable) | Extracted facts, deep history |
| `notebook/lists/*` | No (searchable) | Todos, project details |

**Design principle:** Reference + operations = "always knows." Knowledge + lists = "can find when needed."

---

## When Does the Agent Search?

The work loop pre-loads common needs. For edge cases, the agent still has tools:

| Need | Pre-loaded? | Source |
|------|-------------|--------|
| User's location | Yes | `current-state.md` |
| Today's schedule | Yes | `current-state.md` + calendar |
| Key contacts | Yes | `reference/contacts.md` |
| Standing preferences | Yes | `reference/` + `operations/` |
| Deep history | No | `recall()` search |
| Specific past conversations | No | `conversation_search()` |
| Obscure facts | No | `recall()` or `notebook_read()` |

**The key insight:** We're not solving "make agent always search." We're solving "make agent rarely NEED to search."

---

## Implementation Phases

### Phase 1: MVP (1 sprint)

**Goal:** Agent "already knows" common context without searching.

1. Create `notebook/operations/current-state.md` manually
2. Add temporal context injection to system prompt (~10 lines)
3. Add context refresher on resume: detect notebook changes (scoped to `operations/` + `reference/`), inject state update alongside user message
4. Test: "What's the weather?" → agent sees location in current-state.md

**Files:**
- `packages/dashboard/src/agent/session-manager.ts` (context refresher + temporal injection)
- `packages/core/src/prompt.ts` (minor: add temporal context to system prompt)

### Phase 2: Automation (1 sprint)

**Goal:** Work loop maintains `current-state.md` automatically.

1. Create `WorkLoopScheduler` following `TaskScheduler` pattern
2. Implement morning prep job (Haiku reviews calendar/tasks → writes state)
3. Wire scheduler initialization in `index.ts`

**Files:**
- `packages/dashboard/src/scheduler/work-loop-scheduler.ts` (new)
- `packages/dashboard/src/index.ts` (initialization)

### Phase 3: Learning (1-2 sprints)

**Goal:** Agent learns from conversations passively.

1. Extend `AbbreviationQueue` with fact extraction
2. Write extracted facts to `notebook/knowledge/`
3. Add weekly review job for fact promotion
4. Optional: "Memory updated" indicator in UI

**Files:**
- `packages/dashboard/src/conversations/abbreviation.ts`
- `packages/dashboard/src/scheduler/work-loop-scheduler.ts`

---

## Success Criteria

1. "What's the weather?" → Agent checks `current-state.md` for location
2. "What should I order?" → Agent recalls dietary preferences
3. "John said hi" → Agent knows who John is
4. "Hi" → No unnecessary memory search
5. No noticeable latency increase for simple queries

---

## Research References

### Industry Patterns

- **ChatGPT Pulse:** Runs daily, synthesizes from memory + chat history
- **Google CC:** Morning briefing from calendar + email
- **Letta Sleep-Time Compute:** Background agent refines memory during idle
- **Microsoft AIContextProvider:** Pre-inference memory injection

### Key Insights

- **Proactive ≠ pushy** — PITCH study found 30-word limit works best
- **Context drift is the silent killer** — temporal anchoring detects staleness
- **"Forgetting is not a bug"** — consolidation prunes noise

### Codebase Patterns Leveraged

- `loadNotebookOperations()` — auto-loads `operations/*.md`
- `SyncService` — already watches notebook for changes
- `TaskScheduler` — pattern for `WorkLoopScheduler`
- `AbbreviationQueue` — pipeline for fact extraction

---

## Agentic Lifecycle

> The agent has a *life* outside of conversations. Conversations are just one part.

### Lifecycle Overview

```
HATCHING (once)
└─ Produces: identity, personality, restrictions, operating-rules (LOCKED)
└─ Produces: work-patterns.md (OPERATIONAL — terms of responsibility)

    │
    ▼
┌─────────────────────────────────────────────────┐
│                 DAILY CYCLE                       │
│                                                   │
│  MORNING PREP (scheduled)                         │
│  └─ Load responsibilities, scan calendar/tasks   │
│  └─ Write current-state.md → briefing for convos │
│                                                   │
│  CONVERSATIONS (reactive)                         │
│  └─ New: fresh session with full notebook context │
│  └─ Resumed: SDK session + context refresher      │
│                                                   │
│  POST-CONVERSATION (idle trigger, ~10 min)        │
│  └─ Extract facts, update notebook                │
│  └─ Run medium-effort responsibilities            │
│                                                   │
│  HEARTBEAT (every N minutes)                      │
│  └─ Scan responsibilities against current state   │
│  └─ Triage by effort → do / queue / suggest       │
│                                                   │
│  DAILY SUMMARY (scheduled, EOD)                   │
│  └─ Consolidate learnings, spot patterns          │
│  └─ Seed tomorrow's morning prep                  │
└─────────────────────────────────────────────────┘
    │ (repeats)
    ▼
WEEKLY REVIEW (scheduled)
└─ Promote facts, archive stale, refine responsibilities

    │ (over time)
    ▼
EVOLUTION (continuous)
└─ New responsibilities emerge from conversations
└─ Notebook grows, agent becomes more capable
```

### Work Patterns (from Hatching)

Hatching produces two categories:

| Category | Files | Mutable? | Used By |
|----------|-------|----------|---------|
| **Identity (WHO)** | identity.md, personality.md, restrictions.md, operating-rules.md | Locked | Conversation agent |
| **Operational (HOW)** | work-patterns.md | Evolving | Background work loop |

`work-patterns.md` is **machine-readable config for the work loop**, not prose for the conversation agent. It contains **terms of responsibility** — standing obligations with scope, autonomy level, and cadence.

### Terms of Responsibility

Derived bottom-up from real use cases:

| Pattern | Example | Trigger |
|---------|---------|---------|
| **Proactive insight** | User discusses Thailand trip → agent creates research tasks → presents in morning brief | Pattern detected in conversations |
| **Standing responsibility** | "Monitor and promote social presence" → weekly recurring task, different work each time | Assigned explicitly or via conversation |
| **Autonomous initiative** | Agent sees sprint planned + idle time → implements on branch → presents for review | Opportunity + capability + trust |

New responsibilities enter via **conversations → tasks → work-patterns.md update**. The agent can't grant itself new responsibilities — they emerge from user interaction. If hatching grants "proactive-autonomy", the agent can *suggest* new responsibilities.

### Effort-Based Prioritization

Effort is determined by **context compaction required** — a measurable signal the agent already has:

| Effort | Context Signal | Action |
|--------|---------------|--------|
| **Low** | Fits in current background context | Just do it |
| **Medium** | Needs its own session, single turn | Do when idle |
| **High** | Needs multiple turns, compaction kicks in | Suggest to user → becomes a task |

Decision tree for the background agent:

```
Responsibility triggers
    │
    ├─ Fits in current context?        → LOW  → do now
    │   (notebook update, quick check)
    │
    ├─ Needs own session, single turn?  → MEDIUM → do when idle
    │   (research, draft, analysis)
    │
    └─ Needs compaction-scale work?     → HIGH → suggest to user
        (sprint work, major project)
```

### Work-Patterns Schema

```yaml
# .my_agent/brain/work-patterns.md (or .yaml)
responsibilities:
  - name: "Social Presence"
    scope: "Monitor and promote social accounts"
    autonomy: suggest    # research | suggest | act
    cadence: weekly
    added: 2026-03-01
    lastTriggered: null
    expiresAfter: null   # or a date for time-bounded responsibilities

  - name: "Development Work"
    scope: "Roadmap sprints, bug fixes"
    autonomy: act        # implement on branches, present for review
    cadence: on_idle
    added: 2026-03-01
    lastTriggered: null
    expiresAfter: null

  - name: "Active Interests"
    scope: "Topics from recent conversations"
    autonomy: research
    cadence: daily
    added: 2026-03-01
    lastTriggered: null
    expiresAfter: null

routines:
  morning_prep: true
  daily_summary: true
  weekly_review: true
```

The heartbeat uses `lastTriggered` + `cadence` to determine which responsibilities to evaluate each cycle. `expiresAfter` allows time-bounded responsibilities to age out automatically (e.g., "prepare quarterly report" expires after the quarter). The weekly review job checks for stale or conflicting responsibilities.

---

## Risk Mitigations

### Conversation continuity preserved

**Decision:** No session invalidation. Conversations are always resumable via SDK session resume. When notebook changes, a context refresher is injected alongside the next message — the model gets BOTH conversation history and fresh state.

**Rationale:** Conversations are first-class resumable entities. Losing SDK session history to get fresh notebook context is the wrong tradeoff. Context refreshers achieve the same result without losing nuance.

### Scoped change detection

**Decision:** Only track mtime on `notebook/operations/` and `notebook/reference/`. Changes to `knowledge/`, `lists/`, or `daily/` do not trigger context refreshers.

**Rationale:** Only `operations/` and `reference/` are auto-injected into system prompts. Post-conversation fact extraction writes to `knowledge/` — without scoping, every idle extraction would trigger unnecessary refreshers on the next message.

### Heartbeat as retry mechanism

**Decision:** If a work loop job fails (morning prep, daily summary), the heartbeat retries it on the next cycle. No per-job retry/backoff logic needed.

**Rationale:** The heartbeat fires every N minutes and checks "has this job completed successfully?" If not, it retries. If Claude's API is down for 2 hours, the heartbeat keeps trying every cycle and catches up the moment the API returns. Additionally, `current-state.md` includes its own timestamp (`## Current State (updated 07:00)`) so the model can reason about freshness even if the file is stale.

---

## Open Questions (for future iterations)

1. Should `current-state.md` be visible to the user in the dashboard?
2. How do we handle conflicting facts?
3. Should the agent explain *why* it knows something?
4. How does fact extraction interact with multi-user scenarios?
5. Exact format of work-patterns.md (markdown vs YAML vs structured markdown)
6. How does proactive-autonomy get granted/revoked?

---

## Related Documents

- [Memory-First Agent Brief](../ideas/memory-first-agent.md) — Original problem statement
- [Design Doc](../design.md) — Overall architecture
- [Roadmap](../ROADMAP.md) — Milestone planning

---

*Approved: 2026-03-01*
