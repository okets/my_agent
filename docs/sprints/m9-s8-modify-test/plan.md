# M9-S8: Modify Test — Hebrew Voice Support

> **Milestone:** M9 — Capability System
> **Design spec:** [paper-trail.md](../../design/paper-trail.md)
> **Prerequisites:** M9-S7 (paper trail, modify flow, session resumption)
> **Status:** Planned
> **Date:** 2026-04-04

---

## Goal

Ask Nina to add Hebrew support to the existing voice capability. She should pick up where she left off — reading the build history, understanding what's installed, making the change, and leaving a paper trail. This validates the full modify loop: detection, context recovery, modification, testing, and traceability.

---

## Tasks

### The Modify Request

| # | Task | Details |
|---|------|---------|
| 1 | Verify starting state | stt-deepgram and tts-edge installed, both healthy. DECISIONS.md exists with initial build entries (from S7 migration) |
| 2 | Request Hebrew support | "I want voice recognition to work in Hebrew too." Verify: brainstorming skill fires, detects existing stt-deepgram, reads DECISIONS.md |
| 3 | Verify context recovery | Nina knows: Deepgram Nova-2 is installed, cloud API, English only. She doesn't ask "what provider do you want?" — she already knows |
| 4 | Verify change type determination | Brainstorming skill classifies this as "configure" (config.yaml change, not a rebuild) |
| 5 | Verify brainstorming writes context | DECISIONS.md gets an entry: "Add multilingual support — user requested Hebrew" BEFORE builder spawns |

### The Builder

| # | Task | Details |
|---|------|---------|
| 6 | Verify session resumption attempted | Executor looks up session ID from the original build job. If alive → resumed with full context. If expired → fresh session reads DECISIONS.md + status-report |
| 7 | Verify builder modifies correctly | Builder changes `language: en` to `language: multi` in config.yaml (or equivalent). Does NOT rebuild from scratch. Does NOT change the provider |
| 8 | Verify test harness passes | Framework runs test after modification → still healthy. Latency reasonable |

### The Paper Trail

| # | Task | Details |
|---|------|---------|
| 9 | Verify DECISIONS.md updated | New entry appended by framework with: change_type: configure, test result, job link |
| 10 | Verify job link works | Follow the link from DECISIONS.md → `.runs/` → deliverable.md with frontmatter (target_path, change_type, etc.) |
| 11 | Verify three levels of detail | DECISIONS.md (summary) → deliverable.md (full detail) → status-report.md (test results). All connected via links |

### End-to-End Verification

| # | Task | Details |
|---|------|---------|
| 12 | Test Hebrew voice note on WhatsApp | Send a voice note in Hebrew → transcribed correctly → brain responds |
| 13 | Test Hebrew recording on dashboard | Record Hebrew speech in dashboard → transcribed correctly |
| 14 | Test English still works | Send English voice note → still transcribes correctly (no regression) |
| 15 | Test medium mirroring | Hebrew voice in → voice out (TTS may not support Hebrew — verify graceful fallback to text) |

### Second Modify (stretch goal)

| # | Task | Details |
|---|------|---------|
| 16 | Request a second change | "Switch the voice to a female voice" (TTS modify). Verify: brainstorming reads tts-edge DECISIONS.md, determines change type, spawns builder |
| 17 | Verify DECISIONS.md accumulates | tts-edge DECISIONS.md now has 2 entries: initial build + voice change. Both with job links |

---

## Iteration Rule

Same as S6: **fix the process, not the instance.** When the modify flow fails, fix generic instructions in the brainstorming skill or builder prompt. Never add "Deepgram uses language: multi for multilingual" as a hint. The agent researches that on its own.

---

## Success Criteria

1. Nina detects existing capability, doesn't ask "what provider?" — she reads DECISIONS.md
2. Change type correctly classified as "configure"
3. Builder modifies config, doesn't rebuild from scratch
4. Session resumption attempted (success or graceful fallback)
5. Test harness passes after modification
6. DECISIONS.md has correct entries with job links
7. Three-level detail chain works (summary → deliverable → status report)
8. Hebrew voice notes transcribe on both channels
9. English voice notes still work (no regression)
10. No provider-specific hints in prompts

---

## Traceability Matrix

| Design Spec Section | Requirement | Task(s) |
|---------------------|-------------|---------|
| Paper Trail §Who Writes | Brainstorming writes strategic context before builder | 5 |
| Paper Trail §Who Writes | Framework writes structured metadata after job | 9 |
| Paper Trail §DECISIONS.md Format | Append-only, most recent first, with job links | 9, 10, 11 |
| Paper Trail §Session Resumption | Try resume, fall back to DECISIONS.md | 6 |
| Paper Trail §Modify Flow | Read DECISIONS.md, determine change type | 2, 3, 4 |
| Paper Trail §Modify Flow | Configure = config.yaml only | 7 |
| Paper Trail §Builder Deliverable | Frontmatter with target_path, change_type | 10 |
| Paper Trail §Links not copies | Job artifacts in .runs/, linked from DECISIONS.md | 10, 11 |
| Capability Design Spec | Test harness validates after modification | 8 |
| Capability Design Spec | Medium mirroring | 15 |
| S4 Iteration Rule | Fix process not instance | Iteration Rule |

---

## Deliverables

- Verified modify flow (detection → context → classification → build → test → paper trail)
- Hebrew voice recognition working on both channels
- DECISIONS.md with accumulated history (≥2 entries)
- Session resumption verified (or graceful fallback documented)
- Sprint review with E2E verification
