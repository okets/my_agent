# Well-Known Capability Types

These types trigger automatic framework reactions in the dashboard and channels.

| Type | What It Does | Dashboard Reaction | Channel Reaction |
|------|-------------|-------------------|-----------------|
| audio-to-text | Converts audio to text (STT) | Record button appears | Voice notes auto-transcribed |
| text-to-audio | Converts text to audio (TTS) | Audio player on responses | Voice note replies |
| text-to-image | Generates images from text | Image rendered inline | Image sent via channel |

Custom capabilities (no `provides` or unknown type) have no automatic reactions. The brain uses them directly via scripts.
