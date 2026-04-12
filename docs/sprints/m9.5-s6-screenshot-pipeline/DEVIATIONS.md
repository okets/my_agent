# Deviations from Plan — M9.5-S6

## DEV-1: Task 5 reworked — curation instructions moved from plug to framework

**Plan said:** Add screenshot curation instruction to `.my_agent/capabilities/desktop-x11/CAPABILITY.md` and to the Working Nina worker prompt.

**Discovered during smoke testing:** `loadCapabilityHints()` in `prompt.ts` only outputs capability name + health status — it never loads the CAPABILITY.md body into the brain's system prompt. Instructions added to CAPABILITY.md were dead weight and never reached the brain.

**Corrected approach:** Created `formatScreenshotCurationDirective()` in `packages/core/src/prompt.ts` as a framework-level directive. Included in `assembleSystemPrompt()` (conversation brain) and `buildWorkingNinaPrompt()` (automation worker). The directive is now architecturally correct — screenshot curation is framework behavior that applies to every image-producing MCP tool, not plug-specific behavior.

**Why:** Also aligns with the "socket vs plug" architectural principle the CTO re-emphasized mid-sprint — the framework provides the socket (generic curation instruction), plugs provide the plug (specific tools). Instructions belonging to the socket should live in the socket layer, not be duplicated per plug.

## DEV-2: Directive rewritten from advisory to imperative

**Plan said:** "When composing your reply... include the most relevant screenshot URL(s) as markdown images... If no screenshot is worth showing, don't include any."

**Discovered during smoke testing:** Despite the directive being present in the brain's system prompt (verified via `/api/debug/brain/prompt`), the brain consistently chose NOT to include screenshots in its replies — even when the user's request clearly warranted one (reading KWrite content).

**Corrected approach:** Rewrote the directive with imperative MUST language, concrete format example (`![description](url)`), and explicit rules (one screenshot, near top of reply, copy URL exactly from tool output). After this change, brain reliably included the screenshot on the first attempt.

**Why:** Framework-level behavioral directives aimed at LLM brains need to be prescriptive, not suggestive. "You MAY X if worth showing" is too easily deprioritized against other pressures (brevity, token cost, uncertainty). "You MUST X" gets followed.

## DEV-3: Four SDK integration bugs discovered during smoke testing

The plan assumed Task 0's SDK source trace fully characterized the runtime shapes. It did not. Bugs discovered only by running the live pipeline:

1. `tool_response` for MCP tools is a **raw content-block array**, not wrapped in `{ content: [...] }`. Added `toContentBlocks()` helper to normalize both shapes defensively.
2. `updatedMCPToolOutput` must **match the tool_response shape** (raw array). Wrapping in `{ content: [...] }` caused double-wrapping downstream when the SDK calls `mapToolResultToToolResultBlockParam`.
3. MCP tool names are **prefixed by the SDK** as `mcp__<server>__<tool>` (e.g., `mcp__desktop-x11__desktop_info`). The plan's `inferSource()` prefix checks assumed raw tool names.
4. The PostToolUse hook's `tool_response` field (the correct SDK field name) sometimes needs defensive handling since the code previously used `tool_result` (wrong name) with no type error thanks to the `unknown` typing.

**Corrected approach:** Added `parseMcpToolName()` to strip the SDK prefix. Fixed `findImageData`, `parseImageMetadata`, `storeAndInject` to handle both wrapped and raw-array shapes. Changed `updatedMCPToolOutput` return shape to raw array. Removed hardcoded `'desktop-x11'` from audit logging (layer violation) — now derives server name from the tool prefix.

**Why:** SDK runtime shapes cannot always be fully inferred from source. Manual smoke testing was essential.

## DEV-4: Task 5 `.my_agent/` file deletion

**Plan said:** Append "Screenshot Display" section to `.my_agent/capabilities/desktop-x11/CAPABILITY.md`.

**What happened:** Section was added, then removed after DEV-1 moved the directive to framework-level. The CAPABILITY.md was reverted to its pre-sprint state.

**Why:** The file never ended up in the committed sprint work because `.my_agent/` is gitignored. The revert was for cleanliness only.
