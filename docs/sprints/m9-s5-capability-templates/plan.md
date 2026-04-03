# M9-S5: Capability Templates + Test Harness

> **Milestone:** M9 — Capability System
> **Design spec:** [capability-system.md](../../design/capability-system.md)
> **Templates proposal:** [capability-templates-proposal.md](../../design/capability-templates-proposal.md)
> **Status:** Planned
> **Date:** 2026-04-03
> **Context:** S4 failed — Nina gave generic LLM advice instead of using her own capability system. This sprint fixes the root causes and builds the infrastructure for S6 (retry).

---

## Goal

Build the TDD-like expansion point infrastructure: framework-authored templates define script contracts and test harnesses, the registry validates capabilities against them, and the brain has permanent awareness of the system.

**Architecture: we build the sockets, the agent builds the plugs.**

---

## Tasks

### Phase A: Fix Skill Triggering (Root Cause)

| # | Task | Files | Details |
|---|------|-------|---------|
| A1 | Diagnose why brainstorming skill didn't match in S4 | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Check: is `origin` field missing? Naming collisions with `brainstorming` and `brainstorming-techniques` skills? Test skill matching with "I want voice messages" |
| A2 | Fix skill frontmatter | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Add `origin` if missing. Rewrite description with explicit trigger phrases: "voice", "image generation", "speech", "transcribe", "new ability", "extend capabilities" |
| A3 | Test skill activation in isolation | Manual | Send "I want you to understand voice messages" — verify brainstorming skill fires |

### Phase B: Permanent Brain Awareness

| # | Task | Files | Details |
|---|------|-------|---------|
| B1 | Write notebook reference | `.my_agent/notebook/reference/capabilities.md` | Injected into every system prompt via `loadNotebookReference()`. Contains: capability system exists, check templates before building, use brainstorming skill + builder agent, NEVER just explain — DO it |
| B2 | Strengthen CLAUDE.md directive | `CLAUDE.md` | Add explicit imperative to capability section: "When a user requests a new ability, invoke the capability-brainstorming skill immediately. Do not explain options." |
| B3 | Add prompt footer for empty registry | `packages/core/src/prompt.ts` | In `loadCapabilityHints()`, when no capabilities installed, append: "No capabilities installed. If the user asks for one, use the capability-brainstorming skill to create it." |

### Phase C: Capability Templates

Templates are framework code — they define the contract between our integration points and agent-generated scripts.

| # | Task | Files | Details |
|---|------|-------|---------|
| C1 | Create template directory | `skills/capability-templates/` | Framework-authored, public repo, versioned |
| C2 | Write `audio-to-text.md` | `skills/capability-templates/audio-to-text.md` | Script contract: `transcribe.sh <audio-path>` → `{ "text": "..." }`. Input formats: OGG, WebM, WAV, MP3 (script must handle all, transcode if needed). Test contract: fixture audio, validate JSON, check exit codes. Transport-agnostic (no hardcoded channel names). `template_version: 1`. Security restrictions. Known providers |
| C3 | Write `text-to-audio.md` | `skills/capability-templates/text-to-audio.md` | Script contract: `synthesize.sh <text> <output-path>` → `{ "path": "..." }`. Output must be OGG. Test contract: synthesize test phrase, verify file exists and is valid audio. Known providers |
| C4 | Write `text-to-image.md` | `skills/capability-templates/text-to-image.md` | Script contract: `generate.sh <prompt> <output-path>` → `{ "path": "..." }`. Output PNG or JPEG. Test contract: generate test image, verify file exists. Known providers |
| C5 | Write `_bundles.md` | `skills/capability-templates/_bundles.md` | Composite requests: "voice" = audio-to-text + text-to-audio. "full multimedia" = all three |

### Phase D: Test Harness in Registry

