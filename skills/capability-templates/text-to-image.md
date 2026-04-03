---
template_version: 1
type: text-to-image
provides: text-to-image
---

# Text-to-Image Capability Template

Framework-authored contract for image generation capabilities.

## Script Contract

**Script:** `scripts/generate.sh`
**Invocation:** `generate.sh <prompt> <output-path>`
**Output (stdout):** `{ "path": "/path/to/output.png" }`
**Exit codes:** 0 = success, 1 = error (details on stderr)

### Arguments

- `<prompt>` — the image description (shell-quoted by caller)
- `<output-path>` — where to write the image file

### Output Format

The output file MUST be PNG or JPEG. If the provider returns a different format (e.g., WebP), the script must convert using ImageMagick or similar.

JSON on stdout, single line:
```json
{ "path": "/path/to/output.png" }
```

The `path` field must match `<output-path>` (confirming the file was written successfully).

On error, write a human-readable message to stderr and exit 1. Do NOT output JSON on error.

### Environment

- API key declared via `requires.env` in CAPABILITY.md frontmatter
- Read `config.yaml` (sibling to scripts/) for non-secret settings (model, size, quality, style, etc.)
- No hardcoded paths — use `$(dirname "$0")/../config.yaml` for config access

## Transport Agnostic

The script writes to a given path. It does NOT know which channel will deliver the image. No channel names should appear in the script.

## Security

- Never log or echo the API key
- Never write image files outside the specified output path or /tmp
- Clean up temporary files

## Test Contract

To validate this capability, the test harness will:

1. **Run:** `generate.sh "A simple red circle on a white background" /tmp/capability-test-output.png`
2. **Validate:**
   - Exit code is 0
   - stdout is valid JSON
   - JSON has a `path` field
   - The file at `path` exists
   - The file is non-empty (> 1000 bytes)
   - The file is a valid image (check with `file` command — should report PNG or JPEG)

## Known Providers

| Provider | Quality | Latency | Cost | Privacy | Notes |
|----------|---------|---------|------|---------|-------|
| OpenAI DALL-E 3 | Excellent | ~10-20s | $0.040/image (1024x1024) | Cloud | Best prompt following |
| Stability AI (SDXL) | Very Good | ~5-15s | $0.002-0.008/image | Cloud | More control, cheaper |
| Replicate (Flux) | Excellent | ~5-10s | ~$0.003/image | Cloud | Latest models, fast |
| Midjourney API | Excellent | ~30-60s | $0.01-0.05/image | Cloud | Artistic quality, slow |
| Stable Diffusion (local) | Good | ~15-60s | Free | Local | Needs GPU (8GB+ VRAM) |

The builder should research current pricing and availability — this table is a starting point, not authoritative.
