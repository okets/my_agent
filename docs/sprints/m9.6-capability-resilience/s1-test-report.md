# S1 Test Report — Raw Media Persistence + CFR Detector

**Branch:** `sprint/m9.6-s1-raw-media-cfr-detector`
**Date:** 2026-04-15
**Commands run:**
```
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run tests/cfr
```

---

## TypeScript Compilation

| Package | Result |
|---------|--------|
| `packages/core` | PASS — zero errors, zero warnings |
| `packages/dashboard` | PASS — zero errors, zero warnings |

---

## Test Results

```
Test Files: 4 passed (4)
Tests:      42 passed (42)
Duration:   3.18s
```

### By File

| File | Tests | Result |
|------|-------|--------|
| `tests/cfr/raw-media-store.test.ts` | 17 | PASS |
| `tests/cfr/cfr-emit-empty-silent-vs-broken.test.ts` | 11 | PASS |
| `tests/cfr/cfr-emit-stt-errors.test.ts` | 12 | PASS |
| `tests/cfr/cfr-emit-deps-missing.test.ts` | 2 | PASS |

No failures. No skipped tests.

**Note on test output noise:** `cfr-emit-deps-missing.test.ts` emits expected stderr during both tests:
- `Calendar credentials not found` — `AppConversationService` initializes CalDAV client; harmless in temp dir.
- `Error: No Anthropic authentication configured` — `SessionManager` attempts to start an SDK session; the test catches this with `try/catch` around `drain()`. The CFR event fires before the session attempt, so both assertions pass correctly.

These are not failures. They are a consequence of the test using a real `AppChatService` instance rather than a lighter stub. See review note in `s1-review.md`.

---

## Coverage Against the Plan's 4 Specified Tests

The plan (§3, Acceptance tests) specifies four acceptance tests. All four are present.

**Test 1: `raw-media-store.test.ts`**
Plan requirement: "save + read-back idempotence, mime→ext mapping exhaustive."

Covered:
- Save + read-back: `saves a buffer and returns an absolute path` (bytes verified with `readFileSync`)
- Idempotence: `is idempotent — second save returns same path without overwrite` (original content preserved)
- `exists()` for saved file, unsaved path, and empty file
- `pathFor()` determinism without file creation
- Mime→ext table: all 10 explicit cases from the plan's extension policy plus `image/gif`, `video/mp4`, `application/pdf`, `application/octet-stream`
- Malformed MIME (no slash) → `.bin` fallback

The plan's extension policy specifies: `.ogg`, `.mp3`, `.wav`, `.jpg`, `.png`, the sub-type of the MIME for others, `.bin` for no-slash. All cases are verified.

**Test 2: `cfr-emit-deps-missing.test.ts`**
Plan requirement: "construct AppChatService with deps = null, call sendMessage with attachments, assert one failure event with symptom === 'deps-missing' and triggeringInput.artifact.rawMediaPath is present and the file exists."

Covered:
- Test 1 asserts: `symptom === "deps-missing"`, `capabilityType === "audio-to-text"`, `artifact.rawMediaPath === rawFilePath`, `artifact.type === "audio"`, `existsSync(rawFilePath) === true`
- Test 2 asserts: exactly one deps-missing event for a non-audio (PDF) attachment, with `capabilityType === "attachment-handler"`

One note: the plan describes a single test case; the implementation ships two. The second is a worthwhile addition that verifies the `detectCapabilityTypeFromMimes` fallback path.

**Test 3: `cfr-emit-stt-errors.test.ts`**
Plan requirement: "stub transcribeAudio to return each error shape; assert the symptom mapping matches failure-symptoms.ts's table."

Covered: The test is a pure-unit test of `classifySttError` (imported from `@my-agent/core`), not a stub-based integration test. This is a valid and more direct approach — it tests the mapping table exhaustively without the overhead of a stub. 12 cases cover:
- All three branches of the "No audio-to-text capability available" error (not-installed / not-enabled / execution-error)
- Generic `Transcription failed:` → execution-error
- `timeout` keyword → timeout
- `ETIMEDOUT` → timeout
- Case-insensitive timeout detection (`TIMEOUT`)
- JSON parse failure → execution-error
- Non-zero exit code → execution-error
- Unknown error shape fallback → execution-error
- `detail` field content for not-installed (full string) and for Transcription-failed (prefix stripped)

The mapping table in `failure-symptoms.ts` is fully exercised.

**Test 4: `cfr-emit-empty-silent-vs-broken.test.ts`**
Plan requirement: "feed {text:'', durationMs:120, confidence:0} → no CFR; feed {text:'', durationMs:1500, confidence:0.9} → CFR with empty-result."

Covered: Both plan-specified cases are present. The test additionally covers:
- Non-empty text → null (short-circuit)
- durationMs = 499, confidence = 0.5 → null (below threshold)
- durationMs = 2000, confidence = 0.1 → null (confidence too low)
- Boundary: durationMs exactly 500 → null (rule is >, not >=)
- Boundary: confidence exactly 0.2 → null (rule is >, not >=)
- durationMs = 501, confidence = 0.21 → empty-result (just above both boundaries)
- undefined durationMs → null (S1 known state)
- undefined confidence → null (S1 known state)
- both undefined → null (S1 default)

Boundary cases at exactly 500ms and 0.2 confidence are correctly tested and correctly implement the spec's strict-greater-than rule.

---

## Coverage Gaps

**No integration test for the full STT error path through `AppChatService`**

Tests 1–4 are unit-level. The STT error branch (`sttResult.error`) in `chat-service.ts:677–692` is not exercised by any test with a real `transcribeAudio` stub returning an error. The plan spec says "stub transcribeAudio to return each error shape" but the implementation tests `classifySttError` directly instead.

This is a reasonable pragmatic choice — `transcribeAudio` involves `execFile` and the full STT script path, which is difficult to stub cleanly. However, the integration gap means a future refactor of `chat-service.ts`'s STT branch could break the wiring without any test catching it.

**Suggested addition (not a blocker for S1 merge, but worth noting for S6):** An integration test in `cfr-emit-stt-errors.test.ts` that mocks `transcribeAudio` at the module level and asserts that `cfr.emitFailure` is called with the right parameters when `sendMessage` processes an audio attachment would close this gap. This is appropriate to do in S6 when the STT contract is being extended with `durationMs`/`confidence` anyway.

**No test for `detectCapabilityTypeFromMimes` edge cases**

The `image/*` → `image-to-text` and `application/*` → `attachment-handler` paths in `detectCapabilityTypeFromMimes` (chat-service.ts:118–126) are exercised only by the second test in `cfr-emit-deps-missing.test.ts` (PDF case). The `image-to-text` path has no test. Minor gap, acceptable for S1.
