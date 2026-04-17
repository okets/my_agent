---
sprint: m9.6-s11
title: Template Smoke Fixtures — Follow-Ups
---

# S11 Follow-Ups

## FU-1 — `runSmokeFixture` does not handle exit 2 (SMOKE_SKIPPED)

**Sprint:** S13 (reverify dispatcher wiring)

The installed plug `smoke.sh` scripts exit 2 when the environment can't support the test (no API key, no display, no browser binary). The current `runSmokeFixture` implementation treats any non-zero exit as `{ pass: false }`. Exit 2 should map to a distinct outcome — something like `{ pass: true, skipped: true }` — so the orchestrator doesn't trigger a fix attempt when the environment simply can't verify the capability.

S13 should handle this when wiring `runSmokeFixture` into the dispatcher.

---

## FU-2 — TTS smoke does not validate Ogg magic bytes (templates)

**Sprint:** Template maintenance pass (no specific sprint assigned)

The reference `smoke.sh` in `text-to-audio.md` checks file size > 100 bytes but not Ogg magic bytes. The installed `tts-edge-tts/scripts/smoke.sh` does validate the header. The template could be strengthened to match. Low priority — size check is adequate for liveness.

---

## FU-3 — `multi_instance: false` not read strictly by scanner (yet)

**Sprint:** S15

Four templates now have `multi_instance: false` explicitly. This will matter when S15 tightens `registry.isMultiInstance(type)` to require an explicit field rather than treating absent as false. No action needed until S15.

---

## FU-4 — MCP template stubs need full S14 replacement

**Sprint:** S14

Both browser-control and desktop-control templates contain minimal smoke stubs (detect.sh + server startup check). These are explicitly marked "replace with full S14 implementation." S14 must update both templates with full MCP tool-invocation smoke scripts.

---

## FU-5 — `tts-edge-tts/scripts/synthesize.sh` may output MP3 instead of OGG

**Sprint:** Plug maintenance (no specific sprint assigned)

The `text-to-audio` script contract requires OGG output. The installed `tts-edge-tts/scripts/smoke.sh` was written to check MP3 magic bytes (`ff f3`/`ff fb`) because `edge-tts` outputs MPEG audio regardless of the output filename extension. If confirmed, `synthesize.sh` is non-compliant with the script contract (which mandates OGG, transcoding via ffmpeg if needed). The plug should be updated to transcode to OGG before returning.
