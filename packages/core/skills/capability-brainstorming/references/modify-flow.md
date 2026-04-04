# Modify Flow Reference

When a capability already exists and the user wants to change it.

## Change Types

| Type | Example | What Changes | Job Needed? |
|------|---------|-------------|-------------|
| **Configure** | "Add Hebrew support" | config.yaml values | Optional — can be inline |
| **Upgrade** | "Use Nova-3 model" | config + possibly script | Yes — tracked job |
| **Fix** | "Long audio cuts off" | Script bug fix | Yes — tracked job |
| **Replace** | "Switch to Whisper" | Everything — new scripts, config, deps | Yes — tracked job |

## DECISIONS.md

Every capability has a `DECISIONS.md` at its root. Read it before modifying.

### Writing Context Before Builder

Append a context entry BEFORE spawning the builder:

```markdown
## 2026-04-04 — Add multilingual support
- **Change type:** configure
- **Why:** User requested Hebrew support
```

The framework's post-completion hook will add structured metadata (test result, job link) after the builder finishes.

## Session Resumption

Include `resume_from_job: <job-id>` in the modify automation spec. The executor will try to resume the builder's prior SDK session for richer context.

Get the last job ID from the most recent DECISIONS.md entry's **Job:** link.

## Modify Spec Format

```
## Modify Spec
- Target: .my_agent/capabilities/<capability-name>
- Change type: configure
- What to change: <description>
- What to preserve: <what must not break>
- Resume: resume_from_job: <job-id>
- Template: <template-name> (read for current contract)
```
