# Knowledge Lifecycle — Design Spec

> **Status:** Draft v4 — roadmap audit incorporated
> **Author:** CTO + Claude (brainstorming session 2026-03-12)
> **Milestone:** M6.9 (Knowledge Lifecycle)
> **Depends on:** M6.6-S5 (green test suite), M6.6-S3 (fact extraction — replaced by this spec), M6.6-S2 (work loop scheduler)
> **Branch:** TBD (M6.9-S1 + M6.9-S2 + M6.9-S3)

---

## 1. Problem Statement

The M6.6 extraction pipeline writes facts to markdown files but has no lifecycle management. Facts accumulate indefinitely, nothing decays, nothing gets curated, and the system prompt grows unbounded. The agent can't distinguish between "currently in Chiang Mai" (temporal, will change) and "has two daughters" (permanent). All facts are treated identically.

Additionally, the morning prep job writes a briefing silently — the user never sees it. There's no proactive touchpoint where the agent and user align on what's known, what's uncertain, and what needs clarification.

### What We Want

A personal assistant that:
- **Knows the difference** between permanent and temporal facts
- **Curates actively** — proposes storing permanent knowledge with user approval
- **Summarizes naturally** — temporal context lives in daily/weekly/monthly summaries that age out organically
- **Asks when unsure** — during conversation (naturally) and during morning briefs (structured)
- **Enriches the record** — actively seeks specifics during conversation to help downstream extraction
- **Injects surgically** — only what's relevant goes into the system prompt; everything else is searchable

---

## 2. Design Principles

1. **Markdown is source of truth** for knowledge. YAML for machine-written properties. No per-fact database.
2. **Summaries are the decay mechanism.** Temporal facts age out through the rollup chain (daily → weekly → monthly), not through per-fact confidence scores.
3. **Permanent knowledge is curated.** The agent proposes, the user approves. No auto-accumulation of permanent facts.
4. **Injection is surgical.** Only actively relevant context enters the system prompt. Everything else is searchable via `recall()`.
5. **Nina is the intelligence layer.** During conversation, Nina asks for clarification naturally. No per-turn extraction or heuristic classifiers. The model's conversational judgement replaces machinery.
6. **The morning brief is the alignment touchpoint.** Once daily, Nina and the user sync — powered by a strong model (Sonnet/Opus), not Haiku.

---

## 3. Knowledge Architecture

### 3.1 Directory Structure

```
.my_agent/notebook/
├── reference/                        # Permanent knowledge (curated, user-approved)
│   ├── user-info.md                  # Identity, family, birthdays
│   ├── contacts.md                   # People — searchable, NEVER injected
│   ├── standing-orders.md            # Operational rules (existing, stays in current location)
│   └── preferences/
│       ├── personal.md               # Food, lifestyle, hobbies
│       ├── work.md                   # Coding style, tools, process
│       └── communication.md          # Tone, language, formality
│
├── properties/                       # Dynamic metadata (YAML, machine-writable)
│   └── status.yaml                   # location, timezone, availability
│
├── operations/
│   └── current-state.md              # Morning brief output — THE injection point for temporal context
│
├── summaries/                        # Temporal stack (summarized, not raw)
│   ├── daily/YYYY-MM-DD.md           # Daily summary (produced by morning sequence)
│   ├── weekly/YYYY-WNN.md            # Weekly rollup
│   └── monthly/YYYY-MM.md            # Monthly rollup
│
├── daily/                            # Raw daily logs (searchable, not injected)
│   └── YYYY-MM-DD.md
│
├── knowledge/                        # Extraction work queue (NOT indexed, NOT searchable)
│   └── extracted/                    # Staging — deleted after processing
│       └── {conversationId}-{ts}.md
│
└── config/
    └── work-patterns.md              # Job schedules
```

### 3.2 What Gets Injected (System Prompt Layer 4)

