---
sprint: m9.6-s18
---

# M9.6-S18 Decisions

## D1 — reverifyTextToAudio format strategy: option (a) strict Ogg

**Chose:** Option (a) — strict Ogg only. Removed MP3/WAV/ID3 checks from `reverifyTextToAudio`.

**Why:** S11-FU-5 (Task 3 this sprint) fixes `tts-edge-tts/scripts/synthesize.sh` to transcode to real Ogg/Opus via ffmpeg. With the plug compliant, reverifier strictness is correct. If future plugs output other formats, they must transcode at the plug side — this is the template contract. Architect confirmed (a) over (b) at plan-review time.

**Risk logged:** if ffmpeg is absent on a machine running tts-edge-tts, the transcode fails and the plug emits CFR. Acceptable — CFR is the correct response to a missing dependency.
