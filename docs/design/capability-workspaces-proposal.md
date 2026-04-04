# Capability Workspaces Proposal

> **Status:** Proposal
> **Date:** 2026-04-04
> **Context:** M9-S6 revealed that capabilities are "write-once" — Nina creates them but can't modify, configure, or trace their history. Users requesting changes (e.g., "add Hebrew support") hit a dead end.

---

## Problem

Capabilities are currently script folders with no development history:

```
.my_agent/capabilities/stt-deepgram/
├── CAPABILITY.md        # Manifest
├── config.yaml          # Settings
└── scripts/
    └── transcribe.sh    # Implementation
```

The builder's paper trail lives separately in `.my_agent/automations/.runs/build-deepgram-stt-capability/` — disconnected from the capability. When Nina needs to modify a capability, she has no history, no decisions log, and no modify flow.

### Specific gaps

1. **No modification flow.** Brainstorming skill only creates — "capability already exists" is a dead end.
2. **No decisions history.** Why was Deepgram chosen over Whisper? What was tried? Lost in a disconnected job folder.
3. **No development log.** If Nina fixes a bug in a script, there's no record of what changed or why.
4. **No configuration flow.** "Add Hebrew support" requires editing config.yaml — no skill or tool supports this.
5. **Paper trail is disconnected.** Job artifacts in `.runs/` reference capabilities by name but aren't colocated.

---

## Proposal: Capabilities as Tracked Workspaces

### New folder structure

```
.my_agent/capabilities/stt-deepgram/
├── CAPABILITY.md          # Manifest (unchanged)
├── config.yaml            # Settings (unchanged)
├── scripts/
│   └── transcribe.sh      # Implementation (unchanged)
├── references/            # Optional docs (unchanged)
├── DECISIONS.md           # Why this provider, what was evaluated
├── CHANGELOG.md           # Append-only log of modifications
└── .builds/               # Builder job artifacts (moved from .runs/)
    ├── initial/           # First build
    │   ├── deliverable.md
    │   └── status-report.md
    └── modify-001/        # First modification
        ├── deliverable.md
        └── status-report.md
```

### Key changes

**1. Builder writes DECISIONS.md on creation**

When the capability-builder creates a new capability, it also writes a DECISIONS.md capturing:
- Provider choice rationale (why Deepgram over alternatives)
- Template contract followed
- Dependencies installed
- Test results from initial build

**2. Brainstorming skill supports modify**

The brainstorming skill's Step 1 changes from "check for template" to:

```
Step 1: Check existing capabilities
- If a capability for this type already exists:
  - Read its DECISIONS.md and CHANGELOG.md for context
  - Determine if this is a configure (config change), upgrade (new feature),
    or replace (different provider) request
  - Spawn builder with a MODIFY spec, not a CREATE spec
- If no capability exists:
  - Check templates and proceed with creation flow (current behavior)
```

**3. Builder supports modify specs**

The builder prompt accepts a modify spec:

```
## Modify spec
- Capability: stt-deepgram (at .my_agent/capabilities/stt-deepgram/)
- Change type: configure
- Request: "Add multilingual support"
- Read DECISIONS.md for context before making changes
- After changes: append entry to CHANGELOG.md, update DECISIONS.md if needed
- Run test harness to verify nothing broke
```

**4. CHANGELOG.md format**

Append-only, most recent first:

```markdown
## 2026-04-04 — Add multilingual support
- Changed `language: en` to `language: multi` in config.yaml
- Deepgram Nova-2 supports automatic language detection
- Tested: Hebrew and English voice notes both transcribe correctly

## 2026-04-04 — Initial build
- Provider: Deepgram Nova-2
- Created by capability-builder job job-73438260
```

**5. Job artifacts colocated**

Builder job output goes to `.builds/` inside the capability folder instead of `.my_agent/automations/.runs/`. The automation system still tracks the job — but the deliverable and status report are written to the capability's workspace.

---

## Modification Types

| Type | Example | What changes |
|------|---------|-------------|
| **Configure** | "Add Hebrew" | config.yaml values |
| **Upgrade** | "Use Nova-3 model" | config.yaml + possibly script |
| **Fix** | "Transcription cuts off long audio" | script bug fix |
| **Replace** | "Switch from Deepgram to Whisper" | Everything — new scripts, new config, new deps |

The brainstorming skill determines the type and adjusts the builder spec accordingly. Configure and fix are lightweight (no new job needed — could be inline). Upgrade and replace are heavier (tracked job with paper trail).

---

## Template Changes

Templates should document configurable parameters:

```markdown
## Configurable Parameters (config.yaml)

| Key | Default | Description |
|-----|---------|-------------|
| language | multi | Language code or "multi" for auto-detect |
| model | nova-2 | Deepgram model name |
| smart_format | true | Apply smart formatting (punctuation, etc.) |

Changing these parameters does not require rebuilding the capability.
The framework rescans config.yaml on capability change events.
```

---

## Migration

Existing capabilities (stt-deepgram, tts-edge) would get:
1. DECISIONS.md retroactively written from the existing job status reports
2. CHANGELOG.md with an "Initial build" entry
3. Job artifacts moved from `.runs/` to `.builds/` inside the capability folder

---

## Impact

- **Brainstorming skill**: Major update — add modify detection and spec generation
- **Builder prompt**: Minor update — accept modify specs, write CHANGELOG.md
- **Automation system**: Minor — job output path changes to capability's `.builds/`
- **Templates**: Minor — add configurable parameters section
- **Framework code**: None — all changes are in skills, prompts, and conventions
