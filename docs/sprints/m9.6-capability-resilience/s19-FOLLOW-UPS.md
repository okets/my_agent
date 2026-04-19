---
sprint: M9.6-S19
---

# S19 Follow-Ups

## §0.1 Universal-coverage check

**Checked:** All 5 existing capability templates have `friendly_name:` in frontmatter after Task 1:
- `audio-to-text.md` → `friendly_name: "voice transcription"`
- `text-to-audio.md` → `friendly_name: "voice reply"`
- `text-to-image.md` → `friendly_name: "image generation"`
- `browser-control.md` → `friendly_name: "browser"`
- `desktop-control.md` → `friendly_name: "desktop control"`

**Gap:** `image-to-text.md` template doesn't exist yet (DEV-2). When created, must include `friendly_name:`.

**Rule going forward:** New capability templates MUST include `friendly_name:` in CAPABILITY.md frontmatter. The `FRIENDLY_NAMES` hardcoded table in `resilience-messages.ts` serves as a fallback only — it should not grow.

**`failure_type` write-sites (all assistant-turn paths):**
- `chat-service.ts:934` — only write-site for `failure_type` (Task 5.5); covers TTS failure on voice input
- `message-handler.ts` — does NOT write assistant turns directly (confirmed by grep)

Non-covered failure modes (for future tracking): STT failure doesn't currently set a `failure_type` on the user turn (STT failures are surfaced as placeholder text in the user turn content, handled by `FAILURE_PLACEHOLDERS`). This is out of scope for S19.

## FU-1: Orphan watchdog re-drive path

**Current (S19):** Assistant-turn failures found by the watchdog are re-driven via `systemMessageInjector` — a system message injection that prompts the brain to retry. This is the same path used for user-turn rescues.

**Future:** The `assistantFailuresScheduled` report items should eventually be wired to the CFR orchestrator's re-drive path directly (same structured path as `capabilityFailed` events), rather than relying on a system message injection. A direct CFR re-drive would guarantee re-invocation of the capability retry logic rather than relying on brain interpretation of the system message.

**Track for:** Future sprint if orphan watchdog recovery rate is insufficient. Current system message approach is functional; structured re-drive is an enhancement.

## FU-2: `image-to-text.md` template creation

When adding an `image-to-text` capability in a future sprint, create `skills/capability-templates/image-to-text.md` with `friendly_name: "image description"` (or equivalent).

## FU-3: `bg-surface-800` tech debt in index.html

Lines 5136 and 5149 of `packages/dashboard/public/index.html` use `bg-surface-800/50` — a class not defined in the Tailwind config (correct token: `bg-tokyo-surface`). These are in the "I/O Contract" panel for tool spaces, outside S19 scope. Track for a future dashboard cleanup sprint.
