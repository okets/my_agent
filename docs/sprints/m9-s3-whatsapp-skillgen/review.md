# M9-S3: External Verification Report

> **Sprint:** M9-S3 — WhatsApp Voice + Skill Generation
> **Reviewer:** External (Claude Opus 4.6)
> **Date:** 2026-04-01
> **Branch:** Current (1 commit: `467b212`)
> **Verdict:** PASS with one noted gap (Task 36)

---

## 1. Build & Test Results

| Check | Result |
|-------|--------|
| `packages/core` — `npm run build` | Clean |
| `packages/dashboard` — `tsc --noEmit` | Clean |
| `packages/dashboard` — `vitest run` | 895 passed, 16 failed (pre-existing `desktop-server.test.ts`), 8 skipped |
| Session-manager-skills tests | 3/3 pass (fixed by adding `coreAgents` mock) |

No new test failures introduced by this sprint.

---

## 2. Spec Coverage — Traceability Matrix Walkthrough

### WhatsApp Voice Integration

| Row | Requirement | Task | Verdict | Notes |
|-----|-------------|------|---------|-------|
| Framework Reactions > Channels — Voice notes transcribed | 24, 25 | PASS | `audioMessage` detected, downloaded via `downloadMediaMessage()`, saved to temp, transcribed via `onAudioMessage` callback, passed to brain with `[Voice note]` prefix. Callback design keeps plugin decoupled from registry. |
| Framework Reactions > Channels — Voice replies when input was audio | 26 | PASS | `sendAudio()` method added. Message handler checks `isVoiceNote` flag, calls `sendAudioViaTransport`, falls back to text on failure. PTT flag set correctly (`ptt: true`, `mimetype: audio/ogg; codecs=opus`). |
| Error Handling — Don't silently drop failed scripts | 27 | PASS | Three error paths covered: (1) download failure -> `[Voice note received — failed to download audio]`, (2) transcription failure -> `[Voice note received — transcription failed: <reason>]`, (3) no capability -> `[Voice note received — no transcription capability configured]`. |
| Error Handling — Pass failure context to brain as text | 27 | PASS | All error strings are passed as `content` in the `IncomingMessage`, which reaches the brain. |
| Medium Mirroring — Audio in -> audio out (channel-level) | 26 | PASS | Message handler checks `first.isVoiceNote` and attempts voice reply via `sendAudioViaTransport` before falling back to text. This is channel-level logic, not brain logic. |

### Capability Builder Agent

| Row | Requirement | Task | Verdict | Notes |
|-----|-------------|------|---------|-------|
| Skill Generation > Skill 2 — AgentDefinition with model: opus | 32 | PASS | `model: 'opus'` set in `coreAgents['capability-builder']`. |
| Skill Generation > Skill 2 — Tools: Read, Write, Edit, Bash, Glob, Grep | 32 | PASS | Exactly these 6 tools listed. |
| Skill Generation > Skill 2 — Spawned by brain via Task tool | 33 | PASS | Added to session manager's `agents` map: `"capability-builder": coreAgents["capability-builder"]`. Brain can spawn via Task tool. |
| Skill Generation > Skill 2 — Subagent avoids mid-session model switch | 32 | PASS | Builder is defined as a separate `AgentDefinition` with its own model. Brain stays on its own model. |
| Trust Model — Autonomous for file writes | 32 | PASS | Prompt says "You MAY write/modify any file inside the capability folder". |
| Trust Model — Ask before install.sh | 32 | PASS | Prompt says "You MUST ask before running install.sh". |
| Trust Model — Ask before deleting capability | 32 | PASS | Prompt says "You MUST ask before deleting a capability folder". |
| Escalation Contract — Fix bugs autonomously | 32 | PASS | Prompt: "Script bug -> fix it yourself". |
| Escalation Contract — Escalate for auth errors, signup, 3-attempt limit | 32 | PASS | All three cases documented in prompt: auth error, signup/payment, 3-attempt limit. |
| CAPABILITY.md Format — Keep under 2k words, use references/ | 32 | PASS | Prompt: "Keep under 2000 words. Move detailed docs to references/." |
| Directory Convention — config.yaml conventions | 32, 35 | PASS | Builder prompt covers config.yaml. Reference file `capability-template.md` includes config.yaml template. |

### Brainstorming Skill

