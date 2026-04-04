# External Verification Report

**Sprint:** M9-S7 Universal Paper Trail + Language Autodetect
**Reviewer:** External Opus (independent)
**Date:** 2026-04-04

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Principles §1 — One file (DECISIONS.md), not two | COVERED | `writePaperTrail()` writes to DECISIONS.md only. No CHANGELOG. Retroactive files for stt-deepgram and tts-edge follow format. |
| Principles §2 — Three writers (brainstorming, builder, framework) | COVERED | Brainstorming: SKILL.md Step 1 writes context entry. Builder: definitions.ts instructs reading/writing DECISIONS.md. Framework: `writePaperTrail()` appends structured metadata post-completion. |
| Principles §3 — Links not copies, artifacts stay in .runs/ | COVERED | `writePaperTrail()` generates relative link `../../automations/.runs/{runDirName}/` — artifacts not moved. |
| Principles §4 — Resume when possible, read when not | COVERED | Executor extracts `resume_from_job` via regex, looks up session ID, passes `resume` to `createBrainQuery()`. Falls back silently on failure. See GAP-1 below. |
| Principles §5 — Universal pattern (discriminator via target_path) | COVERED | `writePaperTrail()` returns early if `data.target_path` is absent. Non-artifact jobs skip cleanly. |
| Builder Deliverable Frontmatter | COVERED | definitions.ts adds full frontmatter template: target_path, change_type, provider, test_result, test_duration_ms, files_changed. |
| Post-Completion Hook | COVERED | `writePaperTrail()` called in executor after job completion (line ~353). Parses frontmatter via `parseFrontmatterContent()`, appends structured entry. |
| Session Resumption | PARTIAL | Code present and compiles. See GAP-1 for cross-automation lookup bug. |
| Modify Flow | COVERED | SKILL.md Step 1 detects existing capability, reads DECISIONS.md, determines change type, writes context, passes `resume_from_job`. Reference doc `modify-flow.md` documents change types and spec format. |
| Non-Goals — No schema changes | COVERED | No changes to AutomationManifest, Job, or create_automation. target_path comes from deliverable frontmatter. |
| Non-Goals — No .builds/ subfolder | COVERED | Artifacts stay in .runs/, linked from DECISIONS.md. |
| Language autodetect — STT output language field | COVERED | `audio-to-text.md` template adds optional `language` field to output JSON. Backwards compatible. |
| Language autodetect — TTS language arg | COVERED | `text-to-audio.md` template adds optional `[language]` arg. Backwards compatible. |
| Language autodetect — Framework threading | COVERED | `chat-service.ts`: `transcribeAudio()` returns `{ text, language }`, `synthesizeAudio()` accepts optional `language` param, passes as arg 3 to script. Both `splitAudioUrl` and `audioUrl` paths receive `detectedLanguage`. |

## Test Results

- Core TypeScript: compiles clean (0 errors)
- Dashboard TypeScript: compiles clean (0 errors)
- Capability unit tests: 45 passed, 0 failed, 0 skipped (2 test files)

## Browser Verification

- N/A — no UI changes in this sprint

## Gaps Found

### GAP-1: Session resumption uses wrong automation ID for cross-automation lookups (Medium)

**Location:** `automation-executor.ts` line 213

```typescript
const priorSession = this.config.jobService.getSessionId(
  automation.id,    // <-- current automation's ID
  priorJobId,
);
```

Session IDs are stored in `.sessions/{automationId}.json`. When modifying a capability, the current automation (e.g., "modify-stt-deepgram") has a different ID than the original build automation ("build-deepgram-stt-capability"). Looking up the prior job's session ID under the wrong automation ID will always return `null`.

**Impact:** Session resumption will silently fail and fall back to a fresh session every time for cross-automation modifications. The design spec calls this an optimization, not a requirement ("Session resumption is an optimization, not a requirement. DECISIONS.md is the durable layer that always works."), so the system degrades gracefully. However, the feature as described in the spec would never actually succeed for the primary use case (modify after build).

