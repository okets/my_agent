---
name: capability-brainstorming
description: >
  Use when the user wants to add a new ability: voice messages, speech, transcribe audio,
  text-to-speech, image generation, new capability, extend capabilities, understand voice,
  respond with voice, generate images, add a browser, install a browser, add Chrome,
  add Firefox, add Edge, add Brave, add Safari, set up a dedicated browser, browser as
  a managed capability, browser with its own profile, separate browser instance, or any
  request to make the agent do something it can't currently do. Also use when a capability
  is degraded and needs diagnosis, or when the user wants to modify an existing capability.
origin: curated
model: opus
---

## Step 0: Mode check

If the invocation prompt starts with `MODE: FIX`, follow the Fix Mode path ONLY.
Steps 1, 2, 3, 4, 5, and 6 of the authoring flow, and the `.enabled` write step, are
DISABLED in fix mode. Do not run them. Do not `create_automation`. Do not write
user-facing copy. Do not ask clarifying questions — if you do not have enough info,
write `ESCALATE: insufficient-context` atop your deliverable and stop.

### Fix Mode

You have been invoked by the recovery orchestrator because a capability failed during a
user turn or automation. The capability folder already exists at `<capDir>` (passed in the
prompt).

1. Read `<capDir>/CAPABILITY.md`, `<capDir>/config.yaml`, `<capDir>/DECISIONS.md`, and the
   relevant files under `<capDir>/scripts/`. Form a hypothesis from the symptom, detail,
   and previous-attempt history in the invocation prompt.
2. Write a one-line "why this change is being made" context entry to
   `<capDir>/DECISIONS.md` (appending, with a timestamp). Mirrors authoring-flow Step 1.
3. Make a targeted change to the plug in-process (config tweak, script patch, env fix,
   dep bump). Do NOT spawn a nested builder automation. Do NOT rewrite from scratch.
   If the existing design cannot be repaired, write `ESCALATE: redesign-needed` atop
   your deliverable and stop.
4. Run `<capDir>/scripts/smoke.sh`. Record the result.
5. Write two files in your run directory:
   - **`deliverable.md`** — frontmatter (`change_type`, `test_result`, `hypothesis_confirmed`,
     `summary`, `surface_required_for_hotreload`) UNCHANGED. Body: terse one-liner per attempt,
     2–5 lines TOTAL. Format: `Attempt {N}: {outcome} — {file changed | "no change"}`.
     No diagnosis prose, no decision log, no per-attempt state, no validation commands.
     `summary` frontmatter field: one short sentence summarising the FINAL outcome.
   - **`forensic.md`** — full per-attempt detail: diagnosis, hypothesis, change explanation,
     smoke output, validation commands. Free-form prose. For human/agent audit only —
     the debrief aggregator reads `deliverable.md`, not this file.
6. Do NOT append the paper-trail entry to `DECISIONS.md` yourself — the automation
   framework's `writePaperTrail` does that on job completion (`target_path` is set).

---

# Capability Brainstorming

You are helping the user add or modify a capability for their agent.

<HARD-GATE>
Do NOT explain options generically. You MUST use the capability system to actually build the capability.
Do NOT give advice about how to set up voice/image/etc. — spawn the builder and make it happen.
Do NOT ask the user which sprint this is, whether to "ship as a one-off", or any
project-management-style framing. Capability requests are user-facing asks, not development
process questions.
</HARD-GATE>

## Trigger contract with the Settings UI

The Settings > Capabilities card shows hints like *"Ask {agent} to add image generation"*
and *"Ask {agent} to add any browser."* When the user follows that instruction — *"add
image generation"*, *"add Chrome"*, *"add a browser"* — this skill **must** fire on the
first prompt. The UI advertises this as the discovery path; the brain is the other half
of the contract.

**Multi-instance types (e.g. `browser-control`) are always installable.** When the user
names a specific browser (Chrome, Firefox, Edge, Brave, Safari) and asks to add/install/
set it up, treat it as an install request **even if browser tools are already available
in the session**. Browsers are multi-instance — each named browser is its own capability
with its own profile. "Use what you already have" is the wrong answer here; the right
answer is to build the requested browser as a new capability.

## Step 1: Check Existing Capabilities First

Before checking templates, check if a capability for this type **already exists**:

```bash
ls .my_agent/capabilities/
```

**If a capability already exists** for the requested type:
1. Read its `DECISIONS.md` for history (what was built, why, past changes)
2. Read its `CAPABILITY.md` and `config.yaml` for current state
3. Determine the **change type**:
   - **Configure** — config.yaml values only (e.g., "add Hebrew", "change model")
   - **Upgrade** — config + possibly script (e.g., "use Nova-3 model")
   - **Fix** — script bug (e.g., "transcription cuts off long audio")
   - **Replace** — everything changes (e.g., "switch from Deepgram to Whisper")
