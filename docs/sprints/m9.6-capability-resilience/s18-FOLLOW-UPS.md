---
sprint: m9.6-s18
---

# S18 Follow-Ups

## §0.1 universal-coverage rule

S18 removes the duplicate Baileys synthesis path — no new generic layer added.
The §0.1 rule is technically N/A. The four §0.5 Phase 2 deferrals all apply
uniformly to TTS plugs through the existing CapabilityInvoker gate.

## Inherited deferrals — landing confirmation

All §0.5 Phase 2 deferrals confirmed landed:
- S10-FU-2 / S13-FU-1: bash wrapper removed from `reverifyAudioToText` ✓
- S11-FU-2: template smoke (`text-to-audio.md`) validates OggS magic bytes ✓
- S11-FU-5: `tts-edge-tts` transcodes to Ogg/Opus via ffmpeg ✓
- S15-FU-4: `reverifyTextToAudio` Ogg-strict (option a per architect confirmation) ✓

## D2 follow-up (Reverifier type tightening)

Target: S20 per D2. The `invoker?` optional type in `Reverifier` and `dispatchReverify`
needs to be made required. Natural place: S20 final exit gate cleanup pass.
Watch for it in S19/S20 plan reviews.

## Out-of-scope items noticed during the sprint

None noticed. Sprint stayed within its defined scope.
