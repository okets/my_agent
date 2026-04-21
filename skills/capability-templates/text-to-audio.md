---
template_version: 2
type: text-to-audio
provides: text-to-audio
fallback_action: "you can read my last reply above"
multi_instance: false
friendly_name: "voice reply"
interaction: output
---

# Text-to-Audio Capability Template

Framework-authored contract for text-to-speech capabilities.

## Script Contract

**Script:** `scripts/synthesize.sh`
**Invocation:** `synthesize.sh <text> <output-path> [language]`
**Output (stdout):** `{ "path": "/path/to/output.ogg" }`
**Exit codes:** 0 = success, 1 = error (details on stderr)

### Arguments

- `<text>` — the text to synthesize (shell-quoted by caller)
- `<output-path>` — where to write the audio file
- `[language]` — optional ISO 639-1 language code (e.g., "en", "he", "th"). When provided, the script should select a voice appropriate for that language. When omitted, use the default voice from config.yaml. This enables automatic language-matched TTS when the STT capability detects the input language.

### Output Format

The output file MUST be OGG (Opus). If the provider produces a different format, the script must transcode using `ffmpeg`.

JSON on stdout, single line:
```json
{ "path": "/path/to/output.ogg" }
```

The `path` field must match `<output-path>` (confirming the file was written successfully).

On error, write a human-readable message to stderr and exit 1. Do NOT output JSON on error.

### Environment

- API key declared via `requires.env` in CAPABILITY.md frontmatter
- Read `config.yaml` (sibling to scripts/) for non-secret settings (voice ID, speed, language, etc.)
- No hardcoded paths — use `$(dirname "$0")/../config.yaml` for config access

## Transport Agnostic

The script writes to a given path. It does NOT know which channel will deliver the audio. No channel names should appear in the script.

## Security

- Never log or echo the API key
- Clean up temporary files after transcoding

## Test Contract

To validate this capability, the test harness will:

1. **Run:** `synthesize.sh "Hello, this is a test." /tmp/capability-test-output.ogg`
2. **Validate:**
   - Exit code is 0
   - stdout is valid JSON
   - JSON has a `path` field
   - The file at `path` exists
   - The file is non-empty (> 100 bytes)
   - The file is valid audio (check with `ffprobe` — exits 0)

## Known Providers

| Provider | Quality | Latency | Cost | Privacy | Notes |
|----------|---------|---------|------|---------|-------|
| ElevenLabs | Excellent | ~1-2s | $0.30/1K chars (Creator) | Cloud | Best quality, voice cloning |
| OpenAI TTS | Very Good | ~1-3s | $0.015/1K chars (tts-1) | Cloud | Good default, two quality tiers |
| Google Cloud TTS | Very Good | ~1s | $0.016/1M chars (Standard) | Cloud | WaveNet voices are excellent |
| Deepgram Aura | Good | <1s | $0.0065/1K chars | Cloud | Fast, cost-effective |
| Piper (local) | Decent | ~2-5s | Free | Local | Lightweight, many voices |
| Coqui TTS (local) | Good | ~5-10s | Free | Local | Better quality, heavier |

The builder should research current pricing and availability — this table is a starting point, not authoritative.

## Smoke Fixture

Every text-to-audio capability MUST ship `scripts/smoke.sh`. The reverify dispatcher
calls this as a fresh out-of-session subprocess (exit 0 = healthy, non-zero = broken).

**Contract:**
- Calls `synthesize.sh` with a deterministic phrase
- Validates the JSON output has a `path` field
- Validates the output file exists and exceeds 100 bytes
- Validates the output file has OggS magic bytes (0x4f676753)
- Cleans up temp files on exit

**Reference implementation** (copy to `scripts/smoke.sh`, make executable):

~~~bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

OUT="/tmp/smoke-tts-$$.ogg"
trap 'rm -f "$OUT"' EXIT

OUTPUT="$("$DIR/synthesize.sh" "smoke test" "$OUT")"
echo "$OUTPUT" | jq -e '.path != null' > /dev/null

[ -f "$OUT" ] && [ "$(wc -c < "$OUT")" -gt 100 ]

# Validate Ogg magic bytes (plug must output Ogg/Opus per template contract)
MAGIC=$(od -A n -N 4 -t x1 "$OUT" | tr -d ' \n')
if [ "$MAGIC" != "4f676753" ]; then
  echo "Output is not a valid Ogg file (magic: $MAGIC, expected 4f676753 'OggS')" >&2
  exit 1
fi
~~~

A short deterministic phrase is used so providers can synthesize it quickly. The smoke
script exits 0 if the output file is produced, non-trivially sized, and has valid Ogg
magic bytes — it does not validate audio quality or voice accuracy.
