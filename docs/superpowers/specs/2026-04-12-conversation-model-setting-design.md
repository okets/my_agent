# Default Conversation Model Setting — Design

**Date:** 2026-04-12
**Scope:** Expose `brain.model` in the dashboard Settings UI as a user-facing "default conversation model" picker. Applies to Conversation Nina only; Working Ninas are out of scope.

## Problem

Conversation Nina's default model is already configurable via `brain.model` in `.my_agent/config.yaml`, but there is no UI for it. The Models section in Settings currently lets users pick the *version* of each tier (e.g. `claude-sonnet-4-6` for the `sonnet` tier), but not which tier Conversation Nina uses by default.

## Design

### UI

A fourth row in the existing **Settings → Models** section, directly under the sonnet/haiku/opus version pickers.

Label: **Default conversation**
Control: `<select>` with three options — Opus, Sonnet, Haiku (Sonnet default).
Helper text below the row: *"Applies to new conversations. Current conversation keeps its model."*

Placement in code:
- Desktop: `packages/dashboard/public/index.html:2897` (after the closing `</template>` of the tier picker loop, before the save-status `<div>`).
- Mobile: `packages/dashboard/public/index.html:7904` (same relative position in the mobile Settings pane).

Both locations share the same Alpine state in `public/js/app.js` — one `defaultConversationTier` property, one `saveDefaultConversationTier()` method, reused by both templates.

### Backend

**New routes in `packages/dashboard/src/routes/settings.ts`:**

- `GET /api/settings/brain-model` → `{ tier: "sonnet" | "haiku" | "opus" }`. Reads `brain.model` from `config.yaml`. If the stored value is a tier name, return it. If it is a raw model ID (legacy), reverse-map it through `preferences.models`; if no match, fall back to `"sonnet"`.
- `PUT /api/settings/brain-model` with body `{ tier: "sonnet" | "haiku" | "opus" }`. Writes the tier name to `brain.model` in `config.yaml`. Validates the tier value against the three allowed strings; returns 400 on anything else.

Both routes follow the existing `/api/settings/models` pattern: parse yaml, mutate, `stringify` with `lineWidth: 120`, write back.

### Config storage

`brain.model` stores the **tier name** (`"sonnet"` / `"haiku"` / `"opus"`) rather than a specific model ID.

At load time, `loadBrainConfig()` in `packages/core/src/config.ts` resolves the tier through the existing `preferences.models` map (or `DEFAULT_MODELS` fallback) to get the concrete model ID passed to the SDK. If `brain.model` already contains a concrete model ID (legacy installs, or `MY_AGENT_MODEL` env override), it passes through unchanged — no migration.

Resolution precedence (unchanged except for tier expansion):
1. `process.env.MY_AGENT_MODEL` — literal model ID, wins.
2. `brain.model` in yaml — if it's a tier name, expand via `preferences.models[tier]` or `DEFAULT_MODELS[tier]`. If it's a concrete ID, use as-is.
3. `DEFAULT_MODEL` (= `DEFAULT_MODELS.sonnet`).

### Behavior

New conversations pick up the new default automatically. `SessionRegistry.getOrCreate()` creates a fresh `SessionManager` per `conversationId`, and `SessionManager.ensureInitialized()` calls `loadConfig()` inside that constructor path — so each cold-start conversation re-reads `brain.model`. No router or registry changes required.

Warm sessions (conversations already in the `SessionRegistry` cache) keep the model they were created with until evicted (LRU) or until the Brain restarts. This is surfaced in the UI helper text.

### Out of scope

- Working Nina / subagent model selection (each `AgentDefinition` keeps its own declaration).
- Per-conversation model override (already exists via `StreamOptions.model`; not exposed here).
- Debrief or automation model selection (separate settings).
- Editing `preferences.models` tier aliases (covered by existing version pickers).
- Hot-swap of the model for already-warm conversations.

## Testing

- Unit: `loadBrainConfig` with tier name in yaml → returns expanded model ID. With concrete ID → passes through. With missing value → falls back to sonnet.
- Unit: `PUT /api/settings/brain-model` rejects non-tier values with 400.
- Manual: set tier to Opus in UI, start a new conversation, confirm `[SessionManager] config.model` log shows `claude-opus-4-6`. Existing warm conversation continues on its prior model.

## Files Touched

- `packages/core/src/config.ts` — tier expansion in `loadBrainConfig`.
- `packages/dashboard/src/routes/settings.ts` — two new routes.
- `packages/dashboard/public/index.html` — new dropdown row in desktop + mobile Models section.
- `packages/dashboard/public/js/app.js` — Alpine state + save handler.
