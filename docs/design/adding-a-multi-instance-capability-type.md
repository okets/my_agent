# Adding a New Multi-Instance Capability Type

> **Status:** Design note
> **Created:** 2026-04-13 (post M9.5-S7)
> **Related:** [capability-framework-v2.md](capability-framework-v2.md)

---

## Why this note exists

`browser-control` (M9.5-S7) was the framework's first multi-instance capability type. Getting it working end-to-end exposed a set of tasks that are NOT obvious from the framework code alone — they live in the brain layer (skill descriptions, agent prompts, UI hints), and they're the reason a feature can "exist" but be **undiscoverable**.

Phase F of that sprint took three user prompts before the brain invoked `capability-brainstorming` (see sprint DECISIONS.md D6/D7/D8), even though the Settings UI literally said *"Ask Nina to add any browser."* The Settings text was advertising a trigger the skill description didn't know about. This checklist is the reflection.

When you add the next multi-instance capability type (iOS profiles, shell sessions, mail accounts, document spaces — anything where the user has zero, one, or many of the same shape), work through this list. Two-thirds of these items are brain-layer, not code-layer.

---

## Framework-layer

1. **Template at `skills/capability-templates/<type>.md`.** Defines the socket contract — required tools, frontmatter shape, wrapper behavior. Mirror `browser-control.md` in shape.
2. **Add to `WELL_KNOWN_MULTI_INSTANCE` allowlist** in `packages/core/src/capabilities/types.ts`. This is what flips `canDelete: true` in the registry and makes `GET /api/settings/capabilities/v2` render the type as a group card.
3. **Add to `WELL_KNOWN_TYPES`** in `packages/core/src/capabilities/well-known-types.ts` with `multiInstance: true`, `iconSlug`, and a persistent `hint` string ("Ask {agent} to add any …"). The `{agent}` token gets substituted to the user's configured agent name.
4. **CI grep guard.** Add a test under `packages/core/tests/capabilities/` that fails if anyone writes `.find(c => c.provides === '<type>')`, `.get('<type>')`, `.has('<type>')`, or `.toggle('<type>')` in `packages/**/*.{ts,js}`. Pattern: copy `no-first-match-browser-control.test.ts`. First-match APIs lie for multi-instance types; the lint forces contributors to use `listByProvides` / `toggleByName`.
5. **Icon bundle (if visual).** Full-color SVGs in `packages/dashboard/public/icons/<type>/<slug>.svg` + a `generic.svg` fallback. Template declares the slug per instance via `icon:` frontmatter.

## Brain-layer — the part that surprised us

6. **`capability-brainstorming/SKILL.md` description must name the type's triggers.** Generic phrasing ("add a new ability", "extend capabilities") is not enough. The skill matches on concrete user words. For browser-control this meant: *"add Chrome, add Firefox, install a browser, dedicated browser instance, browser with its own profile,"* etc. For the next type, enumerate the user-voice phrases. Copy the Settings hint verbatim — if the UI says *"Ask Nina to add any …"* then *"add any &lt;thing&gt;"* must trigger the skill.
7. **Skill must declare multi-instance semantics.** Add a rule that naming a specific instance by name (Chrome, gmail@..., iPhone-work) is ALWAYS an install request — even if tools for that capability type already exist in the session. Without this, the skill short-circuits when a fallback is present or a first instance is already installed.
8. **Skill must forbid project-management framing.** The `<HARD-GATE>` should prohibit "which sprint is this", "one-off vs full", or any procedural Q&A. Capability requests are user asks, not dev process questions. A skill that offers procedural off-ramps will take them.
9. **Capability-builder agent prompt (`packages/core/src/agents/definitions.ts`) must mandate `.enabled` as the final step.** Without `.enabled`, the capability is discovered but not registered — it appears "built but invisible" to the user. This is the most common bug for just-built capabilities.
10. **Capability-builder must forbid `systemctl restart` / dashboard reload.** The filesystem watcher auto-registers new capabilities; a mid-build restart kills the builder before `.enabled` is written, leaving half-built state.
11. **Capability-builder must require folder name = `name:` field.** Mismatched slugs (`chrome/` vs capability `name: browser-chrome`) are functionally benign but invite confusion in Settings UI, debug API paths, and profile resolution.

## UI-layer

12. **Generic-SVG fallback tested.** `generic.<type>.svg` must render reasonably when a per-instance icon is unknown — the template allows `icon:` to be any string, and typos fall through to this fallback.
13. **Delete confirmation copy.** Multi-instance types almost always have user state (profiles, sessions, credentials). The delete dialog must default to **non-destructive** (keep state) with an explicit opt-in to wipe. Copy template: *"Remove &lt;instance&gt;? Saved &lt;state-kind&gt; is kept — reinstalling this &lt;type&gt; will restore it. Check below to wipe &lt;state-kind&gt; too."*
14. **Persistent "Add another" hint.** Even when one or many instances exist, the hint stays visible — that's how a user discovers they can add more. Don't gate it on instance count.

## Acceptance

15. **Agent-builds-from-scratch gate.** Delete any manual scaffold, ask the agent *"add &lt;specific instance&gt;"* in a fresh chat. Acceptance: skill routes to `capability-brainstorming` on the **first** prompt (at most one focused clarifier), the builder produces a working capability from the template alone, the harness test passes, and the capability registers + is usable from a subsequent chat turn. Cap at 3 iterations; ship a committed fixture fallback if iteration 3 fails and file a skill-iteration follow-up.
16. **Empty-registry path tested.** With zero instances of the type and no fallback, asking the agent for the capability should route to brainstorming immediately. If a fallback exists (see Phase C of M9.5-S7), either remove it before the test or test both with and without.

## Document the sprint's iteration findings

Whatever the next type's sprint surfaces about skill triggers, builder prompts, or framework gaps — append it back to this checklist. That's how the UI/brain contract stays honest across types.

---

## Pointers to canonical examples

- Template: `skills/capability-templates/browser-control.md`
- Skill trigger section: `packages/core/skills/capability-brainstorming/SKILL.md` — the "Trigger contract with the Settings UI" section and the expanded description list
- Builder prompt: `packages/core/src/agents/definitions.ts` — the `capability-builder` prompt's "Enabling the Capability" and "DO NOT restart" sections
- Multi-instance UI pattern: `packages/dashboard/public/index.html` — the capabilities group-card branch (search for `multiInstance`)
- Registry API: `packages/core/src/capabilities/registry.ts` — `listByProvides`, `toggleByName`, `delete({wipeProfile})`

## Post-M9.5-S7 open work

These are cosmetic / ergonomic, not blocking the pattern:
- Auto-enable safety net (scanner-level) for newly-discovered capabilities without `.enabled`. Requires a `.disabled` tombstone to distinguish "user turned off" from "never enabled." Currently relies on the builder prompt.
- Scanner warning when folder slug ≠ capability `name:`. Currently relies on the builder prompt.
- When a second multi-instance type lands, revisit: can the UI text ("Ask Nina to add any …") and the skill trigger list be derived from `WELL_KNOWN_TYPES` entries automatically, so Settings and skill stay in sync without two edits?