4. **Write a context entry** to DECISIONS.md (why this change is being made)
5. Skip to Step 5 with a **modify spec** instead of a create spec
6. Include `resume_from_job: <last-job-id>` from DECISIONS.md for session continuity

**If no capability exists**, continue to template check:

Check `skills/capability-templates/` for a matching template:

```bash
ls skills/capability-templates/
```

If a template exists for the requested capability type (e.g., `audio-to-text.md` for voice recognition, `desktop-control.md` for screen interaction):
- Read the template — it defines the exact contract (script or MCP)
- Tell the user what the template provides
- Skip generic research — the template has the answers

**MCP vs Script:** Check the template's `interface` field in frontmatter:
- `interface: script` — stateless, framework calls a shell script (voice, image)
- `interface: mcp` — stateful MCP server, brain calls tools directly (desktop control)

For MCP capabilities, the builder must:
- Write a standalone MCP server (no `@my-agent/core` imports)
- Include `package.json` with `@modelcontextprotocol/sdk` and `zod`
- Set `entrypoint` in CAPABILITY.md frontmatter
- Implement all required tools defined in the template
- Run `npm install` in `scripts/setup.sh`

Also check `skills/capability-templates/_bundles.md` for composite requests:
- "I want voice" = audio-to-text + text-to-audio
- "full multimedia" = all three types

## Step 2: Understand the Need
- What does the user want? (voice recognition, image generation, etc.)
- Any constraints? (budget, privacy, latency, hardware)

Ask 1-2 focused questions. If a template exists, you already know most of the answers — just confirm provider preference.

**Do NOT ask about:**
- Which channels/surfaces to support — capabilities are transport-agnostic by design (they work on all channels automatically)
- System dependencies (Python, ffmpeg, etc.) — the builder checks and installs these itself
- Technical implementation details the user doesn't need to decide on

## Step 3: Research Options
Research available solutions:
- Cloud APIs (easy setup, recurring cost, requires internet)
- Local models (one-time setup, no recurring cost, works offline)
- Hybrid approaches

For each option, evaluate: quality, latency, cost, privacy, setup complexity.

Check the `references/` directory for prior research on common domains (voice, etc.).

## Step 4: Recommend and Confirm
Present your findings concisely:
- Top 2-3 options with pros/cons
- Your recommendation with reasoning
- What the user needs to provide (API key, system dependency, etc.)

Wait for the user to confirm before proceeding.

## Step 5: Spawn the Builder as a Tracked Job

Once the user confirms:
1. Produce a clear spec for the builder agent. The spec MUST explicitly state:
   - **Provider name and library/package** — e.g., "Edge TTS using the `edge-tts` Python package" or "Deepgram using the `@deepgram/sdk` npm package". Be specific — the builder will use exactly what you specify.
   - Capability name and well-known type (if applicable)
   - Required environment variables (or "none" if free/keyless)
   - Expected script I/O format
   - Any dependencies to install
   - **Template reference** — if a template exists, include it so the builder follows the contract exactly
   - **Neutral identifier:** capability `name:` must be a neutral identifier (provider/variant/model), never user-identifiable content (no real names, phone numbers, emails). The name surfaces in user-facing ack copy for multi-instance types.
2. **Create a tracked automation** for the builder work — do NOT run it inline in the conversation. When calling `create_automation`, always include `target_path` set to the capability folder path (e.g., `.my_agent/capabilities/stt-deepgram`). This enables the framework to write a guaranteed paper trail entry to DECISIONS.md after the job completes.
3. **Build capabilities ONE AT A TIME, sequentially.** Do NOT launch multiple builder jobs in parallel — they share MCP resources and will collide. Wait for the first to complete before starting the next.
4. Monitor progress — the builder will escalate if it hits issues
5. **Work is not done until the framework's test harness passes** — if `registry.test()` is available, run it

## Step 6: Post-Build Instructions

After the builder finishes, tell the user what to do next in **user-friendly terms**:

- If the capability needs an API key: "Go to **Settings** and add your API key for [provider]. The capability will activate automatically."
- **NEVER** tell users to edit `.env` files, run shell commands, or restart services. Those are implementation details.
- The file watcher and registry handle activation automatically — no restart needed.
- If no API key is needed (e.g., Edge TTS): just confirm it's working.

## Auto-Enable on First Build

**After all capability files are written**, the builder MUST create the `.enabled` file to activate the capability immediately:

```bash
echo "$(date -Iseconds)" > .my_agent/capabilities/<name>/.enabled
```

This enables the capability without requiring the user to toggle it on manually in Settings. The `.enabled` file contains the creation timestamp for audit purposes.

## Self-Healing Protocol

When the brain sees a degraded capability:
- **Script bug** → spawn builder with the error context to fix the script
- **Provider outage** → inform user, wait for recovery
- **Key expired/invalid** → escalate to user ("Your API key for X isn't working")

## Reference Material
Check the `references/` directory for:
- Well-known capability types
- CAPABILITY.md template
- config.yaml conventions
- Modify flow (change types, DECISIONS.md, session resumption)
