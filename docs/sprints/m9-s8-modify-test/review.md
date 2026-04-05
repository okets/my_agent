# Sprint Review: M9-S8 Modify Test — Hebrew Voice

**Sprint:** M9-S8
**Date:** 2026-04-05
**Reviewer:** Tech Lead (Opus) + CTO live testing
**Verdict:** PASS WITH CONCERNS

---

## Goal

Validate the full modify loop: Nina detects existing capability, reads DECISIONS.md for context, classifies change type, spawns builder with modify spec, session resumption, paper trail updated.

## Result

Paper trail creation works reliably (proven 3 times). Hebrew voice support was added (Nina fixed it inline). The modify flow was not validated — Nina bypassed it entirely by editing files directly.

---

## Success Criteria (from plan)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Nina detects existing capability, doesn't ask "what provider?" | **NOT TESTED** — Nina went inline |
| 2 | Change type correctly classified as "configure" | **NOT TESTED** |
| 3 | Builder modifies config, doesn't rebuild from scratch | **NOT TESTED** — Nina edited directly |
| 4 | Session resumption attempted | **NOT TESTED** |
| 5 | Test harness passes after modification | **PARTIAL** — Nina tested manually, framework harness showed degraded then healthy after fix |
| 6 | DECISIONS.md has correct entries with job links | **PASS** — initial build entries written by executor (3x confirmed) |
| 7 | Three-level detail chain works | **PASS** — DECISIONS.md → job link → deliverable.md |
| 8 | Hebrew voice notes transcribe on both channels | **PASS** — Nina fixed Deepgram config for Hebrew |
| 9 | English voice notes still work | **PASS** — no regression |
| 10 | No provider-specific hints in prompts | **PASS** |

---

## What Was Proven

### Paper Trail (PASS)

The executor's `writePaperTrail()` method works reliably via the regex fallback (`extractTargetPath()`). Proven across 3 clean rebuild cycles:

1. Regex extracts `.my_agent/capabilities/<name>` from automation instructions
2. Executor writes guaranteed DECISIONS.md entry (date, automation name, job link)
3. Builder optionally enriches with provider rationale, alternatives, architecture decisions
4. Three-level detail chain: DECISIONS.md → job link → deliverable.md

### Infrastructure Fixes

| Fix | Impact |
|-----|--------|
| `findById()` reads from disk | Executor gets full instructions (was getting empty string from DB) |
| `extractTargetPath()` regex | Code-guaranteed target_path, no LLM dependency |
| Builder prompt revert | Restored S6-quality CAPABILITY.md (name, interface fields present) |

---

## Known Issues (Unresolved)

### Severity: High

| # | Issue | Description | Impact |
|---|-------|-------------|--------|
| 1 | **Inline fallback** | Nina edits capability files directly instead of using the modify flow (brainstorming skill → tracked job → paper trail). Same as S6 iteration 2. | No paper trail for modifications. Modify flow untested. |
| 2 | **Notifications don't reach user** | `handleNotification` fires correctly (`notify=immediate`, `ci=present`), `ci.alert()` executes, but nothing arrives in the conversation. User must ask about status. | Users don't know when jobs complete. |
| 3 | **No proactive resume after restart** | Dashboard restart kills conversation context. Nina doesn't proactively reach out to continue interrupted work. No heartbeat mechanism. | Mid-task work is silently abandoned. |

### Severity: Medium

| # | Issue | Description | Impact |
|---|-------|-------------|--------|
| 4 | **"Already processing a message" error** | Sending a second voice message while first is streaming throws error. Concurrency guard too aggressive. | Users can't queue voice messages. |
| 5 | **Private data in builder output** | TTS DECISIONS.md contained "Hanan's language environment" — builder absorbed personal context from conversation. | Privacy leak in capability files (gitignored but still concerning). |
| 6 | **Stale running jobs survive restarts** | JSONL records with `status: running` persist from crashed sessions. System prompt shows them as active, confusing Nina. | Nina thinks jobs are running when they're not. |
| 7 | **Stale once:true automation files** | Disabled `.md` files from completed one-off automations remain on disk. | Nina checks for existing automations and finds stale files. |

### Severity: Low

| # | Issue | Description | Impact |
|---|-------|-------------|--------|
| 8 | **Scanner silently skips invalid capabilities** | Missing `name` field → scanner skips with no log. | User gets no feedback when builder writes bad CAPABILITY.md. |
| 9 | **Change type always "unknown"** | Executor's guaranteed entry shows `unknown` because builder doesn't write frontmatter. | Paper trail entry is less informative (but job link provides full detail). |

---

## Architectural Insight: Heartbeat Process

Issues 2 and 3 (notifications, restart resume) share a root cause: Nina is purely reactive. She only acts when the user sends a message. A heartbeat/watchdog process that monitors state changes (job completions, degraded capabilities, interrupted tasks) and proactively triggers `ci.alert()` or `ci.initiate()` would solve both issues and enable the modify flow enforcement (detecting capability folder changes and routing through the brainstorming skill).

---

## Verdict: PASS WITH CONCERNS

The paper trail infrastructure works. The executor guarantees a DECISIONS.md entry for every capability build via code — no LLM compliance required. This is the core deliverable of S7+S8 and it's proven.

The modify flow, notifications, and session resume are blocked by agentic flow gaps that predate this sprint. These need dedicated work (heartbeat process, notification debugging, inline fallback prevention) before the modify E2E can be validated.

### Recommendation

- **Keep S7+S8 code** — paper trail, findById fix, regex extraction, schema field
- **Merge S7+S8 branch together** — they're one logical unit
- **Next sprint:** Address the agentic flow gaps (heartbeat, notifications, inline prevention) before retrying the modify E2E test
