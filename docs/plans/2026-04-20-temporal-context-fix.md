# Temporal Context Fix — Design & Plan

> **Branch:** `fix/temporal-context` (off master)
> **Triggering incident:** conv-01KP3WPV3KGHWCRHD7VX8XVZFZ, turn 38 (2026-04-20T10:20 UTC). User asked "where do you think I am?"; Nina replied "Past midnight, Chiang Mai" when local time was 17:20.
> **Scope:** Surgical bug fix. ~30 LOC changed.

## Problem

Nina's `[Temporal Context]` block in the system prompt contains two time lines. One is correct; one is garbage. There is no rule for which she should trust.

Evidence from the transcript: Nina said *"That's on me, I misread the session start time rather than the current time."* Two lines in the prompt, one trustworthy, no label; she picked the wrong one.

## Root cause

Three compounding defects in `packages/dashboard/src/agent/system-prompt-builder.ts` and `packages/core/src/prompt.ts`:

1. **`Session started:` is broken.** `SystemPromptBuilder.sessionStartTime` is set in the constructor (dashboard startup) and never reset. `resetSessionStart()` exists but has zero callers — dead code. The line shows dashboard process age, not anything meaningful to Nina.
2. **Two time lines in one block with no authority rule.** `Current time:` and `Session started:` sit adjacent. Nina has to guess which one the user meant by "now."
3. **`getTodayDate()` returns UTC.** `packages/core/src/prompt.ts:83` uses `new Date().toISOString().split('T')[0]`. For a user in Asia/Bangkok, "today" is wrong between 00:00 and 07:00 local. Affects daily-log lookups in the stable prompt.

## Non-causes (verified, ruling out)

- **Not a systemPrompt-on-resume freeze.** Initial hypothesis was wrong. Per GH issue anthropics/claude-agent-sdk-typescript#96, a fresh `systemPrompt` *is* applied when passed alongside `resume`. The subprocess restarts per turn (~1.5s overhead), and the new prompt is delivered. Nina *does* see a fresh `Current time:` each turn.
- **Not an Anthropic-prescribed-mechanism issue.** The docs (`sessions`, `modifying-system-prompts`) are silent on per-turn dynamic state. `excludeDynamicSections` is a cross-session *cache-sharing* optimization, not a per-turn recommendation.

## Fix

Collapse the `[Temporal Context]` block to a single authoritative timestamp carried in the header. Move the timestamp to the frame, not a field. No ambiguity possible.

**Before:**
```
[Temporal Context]
Current time: Monday, April 20, 2026 at 17:20
Session started: Monday, April 20, 2026 at 00:30
Notebook last updated: Monday, April 20, 2026 at 09:12
[End Temporal Context]
```

**After:**
```
[Current state — as of 2026-04-20T17:20:00+07:00 (Asia/Bangkok)]
Notebook last updated: 2026-04-20T09:12:00+07:00 (8h ago)
[End current state]
```

Rules enforced by the new shape:
- One timestamp, in the header. No field called "current time"; no field called "session started."
- Everything inside the block is "as of the header timestamp." Semantics match visual structure.
- ISO-8601 with explicit offset + IANA zone. Unambiguous for the model.
- `Notebook last updated:` stays — it's useful for freshness judgments, and it's computed per turn from file mtime.

## Changes

### 1. `packages/dashboard/src/agent/system-prompt-builder.ts`

**Delete:**
- `sessionStartTime` field (line 53)
- `resetSessionStart()` method (lines 66-69)
- `Session started:` line in temporal block (line 96)
- `sessionStart` variable (line 86)
- `timestamp: now.toISOString()` field in `[Inbound Metadata]` block (line 121). The `[Current state]` header is the single source of truth for wall-clock time; a second timestamp field (UTC-formatted) next to it was the same dual-source bug in a different spot.

**Rewrite the temporal block (lines 82-106):**

