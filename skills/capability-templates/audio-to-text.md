---
template_version: 1
type: audio-to-text
provides: audio-to-text
---

# Audio-to-Text Capability Template

Framework-authored contract for speech-to-text capabilities.

## Script Contract

**Script:** `scripts/transcribe.sh`
**Invocation:** `transcribe.sh <audio-file-path>`
**Output (stdout):** `{ "text": "transcribed text here" }`
**Exit codes:** 0 = success, 1 = error (details on stderr)

### Input Formats

The script MUST handle all of the following audio formats (transcode if the provider doesn't support one natively):
- OGG (Opus) — WhatsApp voice notes
- WebM (Opus) — dashboard browser recording
- WAV — general purpose
- MP3 — general purpose

Use `ffmpeg` for transcoding if needed. The script is responsible for format detection and conversion — callers should not need to know the provider's native format.

### Output Format

JSON on stdout, single line:
```json
{ "text": "the transcribed text" }
```

On error, write a human-readable message to stderr and exit 1. Do NOT output JSON on error.

### Environment

- API key declared via `requires.env` in CAPABILITY.md frontmatter
- Read `config.yaml` (sibling to scripts/) for non-secret settings (model name, language, etc.)
- No hardcoded paths — use `$(dirname "$0")/../config.yaml` for config access

## Transport Agnostic

The script receives a file path. It does NOT know or care which channel the audio came from. No channel names (WhatsApp, dashboard, etc.) should appear in the script.

## Security

- Never log or echo the API key
- Never write audio files outside of /tmp
- Clean up temporary transcoded files after use

## Test Contract

To validate this capability, the test harness will:

1. **Fixture:** Use a short audio file (WAV, ~2 seconds of speech). If no fixture exists, generate one with `ffmpeg -f lavfi -i "sine=frequency=440:duration=2" /tmp/capability-test-audio.wav`
2. **Run:** `transcribe.sh /tmp/capability-test-audio.wav`
3. **Validate:**
   - Exit code is 0
   - stdout is valid JSON
   - JSON has a `text` field that is a non-empty string
4. **Format test:** If a real provider is configured, also test with an OGG file to verify transcoding works

A sine wave won't produce meaningful text, but the script should still return valid JSON with a `text` field (even if empty or containing noise artifacts).

## Known Providers

| Provider | Quality | Latency | Cost | Privacy | Notes |
|----------|---------|---------|------|---------|-------|
| Deepgram | Excellent | ~1s | $0.0043/min (Nova-2) | Cloud | Best balance of speed/quality/cost |
| OpenAI Whisper API | Excellent | ~2-5s | $0.006/min | Cloud | Widely known, slightly slower |
| Google Cloud STT | Excellent | ~1-3s | $0.006/min (v2) | Cloud | Good language support |
| Whisper.cpp (local) | Good | ~5-15s | Free | Local | Requires GPU for speed, CPU is slow |
| Groq (Whisper) | Good | <1s | Free tier available | Cloud | Fastest, but rate-limited |

The builder should research current pricing and availability — this table is a starting point, not authoritative.
