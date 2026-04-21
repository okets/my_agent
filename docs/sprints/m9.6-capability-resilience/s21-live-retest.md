# M9.6-S21 Live Retest Report

**Date:** 2026-04-21  
**Scenario:** Voice message sent over WhatsApp with both `stt-deepgram` and `tts-edge-tts` plugs deliberately broken (`.enabled` removed).

---

## Execution Score: 8/10

Both plugs recovered correctly without data loss or hang. The original 5 bugs (BUG-1 through BUG-5) are resolved. The system did what it was supposed to do.

**What worked:**
- STT failed → "hold on" ack sent to WhatsApp → plug fixed → voice message transcribed → Nina answered correctly
- TTS failed → plug fixed autonomously in the background → subsequent replies delivered as audio
- Background job card visible in WebUI throughout

**What cost the 2 points:**
- TTS fix took noticeable time, with no indication to the user that it was in progress until after it had already resolved. The system recovered silently.

---

## Clarity / Transparency Score: 6/10

The user experience during TTS recovery was opaque.

**Specific issue — TTS ack sequencing:**

For STT, the "hold on" ack arrives *before* Nina answers — the user understands they are waiting for a fix. For TTS, the sequence was inverted:

1. STT recovered → Nina answered as text (correct, since TTS was still broken)
2. TTS fix automation ran in the background
3. "Hold on, fixing…" ack arrived on WhatsApp *after* Nina's text response

This reads as noise. The user already received an answer; the ack arriving afterwards signals nothing useful. The only real-time signal was the WebUI job card, which WhatsApp users don't see.

**What good looks like:**  
When TTS fails and fallback to text occurs, Nina should proactively say something like:  
*"I just replied in text since my voice system needed a quick fix — I'll switch back to audio as soon as it's ready."*

This is a copy change only (no architecture change). The recovery mechanics are correct; the user-facing framing is missing.

---

## Known Gap (no new sprint)

| Gap | Type | Proposed fix | Priority |
|-----|------|-------------|----------|
| TTS ack arrives after text fallback — wrong order | UX / copy | Change TTS `attempt` ack text in `ResilienceCopy` to acknowledge the text fallback | M10 backlog |

The full output-gate solution (hold text delivery, synthesize as audio after recovery, analogous to BUG-2) is the right long-term fix but is a sprint-level effort. Deferred to M10.

---

## Verdict

M9.6 correctness goals met. Both recovery chains work. The outstanding gap is a UX polish item, not a correctness failure.
