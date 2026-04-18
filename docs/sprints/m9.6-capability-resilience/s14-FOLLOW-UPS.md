# S14 Follow-Ups

## FU-1: FRIENDLY_NAMES → frontmatter migration

**What:** Migrate the hardcoded `FRIENDLY_NAMES` table in `resilience-messages.ts` to a `friendly_name:` field in CAPABILITY.md frontmatter, read by the scanner and surfaced via a new `registry.getFriendlyName(type)` method.

**Why:** Consistent with the "Markdown is source of truth" principle (CLAUDE.md). Would allow plug authors to override the display name per-plug without code changes, and removes the need to update the hardcoded table when new well-known types are added.

**Target:** Phase 3 cleanup sprint (S19 or S20).

**State at S14:** `FRIENDLY_NAMES` covers `audio-to-text`, `image-to-text`, `text-to-audio`, `text-to-image`, `browser-control`, `desktop-control`. All six entries are correct and non-empty. No installed plug is using the raw type string as its user-facing name.

---

## FU-2: multi_instance frontmatter backfill for remaining types

**What:** Add `multi_instance: true` to the CAPABILITY.md template for `browser-control` (already in WELL_KNOWN_MULTI_INSTANCE but may not have the frontmatter field in all installed plugs), and verify/add `multi_instance: false` for singleton types (`audio-to-text`, `text-to-audio`, `desktop-control`) to make the intent explicit.

**Why:** S14 added scanner support for `multi_instance:` frontmatter (D4 safety net relies on `WELL_KNOWN_MULTI_INSTANCE` for capabilities loaded before S14). Backfilling the field to installed plugs removes the dependency on the compile-time constant for future plug instances.

**State at S14:** Dynamic scan shows `browser-chrome` is the only installed plug. It doesn't have `multi_instance:` in its frontmatter — `isMultiInstance` falls back to `WELL_KNOWN_MULTI_INSTANCE.has("browser-control")` which returns `true` correctly. No user-visible impact.

**Target:** S15 or next capability template audit sprint.
