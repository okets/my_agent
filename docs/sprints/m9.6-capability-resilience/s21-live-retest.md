# M9.6-S21 Live Retest Report

**Date:** 2026-04-21

---

## Test 1 — Config Disabled (`.enabled` removed)

**Scenario:** Voice message sent over WhatsApp with both `stt-deepgram` and `tts-edge-tts` plugs disabled via `.enabled: false`.

### Execution Score: 8/10

Both plugs recovered correctly without data loss or hang. BUG-1 through BUG-5 resolved. The system did what it was supposed to do.

**What worked:**
- STT failed → "hold on" ack sent to WhatsApp → plug fixed → voice message transcribed → Nina answered correctly
- TTS failed → plug fixed autonomously in the background → subsequent replies delivered as audio
- Background job card visible in WebUI throughout

**What cost the 2 points:**
- TTS fix took noticeable time with no user-facing signal until after resolution.

### Clarity / Transparency Score: 6/10

**Issue — TTS ack sequencing:**

For STT, the "hold on" ack arrives *before* Nina answers. For TTS, the sequence was inverted:

1. STT recovered → Nina answered as text (correct, TTS still broken)
2. TTS fix automation ran in background
3. "Hold on, fixing…" ack arrived on WhatsApp *after* Nina's text response

This reads as noise. The user already received an answer; the late ack signals nothing useful.

**Gap logged:** TTS `attempt` ack arrives after text fallback — wrong order. M10 backlog.

---

## Test 2 — Config-Level Logical Bugs (VOICE_MODE_HINT fix)

**Scenario:** Voice message sent over WhatsApp with config-level bugs injected:
- STT: `language: xx-invalid` → Deepgram API rejects → `sttResult === null` → BUG-2 gate activates
- TTS: `voice: en-US-InvalidVoiceXYZ` → Edge TTS fails startup health test → `health: degraded` → BUG-6 injects TTS degradation into system prompt

**Root cause fixed:** The BUG-2 gate-resolved path in `chat-service.ts` was missing `VOICE_MODE_HINT`. Without it, the brain didn't know it was handling a voice message and replied claiming "responding in audio" despite TTS being degraded.

**Fix:** Added `VOICE_MODE_HINT` prepend to gate-resolved `contentBlocks` (commit `c4cd205`).

### Result: PASS

**Full flow observed:**
1. STT failed → BUG-2 gate held brain call
2. STT ack ("hold on, fixing…") delivered to WhatsApp
3. CFR reverified STT → real transcription extracted
4. `reprocessTurn` resolved gate with transcribed text + VOICE_MODE_HINT
5. Brain called with correct content + BUG-6 TTS-degraded notice in system prompt
6. Nina replied in text, acknowledging TTS was degraded (correct framing)
7. Config bugs reverted by linter → capabilities restored

**CTO verdict:** "Worked pretty well."

---

## Known Gap (no new sprint)

| Gap | Type | Proposed fix | Priority |
|-----|------|-------------|----------|
| TTS ack arrives after text fallback — wrong order | UX / copy | Acknowledge text fallback in TTS `attempt` ack copy | M10 backlog |

The full output-gate solution (hold text, synthesize as audio post-recovery) is the right long-term fix but is a sprint-level effort. Deferred to M10.

---

## Verdict

M9.6 correctness goals met. All 6 bugs (BUG-1 through BUG-6) resolved and verified end-to-end. The outstanding gap is a UX polish item, not a correctness failure. Sprint ready to close.