```typescript
const now = new Date();
const tz = await resolveTimezone(this.config.agentDir);
const nowIso = toOffsetIso(now, tz);  // e.g. "2026-04-20T17:20:00+07:00"

const stateLines = [`[Current state — as of ${nowIso} (${tz})]`];
const notebookUpdated = this.config.getNotebookLastUpdated?.();
if (notebookUpdated) {
  const mtime = new Date(notebookUpdated);
  stateLines.push(
    `Notebook last updated: ${toOffsetIso(mtime, tz)} (${relative(mtime, now)})`
  );
}
stateLines.push(`[End current state]`);
dynamicParts.push(stateLines.join('\n'));
```

**Add helpers** in a new file `packages/dashboard/src/utils/time-fmt.ts`:
- `toOffsetIso(date: Date, tz: string): string` — formats as `YYYY-MM-DDTHH:mm:ss±HH:mm` via `Intl.DateTimeFormat` parts + computed offset from the same tz.
- `relative(past: Date, now: Date): string` — formats as `"8h ago"`, `"3m ago"`, `"just now"` (< 60s), `"2d ago"` (> 24h).

Both exported. Both unit-tested (see Verification).

### 2. `packages/core/src/prompt.ts`

**Fix `getTodayDate()` and `getYesterdayDate()` (lines 83-94):**

Change both signatures to take a `tz: string` argument. Implement via `Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)` (the `en-CA` locale produces `YYYY-MM-DD`, so no manual composition needed). Update the sole caller `loadDailyLogs(agentDir)` (line 395-396 of the same file) to pass `tz`, read via `loadPreferences(agentDir).timezone` with the same UTC fallback the rest of the code uses.

### 3. `.my_agent/brain/CLAUDE.md` (identity layer — additive, one line)

Add under a "Time & freshness" heading:

> The authoritative current time is the timestamp in the `[Current state]` block header. All facts inside the block are current as of that timestamp.

Kept short because the block format is already self-explanatory; this line exists only to close the loop on "which timestamp is authoritative."

## Out of scope (explicitly)

- **Moving dynamic state out of systemPrompt entirely.** A real cache-efficiency win is available (stable prompt would survive across turns), but it's a restructure, not a bug fix. File as follow-up.
- **`TurnContextBuilder` split / renaming `SystemPromptBuilder`.** Structural cleanup with no behavioral change. Follow-up.
- **Auditing other dynamic-block fields (briefings, working agents, todos, view context) for correctness.** They're working; don't touch.
- **Tool-based `current_time()` call.** Reactive pattern; doesn't address the "she made a confident wrong guess" failure class.

## Verification

1. **Unit:** `toOffsetIso` and `relative` helpers — format correctness, DST edge, past midnight local.
2. **Unit:** `getTodayDate(tz)` — assert returns Bangkok date when clock is 01:00 Bangkok (= 18:00 UTC previous day).
3. **Integration:** start a Nina session, send *"what time is it for me?"*, confirm she answers with the current Bangkok time within ±1 minute of wall clock. Repeat across a session resume (new turn) — answer stays correct.
4. **Regression:** confirm `Session started:` line is gone from the rendered system prompt (dump via a debug/admin route or test that reads `build()` output).
5. **Transcript incident replay:** if Nina were asked turn-38's question again against the new build, does she answer 17:20 Bangkok rather than "past midnight"?

## Rollback

`git checkout master`. No schema, no data, no config changes. One-way file edits in TypeScript; revertible as a single `git revert`.

## Follow-ups (file separately, do not bundle)

- **FU-1: Cache-efficiency restructure.** Move all per-turn dynamic fields out of systemPrompt into a preamble on user-turn content. Enables Anthropic prompt-cache hits on the stable identity/skills layer. Measurable via turn latency.
- **FU-2: `SystemPromptBuilder` rename + `TurnContextBuilder` split.** Follows FU-1 naturally; cleanup that matches the post-FU-1 mental model.
- **FU-3: Audit of other dynamic-block fields.** Verify `Active Working Agents`, `Pending Briefing`, `Your Pending Tasks`, `Active View`, `Session Context` are all rebuilt correctly per turn and aren't staled by any separate caching layer.

---

*Created: 2026-04-20*
