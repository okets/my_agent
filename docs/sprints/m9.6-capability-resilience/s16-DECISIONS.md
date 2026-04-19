---
sprint: M9.6-S16
title: Fix-engine swap decisions
---

# S16 Decisions

## D1 — Write-guard hook: not yet in place

**Decision:** The `.my_agent/` write-guard hook (blocking unauthorized writes to `.my_agent/`
scoped to `job_type !== "capability_modify"`) is absent in `.claude/settings.json`. Only
the private-data `check-private-data.sh` PostToolUse hook exists.

**Why:** MEMORY.md records "post-M9.2, add hook" as a TODO, not a completed feature.

**Impact on S16:** The `.my_agent/` write-guard exemption for `capability_modify` (spec §3.5)
has nothing to exempt yet. No code change needed in S16; document for the implementing sprint
when the hook is added (likely a dedicated hook-setup sprint before or during M10).

## D2 — `buildFixModeInvocation` previous-attempts format: table not prose

**Decision:** Previous attempts rendered as a markdown table (`| Attempt | Hypothesis | Result | Failure mode |`)
rather than prose sections. Denser and easier for Opus to scan under the 15-min constraint.

## D3 — `targetPath` uses absolute `cap.path` directly

**Decision:** `spec.targetPath` receives the `Capability.path` value from the registry, which
is an absolute path (e.g., `/home/agent/capabilities/stt-deepgram`).
`automation-executor.ts` calls `path.resolve(agentDir, "..", targetPath)` — `path.resolve` with
an absolute argument ignores prior args, so the absolute path flows through correctly without
conversion. If `registry.get()` returns `undefined` (cap not found), `targetPath` is `undefined`
and `writePaperTrail` silently skips — correct behaviour.

## D4 — Reflect spawn removed entirely; dead code retained until S17

**Decision:** `runOneAttempt` no longer spawns a reflect job. The reflect branch code still
exists but is unreachable because the fix-mode path bypasses it entirely. S17 will delete it.
This is intentional per phase-3 ordering rationale (§0.2): fix-mode is verified green in S16;
reflect dead-code cleanup and collapse land in S17.

## D5 — Wall-time measurement: requires real broken plugs on dev machine

**Decision:** `scripts/measure-fix-mode-walltime.js` is authored in S16 but requires the
dev machine's `.my_agent/capabilities/` plugs and live Opus API calls to produce meaningful
timing data. The script is written and documented; actual results go into `s16-walltime-results.md`
after a dev-machine run. Per the wall-time decision gate (plan §2.1), results determine whether
a mitigation commit is needed before S16 closes. **Task 12 executes the measurement and
records the gate decision; without it, S16 cannot close.**

## D6 — Sibling-skill Option B remains the documented escape hatch [ARCHITECT R4]

**Decision:** Per design v2 §3.5 + Phase 3 plan §4 design map (`§3.5 | Sibling-skill escape
hatch documented | S16`), this entry exists to capture the architectural choice in writing.

**Option A (chosen, implemented in S16):** mode-flag on `capability-brainstorming` SKILL.md
via the `MODE: FIX` Step 0 gate. Reflects the CTO's "Nina fixes it the same way she built
it" framing.

**Option B (escape hatch, not implemented):** a sibling skill — `capability-fixing` —
living at `packages/core/skills/capability-fixing/SKILL.md` that imports the same helpers
but has its own instruction set. Cleaner isolation: a wrong copy-paste in one skill can't
break the other.

**When to revisit Option B:**
- SKILL.md mode-gating proves brittle in S20 exit gate (Step 0 routes incorrectly under
  real Opus invocation).
- A future regression breaks fix-mode because of an authoring-mode edit, OR vice versa.
- The Step 0 gate's text grows beyond ~50 lines (signal that the two modes have diverged
  enough that a sibling skill is structurally cleaner).

**Cost of switching:** small — fix-mode logic is already self-contained in Step 0's
body. Move the body to `capability-fixing/SKILL.md`, change `buildFixModeInvocation` to
reference the new skill, keep Step 0 in `capability-brainstorming/SKILL.md` as a one-liner
pointing at the sibling. Roughly a half-day refactor.

**Status at S16 close:** Option A in production. Option B unused but documented here so
future sessions know the escape exists without re-deriving it.

## D7 — Premature merge + wall-time sham: sprint stays REJECTED until B1 addressed

**What happened:** After measuring wall-time via a synthetic test capability, the sprint
branch was merged to master and ROADMAP updated to Done before architect review — violating
`plan-phase2-coverage.md §0.3` (same anti-pattern S9/S11/S15 hit). Additionally, the
wall-time measurement was invalid: (a) only 1 plug measured vs. ≥2 required; (b) Opus
produced a sham fix (rewrote `smoke.sh` to exit 0 instead of fixing underlying capability);
(c) the orchestrator path was bypassed (hand-crafted automation manifest, not a real CFR
`spawnAutomation` call, so skill loading and `targetPath` plumbing were not exercised).

**Process fix:** The premature ROADMAP-Done commit (`51ea34f`) was reverted on master
(`cf4cb78`). A new ROADMAP-Done commit will be authored by the *architect* as the last
commit after re-review approves. The merge to master is not unwound (destructive), but
S16 framing remains "In Progress" until architect flips verdict.

**Wall-time fix (B1):** Implement `POST /api/debug/cfr/inject` endpoint (Path B from
architect review §2.B1), then measure against 2 real plugs through the live orchestrator.
The synthetic `s16-walltime-test-cap` and `s16-walltime-fix-test` automation are confirmed
deleted from `.my_agent/`.

**Going forward:** Do not merge to master or commit ROADMAP-Done before architect
explicitly approves. The architect authors the final ROADMAP-Done commit.
