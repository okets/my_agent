# M9.5-S4: Decisions Log

## D1: Build-from-scratch loop results

**Date:** 2026-04-11
**Task:** Task 7 — Agent builds capability from template

### Flow

1. Deleted existing desktop-x11 capability via `scripts/reset-capability.sh`
2. Restarted dashboard — registry confirmed 3 capabilities (no desktop-control)
3. Opened dashboard chat, sent "I want desktop control"
4. Nina initially thought she still had it (memory confusion — see D2)
5. Corrected Nina, she activated capability-brainstorming skill
6. Brainstorming skill found `skills/capability-templates/desktop-control.md`, presented build plan
7. Confirmed, Nina spawned capability-builder automation
8. Builder completed 18/19 steps — hit a CAPABILITY.md path validation bug (step 19)
9. Nina force-accepted, verified detect.sh and server smoke test manually
10. Enabled capability, restarted dashboard
11. **Test harness passed: Desktop Control (X11) [healthy, 2.3s]**

### Iterations needed: 1

The builder produced a working capability on the first try. The template was sufficiently prescriptive.

### Issues found

1. **Validator path bug** — builder's step 19 couldn't find CAPABILITY.md despite it existing. Likely a working directory mismatch in the validation step. Non-blocking — the file was correct.
2. **No `.enabled` file created** — builder didn't write the `.enabled` file. Had to be created manually. The template should mention this, or the builder flow should auto-enable on first build.

### Template adequacy

Nina's assessment: "No real design decisions to make — the template is prescriptive down to the file structure, tool schemas, and test contract. The only variable was which platform, and that's X11."

This confirms the template provides enough detail for single-shot reliable builds.

## D2: Nina's memory confused capability state

When the capability was deleted but Nina's memory still recalled having desktop tools, she responded "That's already available" instead of activating the brainstorming skill.

**Root cause:** The system prompt lists available capabilities but doesn't explicitly say what's NOT available. Nina's memory fills in the gap incorrectly.

**Potential fix for future:** Add negative capability hints to the system prompt (e.g., "Desktop control: not installed — use brainstorming skill if requested"). Low priority — this only matters for rebuild testing, not normal user flows.