```
ALWAYS INJECTED:
  reference/user-info.md                # Who the user is
  reference/standing-orders.md          # Operational rules
  reference/preferences/personal.md     # Lifestyle preferences
  reference/preferences/work.md         # Work preferences
  reference/preferences/communication.md # Communication preferences
  operations/current-state.md           # Morning brief: temporal stack (past + future)
  properties/status.yaml                # Dynamic metadata (location, timezone) — real-time

SEARCHABLE VIA recall() — NEVER INJECTED:
  reference/contacts.md                 # People — looked up on demand
  daily/{date}.md                       # Raw daily logs
  summaries/daily/*.md                  # Past daily summaries
  summaries/weekly/*.md                 # Weekly summaries
  summaries/monthly/*.md                # Monthly summaries

EXCLUDED FROM SEARCH AND EMBEDDINGS:
  knowledge/extracted/*                 # Work queue — deleted after processing
```

### 3.3 Token Budget

| Source | Estimated Size | Cap | Notes |
|--------|---------------|-----|-------|
| `user-info.md` | ~500 chars | 8K | Compact, rarely changes |
| `standing-orders.md` | ~2,000 chars | 8K | Existing |
| `preferences/*` (3 files) | ~1,500 chars total | 8K each | Small, domain-split |
| `current-state.md` | ~2,000 chars | 3K | Hard cap enforced by morning brief prompt |
| `properties/status.yaml` | ~200 chars | N/A | Key-value pairs, minimal |
| **Total injected** | **~6,200 chars** | | Well under 32K reference cap |

If any reference file exceeds 80% of its cap, the morning brief flags it for the user to review and prune.

### 3.4 Prerequisite: Recursive Reference Loading

`loadNotebookReference()` in `packages/core/src/prompt.ts` currently only reads `*.md` files directly in `notebook/reference/` via flat `readdir()` with `.sort()`. It must be updated to recurse into subdirectories (e.g., `reference/preferences/*.md`) using `**/*.md` glob. File ordering after recursion should be deterministic (alphabetical by full relative path). **This is a prerequisite for M6.9-S1.**

**Note:** `standing-orders.md` currently loads via its existing path — it is NOT being moved to `reference/`. The directory tree in Section 3.1 shows it under `reference/` for conceptual grouping only. The injection pipeline continues loading it from its current location.

---

## 4. Extraction Pipeline (Revised)

> **Note:** This spec **replaces** the S3 extraction pipeline entirely. The S3 `parseFacts()`, `persistFacts()`, and the `[FACT]/[PERSON]/[PREFERENCE]` prompt format are superseded by the classification and routing system described below. Existing `knowledge/facts.md`, `knowledge/people.md`, and `knowledge/preferences.md` files are migrated (see Section 9, M6.9-S1 task 16).

### 4.1 Trigger

Unchanged from S3:
- **Idle timeout** — 10 minutes of no messages
- **Conversation inactive** — new conversation replaces the old one

Extraction processes the **full conversation transcript** once, not per-turn. The `lastExtractedAtTurn` guard from S3 is preserved to avoid redundant extraction when no new turns exist.

### 4.2 Post-Extraction: Daily Log Entry

After extraction, the pipeline appends a one-line conversation summary to `daily/{today}.md`:

```markdown
- [conv] Discussed S6 knowledge lifecycle design with CTO (14:30)
```

This ensures the daily log is self-contained for the summary job — no database queries needed.

### 4.3 Classification Prompt

The Haiku extraction prompt classifies and routes each fact:

```
Extract facts from this conversation and classify each one.

CATEGORIES:
[PERMANENT:user-info] — biographical: family, identity, birthdays, personal milestones
[PERMANENT:contact] — people: name, relationship, context, contact details if mentioned
[PERMANENT:preference:personal] — lifestyle: food, music, hobbies
[PERMANENT:preference:work] — professional: coding style, tools, process
[PERMANENT:preference:communication] — interaction: tone, language, formality
[TEMPORAL] — current events: travel, meetings, projects, plans with dates
[PROPERTY:key:confidence] — dynamic metadata: location, timezone, availability
  - confidence: high (explicitly stated) | medium (inferred) | low (vague)

RULES:
- One fact per line
- Include specific dates, full names, amounts when available
- If a fact updates or contradicts an earlier extraction, include it (routing handles dedup)
- If nothing to extract: respond with exactly "NO_FACTS"

EXAMPLES:
[PERMANENT:user-info] Has two daughters, Noa (5) and Maya (3)
[PERMANENT:contact] Kai — tour guide in Chiang Mai, arranged through hotel concierge
[PERMANENT:preference:personal] Loves pad krapao, prefers spicy
[PERMANENT:preference:work] Uses TypeScript, prefers functional patterns over OOP
[TEMPORAL] Series A deal signing Tuesday March 18
[TEMPORAL] Flight to Krabi on March 20, returning to Tel Aviv March 25
[PROPERTY:location:high] Currently in Chiang Mai, Thailand
[PROPERTY:availability:medium] On vacation until late March
```