| Row | Requirement | Task | Verdict | Notes |
|-----|-------------|------|---------|-------|
| Skill Generation > Skill 1 — Brainstorming skill in .my_agent/.claude/skills/ | 34 | PASS | `SKILL.md` exists at `.my_agent/.claude/skills/capability-brainstorming/SKILL.md`. Frontmatter has `model: opus`. |
| Skill Generation > Skill 1 — Triggered on new capability request | 34 | PASS | Description: "Research and plan new capabilities when the user asks for a new ability". Step-by-step process: understand need, research, recommend, spawn builder. |
| Skill Generation > Skill 1 — Prior art reference material | 35 | PASS | Three reference files: `voice-evaluation.md` (STT/TTS comparison), `well-known-types.md` (capability types table), `capability-template.md` (CAPABILITY.md + config.yaml templates). |

### Model Switch UX

| Row | Requirement | Task | Verdict | Notes |
|-----|-------------|------|---------|-------|
| Model Switching — Visible "Switching to Opus" message | 36 | **PARTIAL** | No programmatic chat message injection exists. The brainstorming SKILL.md instructs the brain to *say* "Switching to Opus for capability work" (Step 4), but the spec says this should be a system-injected chat message. See Gap Analysis. |
| Model Switching — Visible "Back to Sonnet" message | 36 | **PARTIAL** | Same as above. SKILL.md tells brain to say "Back to Sonnet", but no code injects it. |
| Model Switching — Broadcast model_changed | 37 | PASS | `SubagentStart`/`SubagentStop` hooks on "capability-builder" call `broadcastModelChange()`, which broadcasts `{ type: "model_changed", model }` to all WebSocket clients via `sharedConnectionRegistry`. |

---

## 3. Gap Analysis

### GAP-1: Task 36 — No Programmatic Chat Message Injection (Low severity)

**What the spec says:** "Send a visible message in chat: 'Switching to Opus for capability work'" and "'Back to Sonnet'" — these should be injected as system messages.

**What was implemented:** The brainstorming SKILL.md instructs the brain to say these phrases as part of its response (Step 4: "Tell the user: 'Switching to Opus for capability work'"). No `chat-service.ts` file exists (the plan's target file was aspirational).

**Impact:** Low. The user will still see the messages because the brain is instructed to say them. The difference is:
- Spec: deterministic system message, always appears
- Implementation: brain is *instructed* to say it, which is probabilistic (LLM may rephrase)

**Recommendation:** Acceptable for now. The `SubagentStart`/`SubagentStop` hooks (Task 37) already fire reliably. A future sprint could inject a system chat message from those hooks alongside the WebSocket broadcast. The current approach is pragmatic — the brain saying it + the status bar updating via WebSocket covers the user experience.

### No Other Gaps Found

All other traceability matrix rows are fully implemented. The implementation is clean and well-structured:
- WhatsApp plugin stays decoupled via callbacks (good architecture decision)
- Error handling covers all three failure modes (download, transcription, no capability)
- Voice reply has graceful text fallback
- Temp files are cleaned up (best-effort)
- Builder agent prompt is generic (no provider-specific knowledge, as required)
- Reference material is correctly separated from the skill process

---

## 4. Skill Files Verification

```
.my_agent/.claude/skills/capability-brainstorming/
  SKILL.md                          (2034 bytes)
  references/
    capability-template.md          (601 bytes)
    voice-evaluation.md             (1308 bytes)
    well-known-types.md             (660 bytes)
```

All files present and populated with correct content.

---

## 5. Code Quality Notes

**Positive:**
- Clean callback decoupling between WhatsApp plugin and capability registry
- `isVoiceNote` flag on `IncomingMessage` is cleaner than string parsing (good decision, documented in DECISIONS.md)
- SubagentStart/SubagentStop hooks are the right integration point for model broadcasts (verified these are real SDK hook events)
- Voice reply falls back to text gracefully when TTS fails or is unavailable
- `coreAgents` mock added to existing test to prevent false failures

**Minor observations:**
- The `onSendVoiceReply` callback on the WhatsApp plugin is not called directly by the plugin itself — it is called by the message handler via `sendAudioViaTransport`. This indirection is fine (keeps the plugin transport-agnostic) but the naming could be clearer in future.
- The `wireAudioCallbacks` function in `app.ts` uses `execFileAsync` with a 30-second timeout for both STT and TTS scripts. This is reasonable for most providers but may need tuning for local models on slow hardware.

---

## 6. Summary

| Area | Status |
|------|--------|
| WhatsApp voice (Tasks 24-27) | PASS |
| Capability builder agent (Tasks 32-33) | PASS |
| Brainstorming skill (Tasks 34-35) | PASS |
| Model switch UX (Tasks 36-37) | PARTIAL — broadcast works, chat messages delegated to skill instructions |
| TypeScript compilation | Clean |
| Tests | No new failures |
| Decisions documented | Yes (5 decisions in DECISIONS.md) |

**Overall: PASS.** The sprint delivers all four deliverables. The one partial item (Task 36) has a working alternative implementation via skill instructions + WebSocket broadcast, with low user-facing impact.
