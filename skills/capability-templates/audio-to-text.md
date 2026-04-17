---
template_version: 2
type: audio-to-text
provides: audio-to-text
fallback_action: "could you resend as text"
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
{ "text": "the transcribed text", "language": "en", "confidence": 0.92, "duration_ms": 3400 }
```

- `text` (required): the transcribed text
- `language` (optional): ISO 639-1 language code detected by the provider (e.g., "en", "he", "th"). If the provider supports language detection and `language: multi` is configured, include this field. The framework uses it to select the correct TTS voice for responses.
- `confidence` (optional but recommended): provider-reported confidence score in `[0, 1]`. Used by the CFR resilience layer (M9.6) to tell silent/unintelligible input apart from a broken capability — without this, the orchestrator conservatively treats empty transcripts as valid user input.
- `duration_ms` (optional but recommended): length of the audio in milliseconds. Pair with `confidence`: if `duration_ms > 500 && confidence > 0.2 && text === ""`, the framework treats the empty result as a capability failure and triggers recovery.

On error, write a human-readable message to stderr and exit 1. Do NOT output JSON on error.

**Migration note:** scripts that do not yet emit `confidence` and `duration_ms` remain valid — the framework falls back to conservative behavior (no false-positive CFR on silent input). New scripts should emit both fields.

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
   - If present, `confidence` is a number in `[0, 1]` and `duration_ms` is a positive integer
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

## Smoke Fixture

Every audio-to-text capability MUST ship `scripts/smoke.sh`. The reverify dispatcher
calls this as a fresh out-of-session subprocess (exit 0 = healthy, non-zero = broken).

**Contract:**
- Generates a deterministic audio fixture locally (no stored binary needed)
- Calls `transcribe.sh` against the fixture
- Validates the JSON output has a non-null `text` field
- Cleans up temp files on exit
- Network calls to the provider are unavoidable — document the fallback if offline behavior is needed

**Reference implementation** (copy to `scripts/smoke.sh`, make executable):

~~~bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

FIXTURE="/tmp/smoke-stt-$$.wav"
trap 'rm -f "$FIXTURE"' EXIT

# Generate a 2-second test tone (requires ffmpeg — already a transcribe.sh dependency)
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 "$FIXTURE" 2>/dev/null

# Call the script; validate JSON has a 'text' field
OUTPUT="$("$DIR/transcribe.sh" "$FIXTURE")"
echo "$OUTPUT" | jq -e '.text != null' > /dev/null
~~~

A sine wave won't produce meaningful transcription, but the script should return valid JSON
with a `text` field (even if empty). If your provider returns empty text for silence, the smoke
script still exits 0 — smoke checks capability health, not transcription quality.