**First implementation task:** Validate this prompt produces reliable classification by running 10+ diverse conversation samples through Haiku and checking output format and accuracy before building the routing system.

### 4.4 Routing

After extraction, each line is parsed and routed:

| Classification | Destination | Immediate? |
|---------------|-------------|------------|
| `PERMANENT:*` | `knowledge/extracted/{id}.md` (staging) | No — proposed to user in morning brief |
| `TEMPORAL` | Appended to `daily/{today}.md` | Yes — goes to raw daily log immediately |
| `PROPERTY:*` | `properties/status.yaml` | Yes — updated immediately with confidence |

**Permanent facts are never auto-written to reference files.** They sit in staging until the morning brief proposes them and the user approves.

### 4.5 Staging File Format

```markdown
# Extracted: 2026-03-12T14:30:00Z
# Source: conv-abc123 ("Thailand Travel Planning")

## Pending — Propose in Morning Brief
- [user-info, attempts: 0] Has two daughters, Noa (5) and Maya (3)
- [contact, attempts: 1] Kai — tour guide in Chiang Mai, hotel concierge referral

## Routed — Already Applied
- [temporal] → daily/2026-03-12.md: Flight to Krabi on March 20
- [property] → status.yaml: location = Chiang Mai (high)
```

The `attempts` counter tracks how many morning briefs have proposed this fact. After 3 attempts with no response, the fact is removed from the staging file. If all facts in a staging file are resolved (approved, rejected, or expired), the file is deleted.

`knowledge/extracted/` is a **work queue**, excluded from SyncService indexing, search, and embeddings.

---

## 5. Summary Rollup Chain

Temporal facts live in summaries. The rollup chain replaces per-fact decay:

```
Raw daily log → Daily summary → Weekly summary → Monthly summary → (searchable archive)
```

### 5.1 Daily Summary

- **Schedule:** Runs as the first step of the morning sequence (see Section 7)
- **Model:** Haiku
- **Input:** Previous day's raw `daily/{yesterday}.md` (including `[conv]` entries from extraction)
- **Output:** `summaries/daily/YYYY-MM-DD.md`
- **Format:**

```markdown
# Daily Summary — March 12, 2026

## Key Events
- Reviewed M6.6 S3+S4 overnight sprint results with CTO
- Discussed knowledge lifecycle design — major architecture pivot
- Decided on two-phase approach (M6.9-S1 data model + M6.9-S2 behavioral)

## Decisions Made
- Facts split into permanent (curated) vs temporal (summarized)
- Morning brief becomes a conversation, not a background file write
- Contacts are searchable, never injected

## Open Items
- S5 corrections plan written, not yet executed
- S6 design spec in progress
```

### 5.2 Weekly Summary

- **Schedule:** Sunday, as part of the morning sequence
- **Model:** Haiku
- **Input:** All daily summaries since the last weekly summary
- **Output:** `summaries/weekly/YYYY-WNN.md`
- **Format:** Compressed version — key themes, decisions, milestones. ~500 chars.

### 5.3 Monthly Summary

- **Schedule:** 1st of month, as part of the morning sequence
- **Model:** Haiku
- **Input:** All weekly summaries since the last monthly summary
- **Output:** `summaries/monthly/YYYY-MM.md`
- **Format:** High-level narrative — what happened this month. ~300 chars.