**Fix:** Either (a) extract the prior automation ID from the job link in DECISIONS.md alongside the job ID, or (b) change `getSessionId()` to search across all automation sidecar files for the given job ID.

### GAP-2: Relative link assumes fixed directory depth (Minor)

**Location:** `automation-executor.ts` line 668

The hardcoded relative link `../../automations/.runs/` assumes DECISIONS.md is always exactly two directories below `.my_agent/`. This works for `capabilities/<name>/DECISIONS.md` but the design spec says "Universal pattern. Any persistent artifact folder gets DECISIONS.md when the agent modifies it." Future artifacts at different depths would get broken links.

**Impact:** No impact now (only capabilities use this), but worth noting for future universality.

### GAP-3: No DECISIONS.md format heading in retroactive entries (Cosmetic)

The retroactive DECISIONS.md files for stt-deepgram and tts-edge follow the spec format correctly and include all required fields. No issue here -- this was initially flagged during review but confirmed correct upon re-reading.

## writePaperTrail Edge Case Analysis

| Scenario | Handling | Correct? |
|----------|----------|----------|
| No frontmatter in deliverable | `parseFrontmatterContent` returns `data: {}`, `target_path` undefined, returns early | Yes |
| Missing optional fields (provider, test_result) | Conditional `if (data.provider)` guards, fields simply omitted | Yes |
| New DECISIONS.md (file doesn't exist) | `mkdirSync` + `writeFileSync` with `# Decisions` header | Yes |
| Existing DECISIONS.md with entries | Finds `\n\n` after header, inserts entry after header (most recent first) | Yes |
| DECISIONS.md with only header, no blank line | `headerEnd === -1`, falls through to `appendFileSync` | Yes, but entry format slightly different (appended at end with extra newlines) |
| `parseFrontmatterContent` throws | Caught by try/catch, logged as warning, non-fatal | Yes |

## Session Resumption Analysis

| Scenario | Handling | Correct? |
|----------|----------|----------|
| `resume_from_job` present in instructions | Regex extracts job ID | Yes |
| `resume_from_job` absent | No match, `resumeSessionId` stays undefined, `createBrainQuery` gets no resume option | Yes |
| Session ID found | Passed as `resume` to `createBrainQuery` | Yes |
| Session ID not found (different automation) | `getSessionId` returns null, falls back to fresh | Yes, but see GAP-1 |
| Session expired at SDK level | SDK handles internally, falls back | Depends on SDK behavior -- not tested |

## Language Threading Analysis

| Step | Implementation | Correct? |
|------|---------------|----------|
| STT returns language | `transcribeAudio()` return type changed to `{ text?, language?, error? }`, reads `result.language` from JSON | Yes |
| Language stored | `detectedLanguage` variable in `sendMessage` scope | Yes |
| TTS receives language | `synthesizeAudio(text, convId, detectedLanguage)` -- third param added | Yes |
| TTS passes to script | `args.push(language)` only when truthy | Yes |
| Both audio paths covered | Both `splitAudioUrl` (streaming split) and `audioUrl` (single message) pass `detectedLanguage` | Yes |
| WhatsApp path | Not threaded (documented in DECISIONS.md D5 as intentional deferral) | Acceptable |

## Verdict

**PASS WITH CONCERNS**

The sprint delivers all spec requirements with clean TypeScript compilation and passing tests. The paper trail system (`writePaperTrail`), builder prompt updates, brainstorming skill modify flow, retroactive DECISIONS.md entries, and language autodetect threading are all correctly implemented.

The primary concern is GAP-1: session resumption will silently fail for its main use case (cross-automation modifications) due to the automation ID lookup mismatch. Since the design spec explicitly treats session resumption as an optimization with a durable fallback, this does not block the sprint, but it should be fixed before M9-S8 validation to ensure the feature works as designed.
