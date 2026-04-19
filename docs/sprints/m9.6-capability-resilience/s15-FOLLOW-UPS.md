# S15 Follow-Ups

## FU-0 — Re-enable tts-edge-tts in production after CTO verifies recovery flow

`tts-edge-tts/.enabled` is absent in production (plug is currently disabled).
S15 test scaffolding copies the plug without `.enabled` — the test correctly
exercises the recovery loop. After the sprint and CTO verification, the decision
to re-enable TTS is CTO's. Do NOT touch the production `.enabled` file from the
sprint. To re-enable later: `touch .my_agent/capabilities/tts-edge-tts/.enabled`.

## FU-1 — Full TTS path collapse (Phase 3)

`synthesizeAudio` is now routed through `CapabilityInvoker` (S15), but the
duplicate TTS synthesis path in `message-handler.ts` and Baileys plugin is still
present. Closes in S18 (Phase 3 "Duplicate TTS path collapse").

## FU-2 — image-to-text and text-to-image installed-plug E2E (future)

No `image-to-text` or `text-to-image` plug is installed in `.my_agent/capabilities/`
at S15 exit. These types have per-type reverifiers (S13) and coverage tests
(S14's static Layer-1 gate), but no installed-plug incident replay. Target: whichever
Phase 3 sprint first installs an image plug.

## FU-3 — FRIENDLY_NAMES → frontmatter migration (Phase 3)

Carried from S14 FU-1. Deferred to S19 or S20.

## FU-4 — reverifyTextToAudio audio format coverage (from D7)

The MP3 header fix in S15 expands the format check to Ogg, WAV, and MP3. If
a future TTS plug produces a different format (e.g., AAC, Opus in container),
the reverifier will need extending. Consider a format-agnostic check (file size
> 0 + exit 0) as a fallback for unknown formats, or a per-plug format contract
in CAPABILITY.md frontmatter.