### 5.4 Temporal Context Model: Past + Future

The morning brief assembles a two-directional temporal stack in `current-state.md`:

**Past (what happened):**
- Yesterday's summary
- Last 7 days summary (this week)
- Last 30 days summary (this month)

**Future (what's coming):**
- Today — meetings, deadlines, plans (from calendar + daily log)
- This week ahead — upcoming events, milestones
- This month ahead — bigger picture, travel, goals

```markdown
## Today — March 13
- S5 corrections sprint
- No meetings

## This Week Ahead
- Flight to Krabi March 20
- Series A signing Tuesday

## This Month Ahead
- Krabi leg March 20-25
- Return to Tel Aviv March 25

## Yesterday
- Designed S6 knowledge lifecycle with CTO

## Past 7 Days
- Vacation in Chiang Mai since March 8
- M6.6 S3+S4 overnight sprint completed

## Past 30 Days
- Shipped M6.5, started M6.6
- Flew from Tel Aviv to Thailand March 8
```

### 5.5 Decay Through Summarization

No per-fact confidence scores. Temporal facts decay naturally:

| Timeframe | Source | Detail Level | Injected? |
|-----------|--------|-------------|-----------|
| Today / Tomorrow | Raw daily log + calendar → morning brief | Full detail | Yes (via `current-state.md`) |
| Yesterday | Daily summary → morning brief | Condensed | Yes (via `current-state.md`) |
| This week | Weekly summary → morning brief | Key themes | Yes (via `current-state.md`) |
| This month | Monthly summary → morning brief | High-level | Yes (via `current-state.md`) |
| Older | Archived summaries | Compressed | No — searchable via `recall()` |

The further back in time, the more compressed. Facts that matter get reinforced in new conversations and re-extracted. Facts that don't, fade into searchable archives. Summaries are retained indefinitely (disk is cheap).

---

## 6. Dynamic Properties

Machine-writable key-value metadata in YAML format. Properties are the **real-time** layer — always current, always injected.

### 6.1 Why YAML, Not Markdown

Properties are structured, machine-written data (location, timezone, availability). Unlike knowledge files which are human-readable narratives, properties are API-shaped:
- Written by Nina during conversation (real-time updates)
- Written by Haiku extraction (backup/safety net)
- Future: written by mobile app (GPS location), calendar sync (availability)

YAML is the right format for structured, machine-writable data. The `yaml` package already exists in `@my-agent/core`.

### 6.2 Format (`properties/status.yaml`)

```yaml
location:
  value: "Chiang Mai, Thailand"
  confidence: high
  updated: 2026-03-12
  source: "explicit mention in conversation"

timezone:
  value: "Asia/Bangkok"
  confidence: high
  updated: 2026-03-12
  source: "inferred from location"

availability:
  value: "vacation"
  confidence: medium
  updated: 2026-03-10
  source: "mentioned taking time off"
```

### 6.3 Confidence Levels

- **high** — user explicitly stated ("I'm in Chiang Mai")
- **medium** — inferred from context ("timezone inferred from location")
- **low** — old or vague ("mentioned being busy, unclear why")

### 6.4 Update Paths

**Primary: Nina updates during conversation.** When the user says "I just landed in Krabi," Nina updates `status.yaml` immediately via a tool (e.g., `update_property` or `notebook_write`). The entity closest to the information maintains it.

**Backup: Haiku extraction.** If Nina didn't update properties during the conversation (missed it, or it was a passing mention), Haiku extraction catches it and updates `status.yaml`. If details are missing, the extraction routes the fact to staging for the morning brief to clarify.

Both paths write to the same file. Last write wins — always correct because the most recent information is the most accurate.

### 6.5 Properties and the Morning Brief

Properties with `low` confidence or older than a staleness threshold are surfaced in the morning brief as questions:

| Property | Staleness Threshold | Rationale |
|----------|-------------------|-----------|
| `location` | 7 days | Trips end, people move |
| `timezone` | 30 days | Changes with location, less frequently |
| `availability` | 3 days | Status changes rapidly |

The morning brief checks `updated` against these thresholds and asks if the value is still current.

### 6.6 Injection Path

Properties are loaded by a dedicated `loadProperties()` function in the prompt assembly pipeline — separate from `loadNotebookReference()` (markdown) and `loadNotebookOperations()` (markdown). Three loaders, each suited to its data shape:

- `loadNotebookReference()` → markdown reference files
- `loadNotebookOperations()` → markdown operations files (current-state.md)
- `loadProperties()` → YAML properties file

The `loadProperties()` function reads `status.yaml`, formats it as a compact text block for the system prompt:

```
[Dynamic Status]
Location: Chiang Mai, Thailand (high confidence, updated 2026-03-12)
Timezone: Asia/Bangkok (high confidence)
Availability: vacation (medium confidence, updated 2026-03-10)
[End Dynamic Status]
```

When `status.yaml` conflicts with `current-state.md` (e.g., `current-state.md` says "Chiang Mai" but `status.yaml` says "Krabi"), the model should prefer `status.yaml` — it's the real-time source.

---

## 7. Morning Sequence

The centerpiece of the lifecycle. A two-step sequential process triggered once daily.

### 7.1 Schedule

- **Start time:** configurable (default 08:00)
- **Trigger:** Work loop scheduler triggers step 1, waits for completion, triggers step 2

### 7.2 Step 1: Daily Summary (Haiku)

Produces yesterday's summary from the raw daily log:
- **Input:** `daily/{yesterday}.md`
- **Output:** `summaries/daily/{yesterday}.md`
- **Also runs:** Weekly summary (if Sunday), monthly summary (if 1st of month)
- **Duration:** Seconds (Haiku, small input)

### 7.3 Step 2: Morning Brief (Sonnet/Opus)

Runs after step 1 completes. High-judgement synthesis task.

**Input:**
1. `summaries/daily/{yesterday}.md` — fresh from step 1
2. `summaries/weekly/{current-week}.md` — this week's context (if exists)
3. `summaries/monthly/{current-month}.md` — this month's context (if exists)
4. `daily/{today}.md` — anything already logged today
5. `knowledge/extracted/*.md` — staged permanent facts awaiting approval
6. `properties/status.yaml` — current dynamic metadata
7. `reference/user-info.md` — for context on who the user is
8. Calendar data — today's events, upcoming week (from CalDAV integration)

**Output — two artifacts:**

**1. `operations/current-state.md`** — the injection file (hard cap: 3,000 chars):

Contains the past + future temporal stack described in Section 5.4.

**2. Morning brief conversation** (M6.9-S3 — deferred):

In M6.9-S1/M6.9-S2, the morning brief writes `current-state.md` and the approval flow happens when the user next opens a conversation (Nina sees staged facts in her prompt and proposes them naturally).

In M6.9-S3, the morning brief starts a new conversation on the user's preferred channel: scheduler → conversation manager → channel plugin → message sent. This is a new reusable primitive.

### 7.4 Model Selection

```
queryModel(prompt, systemPrompt, model: "haiku" | "sonnet" | "opus" = "haiku")
```

Replaces the current `queryHaiku()` function. Model parameter resolves to the latest version internally — callers never specify version strings. The mapping (e.g., `"haiku"` → `"claude-haiku-4-5-latest"`) lives in one config file, updated once when Anthropic releases a new model family.

### 7.5 Permanent Knowledge Approval Flow

When the morning brief proposes permanent additions:

1. Brief presents staged facts naturally: "You mentioned Kai, a tour guide — shall I add him to your contacts?"
2. User responds: "Yes, and his number is +66..." or "No, don't bother" or ignores it
3. If approved: write to appropriate reference file, clear from staging
4. If rejected: clear from staging, don't re-propose
5. If ignored: increment `attempts` counter in staging file, re-propose next brief (max 3 attempts, then delete from staging)

For **close relationships** (family, business partners), Nina asks for optional enrichment:
> "Shall I note Noa's birthday too? And Maya's?"

For **transient contacts** (tour guides, service providers), just store the basics.

### 7.6 Morning Brief as Reinforcement

The morning brief is a bonus touchpoint, not a replacement for the extraction pipeline. If the user skips a day or ignores the brief:
- Extraction still runs on every conversation
- Temporal facts still flow to daily logs and summaries
- Properties still update via Nina or Haiku
- Staged permanent facts accumulate (max 3 re-proposals, then cleaned up)
- Nothing breaks — the system is self-sufficient without user interaction

---

## 8. Nina's Conversational Behavior

### 8.1 Standing Order: Knowledge Enrichment

Added to `reference/standing-orders.md`:

```markdown
## Knowledge Enrichment

When you encounter important new information during a conversation:
- If it's vague but important, ask for specifics naturally: dates, full names,
  amounts, deadlines. Not because you need them now, but because the extraction
  pipeline processes conversations later and specific facts are more useful.
- Don't interrogate — be natural. Prefer "Tuesday the 18th?" over letting
  "next week" slide when it matters.
- If the user mentions someone new in an important context, get enough detail
  to be useful: "Is that Ben from the investment team, or a different Ben?"
- You are aware that conversations are summarized and facts are extracted
  after they end. Richer transcripts produce better knowledge.
- When the user's location, timezone, availability, or other dynamic status
  changes, update properties/status.yaml immediately. Don't wait for
  background extraction.
```

### 8.2 What Nina Does NOT Do

- Does NOT run extraction mid-conversation
- Does NOT inject a "clarification needed" section into her own prompt
- Does NOT ask questions purely for the extraction pipeline's benefit
- Her clarification behavior is natural and conversational, guided by the standing order

---

## 9. Implementation Phases

### M6.9-S1 — Data Model + Pipeline (infrastructure)

1. **Prerequisite:** Update `loadNotebookReference()` to recurse into subdirectories (deterministic ordering by full relative path)
2. **Prerequisite:** Add `loadProperties()` function for YAML injection (uses existing `yaml` package from `@my-agent/core`)
3. **Prerequisite:** Add path-pattern exclusion support to `SyncService` (currently only excludes dotfiles). Configure `knowledge/extracted/` as excluded.
4. Validate classification prompt (10+ test conversations through Haiku)
5. New extraction parser and router (replaces S3 `parseFacts`/`persistFacts`)
6. Staging area management (write, read, increment attempts, delete)
7. `properties/status.yaml` read/write utilities
8. Post-extraction daily log entry (`[conv]` lines)
9. Daily summary job (revised — runs in morning sequence, reads raw log)
10. Weekly summary job (new — runs Sunday in morning sequence)
11. Monthly summary job (new — runs 1st in morning sequence)
12. Morning prep revision: reads from summary stack + calendar context (via existing `assembleCalendarContext()`), produces past+future temporal context
13. `queryModel()` — model-selectable background queries (replaces `queryHaiku()` in `packages/dashboard/src/scheduler/`). Model param resolves to latest version. All existing dashboard callers updated.
14. Updated injection model in `SystemPromptBuilder` (add `loadProperties()`)
15. Preferences directory split (`reference/preferences/`)
16. Migration script: reclassify existing `knowledge/*.md` → appropriate destinations
17. Update `docs/design.md` Section 4 (Memory System) to reflect new architecture

### M6.9-S2 — Behavioral Layer (user-facing)

1. Morning brief model upgrade (Sonnet/Opus via `queryModel()`)
2. Morning brief reads staging area, proposes permanent facts in `current-state.md`
3. Approval flow: Nina proposes staged facts in conversation, processes user responses
4. Approval retry logic (attempts counter in staging files, max 3, then delete)
5. Standing order for knowledge enrichment behavior
6. Property update tool for Nina (or via existing `notebook_write`)
7. Property staleness thresholds surfaced in morning brief

### M6.9-S3 — Conversation Initiation (deferred)

1. New primitive: scheduler → conversation manager → channel plugin → message sent
2. Morning brief starts a new conversation on user's preferred channel
3. Channel preference configuration

### Tech Debt Notes

- The knowledge enrichment standing order should migrate to a proper skill when M6.8 (Skills Architecture) ships. Account for this in M6.8 planning.
- The morning sequence and summary rollup jobs are hardcoded patterns. When the general responsibility framework ships (M7/M9), these become the first jobs migrated. They serve as good test cases for the framework design.

---

## 10. Data Flow Diagram

```
CONVERSATION (active)
│
│ Nina asks for specifics naturally (standing order)
│ Nina updates properties/status.yaml in real-time
│
▼
IDLE / INACTIVE TRIGGER
│
▼
EXTRACTION (Haiku)
│ Classify each fact: PERMANENT / TEMPORAL / PROPERTY
│ Append [conv] summary to daily/{today}.md
│
├─ PERMANENT ──► knowledge/extracted/ (staging, work queue)
│                    │
│                    ▼
│               MORNING BRIEF reads staging
│                    │
│                    ├─ User approves ──► reference/{appropriate-file}.md
│                    ├─ User rejects  ──► deleted from staging
│                    └─ User ignores  ──► re-propose (max 3x), then delete
│
├─ TEMPORAL ───► daily/{today}.md (immediate)
│
└─ PROPERTY ───► properties/status.yaml (immediate, backup to Nina's real-time updates)

MORNING SEQUENCE (configurable, default 08:00)
│
├─ Step 1: Daily Summary (Haiku)
│   └─ Reads: daily/{yesterday}.md
│   └─ Writes: summaries/daily/{yesterday}.md
│   └─ Also: weekly (if Sunday), monthly (if 1st)
│
└─ Step 2: Morning Brief (Sonnet/Opus)
    └─ Reads: summaries + staging + properties + calendar + user-info
    └─ Writes: operations/current-state.md (past + future temporal stack)
    └─ M6.9-S3: Starts new conversation with user

SYSTEM PROMPT ASSEMBLY (every query)
│
├─ Layer 1-2: Identity + Skills (cached)
├─ Layer 3: Temporal context (time, session)
├─ Layer 4: reference/user-info.md
│           reference/standing-orders.md
│           reference/preferences/*.md         ◄── requires recursive loading
│           operations/current-state.md        ◄── temporal stack (past + future)
│           properties/status.yaml             ◄── real-time, via loadProperties()
├─ Layer 5: MCP tools (recall, remember, etc.)
└─ Layer 6: Inbound metadata + session context

For current dynamic state (location, availability), the model prefers
properties/status.yaml over current-state.md when they conflict —
status.yaml is the real-time source.
```

---

## 11. Resolved Design Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Summary retention | Keep indefinitely — disk is cheap, searchable via recall |
| 2 | Properties auto-decay | No auto-decay. Staleness thresholds per property type trigger morning brief questions |
| 3 | Morning brief channel | M6.9-S3 scope. M6.9-S1/M6.9-S2: approval happens in next user conversation |
| 4 | Staging cleanup | Delete staging files when all facts resolved. No archive directory |
| 5 | Existing data migration | Automated reclassification script using the new classification prompt |
| 6 | Daily summary timing | Eliminated 23:00 job. Summary runs as step 1 of morning sequence |
| 7 | YAML vs markdown for properties | YAML — future-proofed for mobile app, calendar sync. Dedicated `loadProperties()` loader |
| 8 | Model versioning | `queryModel("haiku"/"sonnet"/"opus")` — no hardcoded version strings |
| 9 | Roadmap placement | New milestone, not M6.6 |
| 10 | Standing order → skill migration | Noted for M6.8 planning |
| 11 | SyncService exclusion for staging | Add path-pattern exclusion support (new capability), not just config |
| 12 | `standing-orders.md` location | Stays in current location. Directory tree is conceptual grouping only |
| 13 | Rejection tracking in approval flow | Nina removes line from staging via tool call. Implementation detail for M6.9-S2 sprint |
| 14 | `queryModel()` package location | Lives in `packages/dashboard/` alongside existing `queryHaiku()` |
| 15 | Calendar data in morning brief | Reuse existing `assembleCalendarContext()`. Wire into morning prep job |

---

*Created: 2026-03-12*
*Revised: 2026-03-12 — incorporated 17 first-review + 5 second-review findings*
