# Well-Known Capability Types

These types trigger automatic framework reactions in the dashboard and channels.

| Type | Interface | What It Does | Dashboard Reaction | Channel Reaction |
|------|-----------|-------------|-------------------|-----------------|
| audio-to-text | script | Converts audio to text (STT) | Record button appears | Voice notes auto-transcribed |
| text-to-audio | script | Converts text to audio (TTS) | Audio player on responses | Voice note replies |
| text-to-image | script | Generates images from text | Image rendered inline | Image sent via channel |
| desktop-control | mcp | Screen interaction via MCP tools | Settings toggle, rate limiting | N/A — brain-only |

Custom capabilities (no `provides` or unknown type) have no automatic reactions. The brain uses them directly via scripts or MCP tools.
