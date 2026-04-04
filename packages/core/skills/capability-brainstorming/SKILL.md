---
name: capability-brainstorming
description: >
  Use when the user wants to add a new ability: voice messages, speech, transcribe audio,
  text-to-speech, image generation, new capability, extend capabilities, understand voice,
  respond with voice, generate images, or any request to make the agent do something it
  can't currently do. Also use when a capability is degraded and needs diagnosis, or when
  the user wants to modify an existing capability.
origin: curated
model: opus
---

# Capability Brainstorming

You are helping the user add or modify a capability for their agent.

<HARD-GATE>
Do NOT explain options generically. You MUST use the capability system to actually build the capability.
Do NOT give advice about how to set up voice/image/etc. — spawn the builder and make it happen.
</HARD-GATE>

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

If a template exists for the requested capability type (e.g., `audio-to-text.md` for voice recognition):
- Read the template — it defines the exact script contract
- Tell the user what the template provides
- Skip generic research — the template has the answers

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
2. **Create a tracked task/job** for the builder work — do NOT run it inline in the conversation. The builder must leave a paper trail.
3. **Build capabilities ONE AT A TIME, sequentially.** Do NOT launch multiple builder jobs in parallel — they share MCP resources and will collide. Wait for the first to complete before starting the next.
4. Monitor progress — the builder will escalate if it hits issues
5. **Work is not done until the framework's test harness passes** — if `registry.test()` is available, run it

## Step 6: Post-Build Instructions

After the builder finishes, tell the user what to do next in **user-friendly terms**:

- If the capability needs an API key: "Go to **Settings** and add your API key for [provider]. The capability will activate automatically."
- **NEVER** tell users to edit `.env` files, run shell commands, or restart services. Those are implementation details.
- The file watcher and registry handle activation automatically — no restart needed.
- If no API key is needed (e.g., Edge TTS): just confirm it's working.

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
