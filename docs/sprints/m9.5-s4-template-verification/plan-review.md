# M9.5-S4: Template & Agent Verification — Plan Review

**Reviewer:** CTO architect session
**Date:** 2026-04-11

---

## Verdict: APPROVED with corrections

10-task plan covers all deferred items, the template, the harness extensions, and the acceptance test. Two corrections required, one structural concern.

---

## Spec Coverage

### S1 Deferred Items

| Item | Plan Task | Status |
|---|---|---|
| Tool schema validation against template contract | Task 3 (tool-contracts.ts + harness wiring) | Covered |
| Functional screenshot test (`desktop_screenshot` + PNG validation) | Task 4 (testMcpScreenshot + inline in testMcpCapability) | Covered |

### S3 Deferred Items

| Item | Plan Task | Status |
|---|---|---|
| Fix dead crash monitoring code | Task 1 (remove spawner instance + crash listener) | Covered |
| Add enabled-gate to factory registration | Task 1 (adds `c.enabled` to `.find()`) | Covered |
| Expand test fixture to all 7 required tools | Task 2 | Covered |

### S4 Own Scope

| Item | Plan Task | Status |
|---|---|---|
| Write `desktop-control.md` template | Task 5 | Covered — comprehensive, 1054 lines |
| Update brainstorming skill with MCP guidance | — | **MISSING** — see C3 |
| Build cleanup/reset script | Task 6 | Covered |
| Build-from-scratch loop (delete → agent builds → harness passes) | Task 7 | Partially covered — see C1 |
| Acceptance test (Nina reads Kwrite) | Task 8 | Partially covered — see C2 |
| User feedback (Nina reflects on tool UX) | — | **MISSING** — see C4 |

---

## Corrections Required

### C1: Task 7 doesn't actually have the agent build from scratch

Task 7 is titled "Build-from-scratch loop" but it only:
1. Backs up the existing capability
2. Deletes it
3. Verifies the scanner reports nothing
4. Restores the backup
5. Runs the harness

That's a restore test, not a build-from-scratch test. The spec says: "Delete desktop capability → ask agent to build it from scratch → test harness must pass → tools must work. Iterate until reliable single-shot."

The actual agent-builds-from-scratch step is missing. Task 7 should:
1. Delete the capability
2. Start a brain session (or use the dashboard) and ask: "I want desktop control"
3. Wait for the brainstorming + builder flow to complete
4. Run the test harness against whatever the agent produced
5. If it fails, examine what went wrong, adjust the template (Task 5), and repeat

This is the core purpose of S4. The plan does the framework prep (Tasks 1-6) well, but the actual verification loop (Task 7) is a placeholder that skips the hard part.

**Fix:** Rewrite Task 7 as the real build-from-scratch loop. It's inherently iterative and can't be fully scripted — the plan should describe the loop structure and success criteria, not pretend it's a 7-step recipe.

### C2: Task 8 acceptance test is framework-level, not agent-level

The acceptance test should be: tell Nina (via dashboard chat) to read the Kwrite document. She uses the desktop tools herself — screenshot, interpret, respond. The plan's Task 8 uses the MCP test client directly to call `desktop_screenshot`, which tests the capability but not the agent's ability to use it.

**Fix:** Task 8 should be a conversation with Nina through the dashboard, not a programmatic test. The developer opens the chat, types "What text is in the open Kwrite document?", and Nina uses the desktop tools to answer. Pass = she reads the correct text. Fail = she can't use the tools or misreads the content.

### C3: Brainstorming skill MCP guidance missing

The design spec says: "Update brainstorming skill with MCP-specific guidance." The plan has no task for this. The `packages/core/skills/capability-brainstorming/SKILL.md` currently only has script-oriented guidance. Without MCP guidance, the brainstorming + builder flow in Task 7 may fail because the skill doesn't know how to build MCP servers.

**Fix:** Add a task (before Task 7) that updates the brainstorming skill with:
- MCP interface awareness (when to use `mcp` vs `script`)
- Reference to `desktop-control.md` template for MCP capabilities
- Builder instructions for MCP: write package.json, standalone server, no framework imports

### C4: User feedback task missing

The design spec says: "After the acceptance test (pass or fail), ask Nina to reflect on the desktop-control tools." The plan has no task for this.

**Fix:** Add a task after Task 8 where the developer asks Nina:
- Which tools did you use?
- Which were confusing or unnecessary?
- What was missing?
- Was coordinate scaling intuitive?
- Would optional tools (OCR, find_element, diff_check) have helped?

Log her responses in DECISIONS.md. If she has actionable feedback, adjust the template.

---

## Observations (non-blocking)

### O1: Tool contract `desktop_screenshot` region param is `string` not `object`

The design spec defines `desktop_screenshot` input as `{region?}` where region is an object with x, y, width, height. The plan's tool-contracts.ts and fixture both define `region` as an optional `string` (e.g., "100,100,500,400"). The template also says `region: z.string().optional()`.

The real S3 capability server uses `region: z.object({ x, y, width, height }).optional()`.

This mismatch means: (a) the test fixture won't match the real server's schema, and (b) if the agent builds from the template, it'll use string regions, while the existing code uses object regions.

Pick one and make it consistent across template, fixture, contract, and real server. The object form is more explicit and type-safe.

### O2: `testMcpScreenshot` is both standalone and inline

Task 4 creates a standalone `testMcpScreenshot()` function AND wires the same logic inline into `testMcpCapability()`. This means the screenshot test runs twice if both are called. The standalone version is useful for direct testing, but the inline version duplicates the connection logic (spawns a second MCP server process).

The inline version should reuse the existing client connection, which it does (Step 5 adds it before the final return inside `testMcpCapability`). The standalone version spawns its own. That's fine — they serve different use cases.

### O3: Reset script doesn't kill orphaned processes

`scripts/reset-capability.sh` deletes the folder but doesn't kill any running MCP server processes that were spawned from that folder. If the dashboard is running with the desktop capability active, deleting the folder doesn't stop the running server. The next session will fail to spawn because the entrypoint no longer exists.

Not a bug (the dashboard should be restarted after reset), but worth noting in the script's output.

---

## Summary

Good framework prep (Tasks 1-6). Template is comprehensive and well-aligned with the spec. But the plan's core purpose — proving the agent can build the capability from scratch — is underspecified. Four corrections: the build loop needs to actually involve the agent (C1), the acceptance test needs to be agent-driven not programmatic (C2), the brainstorming skill needs MCP guidance (C3), and the user feedback step is missing (C4).
