---
template_version: 1
type: bundles
---

# Capability Bundles

Composite requests that map to multiple capabilities.

## Voice

**Trigger phrases:** "I want voice", "voice messages", "voice support", "talk to you"

**Capabilities:**
1. `audio-to-text` — understand incoming voice messages
2. `text-to-audio` — respond with voice

Both must be built for full voice support. Build them sequentially — audio-to-text first (more commonly requested), then text-to-audio.

## Full Multimedia

**Trigger phrases:** "full multimedia", "all media types", "voice and images"

**Capabilities:**
1. `audio-to-text`
2. `text-to-audio`
3. `text-to-image`

Build in order: audio-to-text, text-to-audio, text-to-image.

## Notes

- Each capability in a bundle is independent — they use different providers and API keys
- If a user only wants one direction (e.g., "understand voice" but not "respond with voice"), build only what's requested
- The brainstorming skill should check this file to expand composite requests before spawning the builder
- Every capability in a bundle must ship `scripts/smoke.sh` per its type's template contract. The reverify dispatcher uses smoke.sh as the default health-check script for any type without a per-type reverifier.