| # | Task | Files | Details |
|---|------|-------|---------|
| D1 | Add `test()` method to registry | `packages/core/src/capabilities/registry.ts` | Runs template's test contract against capability's script. Returns `{ status: "ok", latency_ms }` or `{ status: "error", message }` |
| D2 | Add `health` field to Capability type | `packages/core/src/capabilities/types.ts` | New field: `health: "healthy" | "degraded" | "untested"`. `degraded` includes error message |
| D3 | Validate on activation | `packages/core/src/capabilities/registry.ts` | When capability transitions from `unavailable` → env vars present, run test. If passes → `available` + `healthy`. If fails → `available` + `degraded` with error |
| D4 | Validate on startup | `packages/dashboard/src/app.ts` | After initial scan, run tests for all capabilities with env vars. Non-blocking (don't delay startup — run in background, update status when done) |
| D5 | Expose test-on-demand | `packages/core/src/capabilities/registry.ts` | `registry.test(type)` — brain can call to diagnose. Also callable from debug API |
| D6 | Update system prompt with health | `packages/core/src/prompt.ts` | Show health in hints: `audio-to-text (Deepgram STT) [healthy, 1.2s]` or `[degraded: 401 Unauthorized]` |

### Phase E: Builder + Brainstorming Updates

| # | Task | Files | Details |
|---|------|-------|---------|
| E1 | Builder prompt — template precedence | `packages/core/src/agents/definitions.ts` | Add: "When a capability template is provided, the template's script contract takes precedence over generic conventions." |
| E2 | Builder prompt — test harness validation | `packages/core/src/agents/definitions.ts` | Add: "Your work is not done until the framework's test harness passes against your script." |
| E3 | Brainstorming skill — glob for templates | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Step 1: check `skills/capability-templates/` for a matching template. If found, follow it exactly |
| E4 | Brainstorming skill — composite requests | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Check `_bundles.md`. "I want voice" → build both audio-to-text and text-to-audio |
| E5 | Brainstorming skill — self-healing protocol | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | When brain sees degraded capability: script bug → spawn builder to fix, provider outage → wait, key expired → escalate to user |

---

## Verification

- [ ] "I want voice messages" triggers brainstorming skill (A3)
- [ ] Notebook reference appears in system prompt (B1)
- [ ] Empty registry prompt footer appears (B3)
- [ ] Templates exist and contain complete contracts (C2-C4)
- [ ] `registry.test()` runs template test against a dummy script (D1)
- [ ] Health status shows in system prompt (D6)
- [ ] Builder prompt references template precedence (E1)
- [ ] Brainstorming skill globs for templates (E3)
- [ ] TypeScript compiles, existing tests pass

---

## Traceability Matrix

| Design Spec / Review Finding | Requirement | Task(s) |
|------------------------------|-------------|---------|
| Adversary §1 | Skill activation root cause diagnosis | A1, A2, A3 |
| Adversary §3 | Notebook reference in system prompt | B1 |
| Adversary §7 | "NEVER explain — DO it" enforcement | B1, B2, B3 |
| Adversary §2 | Template must specify transcoding responsibility | C2 (all formats required) |
| Adversary §5 | Template vs builder prompt conflict | E1 (template precedence) |
| Adversary §9 | Test all input formats at build time | C2, C3 (test contracts) |
| Adversary §10 | Multi-capability composite requests | C5, E4 |
| Adversary §6 | Validation-on-activation | D3 |
| Advocate §1 | Templates transport-agnostic | C2-C4 (no channel names) |
| Advocate §15 | Template versioning | C2-C4 (template_version: 1) |
| Advocate §11 | MCP absorption gap | Deferred — no MCP template in S5 scope |
| Templates Proposal | Framework-authored script contracts | C1-C5 |
| Templates Proposal | Notebook reference | B1 |
| Templates Proposal | Builder follows template contract | E1, E2 |
| Capability Design Spec | Error handling with health status | D2, D6, E5 |

---

## Deliverables

- Fixed brainstorming skill (triggering + templates + composites + self-healing)
- `notebook/reference/capabilities.md` (permanent brain awareness)
- `skills/capability-templates/` (3 templates + bundles)
- Registry test harness (test, health field, validation-on-activation)
- Updated builder agent prompt (template precedence + test validation)
