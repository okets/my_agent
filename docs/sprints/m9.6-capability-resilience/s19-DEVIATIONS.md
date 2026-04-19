---
sprint: M9.6-S19
---

# S19 Deviations

## DEV-1: `failure_type` write-callsite differs from plan v0 implied location

**Plan implied:** "message-handler sets failure_type when sending text-fallback after TTS failure."

**Actual:** `appendTurn` is not called in message-handler.ts. Write-callsite is `chat-service.ts:~931`, inside the streaming loop's post-completion block.

**Impact:** None. The behavior is correct. D3 in DECISIONS.md documents the root cause (plan predated S18 path collapse).

## DEV-2: `image-to-text.md` capability template does not exist

**Plan:** Step 1c listed 6 template files to update with `friendly_name`.

**Actual:** `skills/capability-templates/image-to-text.md` does not exist in the repo. Only 5 templates were updated: `audio-to-text.md`, `text-to-audio.md`, `text-to-image.md`, `browser-control.md`, `desktop-control.md`.

**Impact:** Minimal. The `FRIENDLY_NAMES` hardcoded table still provides a fallback for any `image-to-text` capability. When the template is created in a future sprint, it should include `friendly_name:`.

## DEV-3: `register()` method added to `CapabilityRegistry`

**Plan:** Did not mention adding a public `register()` method.

**Actual:** Test stubs for `registry-friendly-name.test.ts` called `registry.register()` to add test capabilities. Only `load()` existed. A public `register()` method was added as a test-harness convenience — additive only, no existing API changed.
