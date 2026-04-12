# M9.5-S7: Browser Capability

**Status:** Planned (revised post-audit)
**Milestone:** M9.5 — Capability Framework v2 (re-opened)
**Precedent:** [M9.5-S3 Desktop Extraction](../m9.5-s3-desktop-extraction/plan.md), [M9.5-S4 Template Verification](../m9.5-s4-template-verification/plan.md)

---

## Motivation

Today Nina's browser automation is hardwired: `@playwright/mcp` is spawned unconditionally in two places with no configuration, always launching Chrome. Two user-facing problems follow:

1. **No browser choice.** Users who want Edge or Firefox have no way to say so.
2. **No separation between agent and user browsers.** On a non-dedicated machine the agent and the user may want different browsers (so logins don't collide); on a dedicated machine the agent should have its own profile regardless.

The right shape is not a settings dropdown — it's the capability system we already have. Each browser becomes a separate instance of a `browser-control` capability, with its own `user-data-dir`. Nina can have zero, one, or several. She picks which one to use via a standing order.

This sprint also introduces the **first multi-instance capability type.** The socket/plug analogy holds: framework provides the `browser-control` socket (template + registry + middleware); agent builds each plug (Chrome, Edge, Brave, whatever).

## Goals

1. Define `browser-control` as a well-known, multi-instance capability type with a template.
2. Migrate the two hardcoded `@playwright/mcp` registrations into registry-driven iteration over `provides: browser-control` capabilities.
3. Generalize the settings UI to render multiple instances of the same type with per-instance toggles, a per-instance **delete** affordance, and a persistent "Ask {agent} to add a browser" hint.
4. Prove the template works by having the agent build a browser capability end-to-end with no internal hints (acceptance gate inherited from S4).

## Non-goals

- No settings-level default-browser picker. Routing is a standing-order concern, not a preference.
- `playwright-screenshot-bridge.ts` (direct-Playwright, internal dashboard plumbing) stays as-is. See "Coexistence with screenshot bridge" below.
- No special-casing for Brave/Vivaldi/Arc. The template exposes `executablePath:`; if the agent can construct the right plug for a Chromium fork, it works. We don't verify each fork.

---

## Design

### Capability shape

```
.my_agent/capabilities/browser-chrome/
  CAPABILITY.md       # name: Browser (Chrome), provides: browser-control, interface: mcp
  config.yaml         # browser: chrome, headless: false  (no profile path here)
  package.json        # deps: @playwright/mcp (pinned), @modelcontextprotocol/sdk
  src/server.ts       # thin wrapper — spawns @playwright/mcp with flags
  scripts/detect.sh   # exits 0 if chrome/chromium binary is present
  scripts/setup.sh    # npm install, playwright install chrome
  references/

.my_agent/browser-profiles/browser-chrome/   # profile lives OUTSIDE the capability
  (Chrome user-data-dir — cookies, logins, extensions, history)
```

**Capability folder vs. profile folder — explicit separation:**

The capability folder is the MCP wrapper — code, config, package. Disposable. Removing it does not touch saved logins.

The profile folder at `.my_agent/browser-profiles/<capability-name>/` is the user's browser state (cookies, logins). It persists across capability removal and reinstallation. Reinstalling `browser-chrome` later picks up the same profile — user doesn't log back into everything.

Each instance:
- Has a unique folder name (`browser-chrome`, `browser-edge`, `browser-firefox`, …) → unique `name:` → unique MCP server key → unique profile directory under `.my_agent/browser-profiles/`.
- Declares `provides: browser-control`.
- Has its own `config.yaml`. **Required** field: `browser:` (one of `chrome | msedge | firefox | webkit`, matching `@playwright/mcp` 0.0.68's CLI; note `chromium` is not in that enum).
- Optional fields: `headless:` (default false), `executablePath:` (for forks like Brave), `userDataDir:` (override — by default resolved to `.my_agent/browser-profiles/<capability-name>/`, created if missing).
- Spawns `@playwright/mcp` with `--browser <browser> --user-data-dir <absolute-resolved-path>` (+ `--executable-path` + `--headless` if configured).

### Template

`skills/capability-templates/browser-control.md` — the socket. Parameterizes `$BROWSER`, `$USER_DATA_DIR`, optional `$EXECUTABLE_PATH`. Mirrors the `desktop-control` template's shape from S4. The `capability-builder` agent follows it when the user asks *"add Chrome support"* / *"add Edge support"*.

Template must also include a **standing-orders snippet** that tells the user what to write after installing a browser capability, e.g.:

> *To tell me which browser to use for a task, add to your standing orders: "Use browser-chrome for X. Use browser-edge for Y."*

### Registry semantics — explicit migration plan

Current registry (`packages/core/src/capabilities/registry.ts`) has these `provides`-keyed methods, all "first-match" semantics:
- `has(type)` → line 31, delegates to `get()`
- `get(type)` → line 39, first available+enabled match
- `isEnabled(type)` → line 51, first match regardless of status
- `toggle(type)` → line 64, toggles first match

**Changes:**

1. **Add** `listByProvides(type: string): Capability[]` — returns all matching, regardless of enabled/status.
2. **Keep** `has(type)`, `get(type)`, `isEnabled(type)` with **unchanged semantics and signatures** — existing callers of `$store.capabilities.has('audio-to-text')`, `registry.get('desktop-control')`, etc. all continue to work for true singletons. Docstrings updated to warn: "first match only; use `listByProvides` for multi-instance types."
3. **Rename + keep compat**: `toggle(type)` stays but now delegates to `toggleByName(name)`. New canonical method is `toggleByName(name: string)`. Route handler switches to `toggleByName`. Old `toggle(type)` preserved for existing tests; deprecated but not removed this sprint.

This lets us land the registry change first, migrate call-sites incrementally, and run existing tests unchanged.

### Consumers that need updates

| File | Line | Current | Change |
|------|------|---------|--------|
| `packages/dashboard/src/routes/capabilities.ts` | ~50, ~144 | `.find(c => c.provides === type)` | Enumerate instances; toggle routes take `:type/:instance` |
| `packages/dashboard/src/agent/session-manager.ts` | 170–174 | Hardcoded `@playwright/mcp` | Iterate `listByProvides('browser-control')`, register each |
| `packages/dashboard/src/automations/automation-executor.ts` | 350–355 | Same | Same |
| `packages/dashboard/src/app.ts` | ~1656 | `.find(c => c.provides === 'desktop-control')` for MCP factory | Migrate to `listByProvides('desktop-control').filter(enabled)[0]` for future-proofing (cheap; ready for macOS/Wayland) |
| `packages/dashboard/src/hatching/hatching-tools.ts` | 229 | `.find(c => c.provides === 'desktop-control')` status check | Leave as-is (informational only) |
| `packages/dashboard/public/js/stores.js` | 112 | `c.provides === type && enabled` filter | Update to consume new API shape, preserve `has(type)` / `get(type)` Alpine store semantics |
| `packages/dashboard/public/js/ws-client.js` | ~111 | Consumes capability broadcast | Update to new shape |
| `packages/dashboard/public/index.html` | 3014–3655 | Alpine capabilities card | Generalize for multi-instance (see Settings UI below) |
| `packages/dashboard/public/index.html` | 6398, 9359 | `$store.capabilities.has('audio-to-text')` | **Unchanged** — `has()` preserves singleton semantics |

### Settings UI — the vision (per CTO)

**Two classes of capability card:**

**Singleton capability (current behavior, unchanged):** one row per capability with a toggle. If not installed, a hint ("Ask {agent} to add voice input"). Applies to all current types except browser-control.

**Multi-instance capability — `browser-control`:**

```
┌─ Browsers ──────────────────────────────┐
│                                          │
│  ┌ [🔵 Chrome icon]  Chrome      [●──]  🗑 ┐│
│  └────────────────────────────────────────┘│
│  ┌ [🟦 Edge icon]    Edge        [──○]  🗑 ┐│
│  └────────────────────────────────────────┘│
│                                          │
│  Ask Nina to add any browser.            │
│                                          │
└──────────────────────────────────────────┘
```

Key elements:

- **Persistent hint** (always visible, even when one or many browsers installed): *"Ask {agent_name} to add any browser."*
- **Per-instance box**: icon + name + toggle + trash.
- **Trash icon = remove the MCP wrapper.** This is the first capability type where a user can delete an instance from the UI. Hitting trash:
  1. Opens a confirmation dialog: *"Remove browser-chrome? Saved logins and cookies are kept — reinstalling this browser will restore them. Check below to wipe the profile too."* with an unchecked **"Also delete saved logins and cookies"** checkbox.
  2. On confirm: stops any running MCP process for this capability, removes `.my_agent/capabilities/<name>/` folder. If the checkbox was ticked, also removes `.my_agent/browser-profiles/<name>/`. Emits `capability:changed`, UI updates.
  3. Default is non-destructive: removing a capability does not delete user data. Profile deletion is an explicit opt-in.
- **Icon source**: inline SVG from [simple-icons](https://simpleicons.org/) (MIT-licensed), bundled in `packages/dashboard/public/icons/browsers/`. Template specifies which icon slug the capability uses (`icon: googlechrome` / `microsoftedge` / `firefox` / `safari` / `brave` / etc.). Fallback: generic globe icon.
- **Toggle timing**: `next-session` (MCP servers bind at session start).

For singletons: render exactly as today.

### Multi-instance signal — derivation

Don't derive from "≥2 installed" (that would hide the "Add another" affordance when only one browser is installed). Use an **authoritative allowlist** in `WELL_KNOWN_TYPES`:

```ts
{ type: 'browser-control', label: 'Browsers', multiInstance: true, iconSlug: 'browser',
  hint: 'Ask {agent} to add any browser.' }
```

### API contract — additive, not breaking

**New endpoint:** `GET /api/settings/capabilities/v2`
```ts
{
  capabilities: [
    {
      type: 'browser-control',
      label: 'Browsers',
      multiInstance: true,
      hint: 'Ask {agent} to add any browser.',
      instances: [
        { name: 'browser-chrome', label: 'Chrome', iconSlug: 'googlechrome',
          enabled: true, state: 'healthy', canToggle: true, canDelete: true, ... },
        { name: 'browser-edge', label: 'Edge', iconSlug: 'microsoftedge',
          enabled: false, state: 'healthy', canToggle: true, canDelete: true, ... }
      ]
    },
    {
      type: 'desktop-control',
      label: 'Desktop Control',
      multiInstance: false,
      instances: [ { name: 'Desktop X11', ..., canDelete: false } ]
    },
    // ... singletons ...
  ]
}
```

**Old endpoint** `GET /api/settings/capabilities` stays (unchanged) this sprint so nothing breaks. `stores.js` migrates to `/v2` but the public Alpine store surface (`$store.capabilities.has(type)`, `.get(type)`, `.list()`) stays the same — internal representation changes, the external shape stays.

**New endpoints:**
- `POST /api/settings/capabilities/:type/:instance/toggle` — per-instance toggle (uses `toggleByName` internally).
- `DELETE /api/settings/capabilities/:type/:instance` — per-instance delete (new; only allowed for `canDelete: true`).

**Old endpoint** `POST /api/settings/capabilities/:type/toggle` stays for singletons (delegates to `toggleByName` with the first-and-only instance).

Deprecation of the old endpoints is a separate post-sprint cleanup; this sprint is strictly additive.

### Coexistence with `playwright-screenshot-bridge`

`packages/dashboard/src/playwright/playwright-screenshot-bridge.ts` registers a separate MCP server `playwright-screenshot` (`app.ts:1689-1693`) using direct Playwright (not `@playwright/mcp`). Post-migration, Nina may have:
- `mcp__playwright-screenshot__*` — direct Playwright, ephemeral tmp profile (unchanged).
- `mcp__browser-chrome__*` — `@playwright/mcp` with capability-owned profile.
- `mcp__browser-edge__*` — `@playwright/mcp` with different capability-owned profile.

These do not collide because each uses a distinct `user-data-dir` and Playwright's SingletonLock is enforced *per user-data-dir*, not per binary. The screenshot bridge's ephemeral profile is unique per launch.

If this set-of-three feels like pollution post-sprint, file a FOLLOW-UPS item to deprecate the bridge once `browser-control` capabilities are universally present. Not this sprint.

### Routing decision — how Nina picks

No code parses standing orders. Nina sees `mcp__browser-chrome__*` and `mcp__browser-edge__*` tools in her list; standing orders in her system prompt tell her which to use when. Template ships with a suggested standing-order phrasing so new users know what to write.

If only one browser capability exists, there's nothing to pick — she uses it.

---

## Workstreams

### Phase A — Registry + template (no consumer changes yet)

1. Write `skills/capability-templates/browser-control.md`. Mirror `desktop-control.md`'s structure. Parameterize `$BROWSER`, `$USER_DATA_DIR`, `$EXECUTABLE_PATH`, `$ICON_SLUG`. Include standing-orders template snippet and a non-empty `userDataDir` requirement in the schema.
2. Add `listByProvides(type)` and `toggleByName(name)` to `registry.ts`. Keep `has`, `get`, `isEnabled`, `toggle` with documented "first-match" semantics. Unit tests for both new methods + regression tests confirming old semantics unchanged.
3. Add `canDelete: boolean` field to `Capability` type. `true` for multi-instance types (via allowlist), `false` otherwise. Scanner populates it.
4. Add registry method `delete(name, { wipeProfile?: boolean })`: stops spawned MCP (if wired), removes capability folder, optionally removes `.my_agent/browser-profiles/<name>/`, emits `capability:changed`. Guarded behind `canDelete`.
5. Add CI grep test: zero `.find(c => c.provides === 'browser-control')` or `.get('browser-control')` — force contributors to use `listByProvides`.

### Phase B — Manual scaffold (the temporary crutch)

6. Create `.my_agent/capabilities/browser-chrome/` manually, following the template exactly. Thin wrapper spawning `@playwright/mcp --browser chrome --user-data-dir <abs>`.
7. Validate via existing test harness.
8. Commit. This is the template's first customer — any rough edges surface here.

**Note:** Until Phase F removes this folder, the manual `browser-chrome` serves as the always-present capability that keeps the dual-path migration safe (avoids the "zero browsers registered" gap flagged in the audit).

### Phase C — Dual-path migration (S3 proven-safe pattern)

9. At both call sites (`session-manager.ts:170-174` and `automation-executor.ts:350-355`):
   - Add registry-driven branch: iterate `registry.listByProvides('browser-control').filter(c => c.status === 'available' && c.enabled)`, register each as its own MCP server (key = capability `name`).
   - **Keep** hardcoded `@playwright/mcp` registration as a fallback, gated by `if (browserCaps.length === 0)`. This ensures Nina never loses browser tools during the transition.
   - Log which path is active.
10. Runtime verify: restart dashboard, confirm Nina sees `mcp__browser-chrome__*` tools (registry path is firing). Confirm fallback path logs indicate "no browser capabilities, using hardcoded chrome" when the manual folder is temporarily disabled.
11. Commit.
12. Migrate `app.ts:1656` MCP factory wiring to `listByProvides('desktop-control').filter(enabled)[0]` in the same pass (cheap future-proofing for multi-display-server support). Verify desktop-x11 still registers.
13. Remove hardcoded fallback branches only after Phase F passes (not before — that's the audit's C3 fix).

### Phase D — API + Settings UI multi-instance

14. Add `GET /api/settings/capabilities/v2` response shape. Old endpoint unchanged.
15. Add `POST /api/settings/capabilities/:type/:instance/toggle`. Old toggle endpoint unchanged (delegates internally).
16. Add `DELETE /api/settings/capabilities/:type/:instance?wipeProfile=true|false`. Returns 403 for `canDelete: false`. Removes the capability folder; if `wipeProfile=true`, also removes the corresponding `.my_agent/browser-profiles/<name>/`. Default `wipeProfile=false`. Confirmation is frontend-only.
17. Bundle browser SVG icons under `packages/dashboard/public/icons/browsers/{googlechrome,microsoftedge,firefox,safari,brave,generic}.svg` from simple-icons.
18. Update `stores.js` to consume `/v2`. Preserve public Alpine store surface: `$store.capabilities.has(type)`, `.get(type)`, `.list()` continue to return the same shapes they return today (pulled from `instances[0]` when `multiInstance: false`, or aggregated for multi-instance).
19. Update `ws-client.js` broadcast consumer to new shape.
20. Rewrite the Alpine capabilities card (`index.html:3014-3655`):
    - Singleton types render unchanged (visual regression check).
    - Multi-instance types render as group card with instance boxes, icons, toggles, trash icons, and persistent hint.
    - Delete confirmation dialog.
    - "Ask {agent} to add any browser" hint always visible inside the Browsers card.
21. Wire `capability:changed` listener in the settings component so new installs appear without reload.

### Phase E — Test fixture + harness

22. Create `packages/core/tests/fixtures/browser-chrome-fixture/` mirroring the real capability with mock tools.
23. Write `browser-extraction.test.ts`:
    - Scanner discovers capability with correct `provides`/`interface`/`entrypoint`.
    - `listByProvides('browser-control')` returns expected set.
    - `toggleByName` writes/removes `.enabled` under the correct folder.
    - `delete()` removes folder, emits event, guards `canDelete: false`.
    - Harness spawns fixture, lists tools.
24. Add a multi-instance test: two fixtures side-by-side, verify both register as distinct MCP servers, toggle independently, delete independently.
25. Add visual regression screenshot: singleton capability rows (`Voice Input`, `Image Generation`, `Desktop Control`) render identically pre- and post-sprint.

### Phase F — Agent-builds-from-scratch acceptance gate

Inherits S4's structured-reflection pattern ([review.md](../m9.5-s4-template-verification/review.md) §build-from-scratch).

26. Delete the manual `.my_agent/capabilities/browser-chrome/` folder.
27. In the dashboard chat, ask Nina *"add Chrome support."*
28. Acceptance criteria:
    - `capability-brainstorming` skill routes to `capability-builder`.
    - Builder produces a working `browser-chrome/` (or equivalent slug) from the template only — no internal hints from the developer.
    - Nina can navigate a page and take a screenshot with the newly-built capability.
    - Harness test passes against the agent-built capability.
29. **Capped iterations:** max 3 attempts. Between attempts, collect structured reflection from Nina per S4's review questionnaire (what was unclear in the template? what did you guess? what failed and why?). Update the template.
30. **Stopping rule:** if iteration 3 fails, ship the **committed fixture** (from Phase E) as a registered fallback capability so the sprint still delivers a working browser, file a `FOLLOW-UPS.md` item "browser template insufficient for single-shot agent build — further S4-style iteration needed," and flag as a known limitation in review.md. The sprint does not hold on a perfect template; template quality is iterative.
31. Optional: repeat with *"add Edge support"* to confirm multi-instance story holds. If tight on time, defer to a follow-up.

### Phase G — Final cleanup (only if F passes cleanly)

32. Remove the hardcoded `@playwright/mcp` fallback branch introduced in Phase C step 9. Commit separately.
33. Run full test suite + TypeScript check.

---

## Risks

| Risk | Mitigation |
|------|------------|
| `registry.get/has` callers miss the "first-match" warning and a browser call-site slips through | CI grep test (Phase A step 5); code review focus |
| API shape change cascades into frontend bugs | Strict additive migration: keep old endpoints + preserve Alpine store surface |
| Phase F agent build fails repeatedly | Capped at 3 iterations; committed fixture as fallback; template iteration deferred to follow-up |
| Delete endpoint destroys data a user didn't intend to lose | Default is non-destructive (profile preserved); wipe is explicit opt-in via checkbox |
| Chrome SingletonLock collision with host browser | Profile at `.my_agent/browser-profiles/<name>/` (distinct from host browser's default data dir); each capability has its own profile folder |
| Scope (S3 + S4 + UI redesign + delete affordance) | Phases D and F are the schedule risk. If D slips, capability still works and settings UI shows it as singleton. If F slips, fixture fallback (Phase F step 30) ships the feature. Two escape valves built in. |
| Race between rapid toggle clicks | Per-capability `.enabled` file writes are already independent; Alpine debounce on UI side handles the rest |
| Screenshot bridge and `browser-chrome` both run Chromium | Distinct `user-data-dir`; no collision. Consolidation deferred to follow-up. |

---

## Success criteria

- [ ] `skills/capability-templates/browser-control.md` exists and is complete
- [ ] `Registry.listByProvides` and `Registry.toggleByName` land with tests; legacy `get/has/toggle` semantics preserved
- [ ] CI grep test prevents future `.find(c => c.provides === 'browser-control')` regressions
- [ ] `.my_agent/capabilities/browser-chrome/` built by the agent (not by hand) passes harness tests — **or** committed fixture fallback ships with a documented follow-up
- [ ] Nina can navigate a page using the registered MCP server
- [ ] Settings UI shows the Browsers card with per-instance toggle, delete, and persistent "Ask {agent} to add any browser" hint
- [ ] Delete flow removes the capability folder (including profile dir) after confirmation
- [ ] A second browser capability (manually created fixture or agent-built) registers alongside the first, toggles independently, deletes independently
- [ ] Hardcoded `@playwright/mcp` fallback deleted (or documented as intentionally retained pending agent-build verification)
- [ ] Desktop-control and other singleton capabilities render unchanged in settings (visual regression check)
- [ ] `app.ts:1656` desktop-control factory migrated to `listByProvides` pattern for multi-display-server future-proofing

## References

- [Capability Framework v2 design](../../design/capability-framework-v2.md)
- [M9.5-S3 Desktop Extraction](../m9.5-s3-desktop-extraction/plan.md) — dual-path pattern
- [M9.5-S4 Template Verification](../m9.5-s4-template-verification/plan.md) — agent-builds-from-scratch pattern + structured reflection
- [M9.5-S6 Screenshot Pipeline](../m9.5-s6-screenshot-pipeline/spec.md) — browser capability benefits for free
- [@playwright/mcp CLI reference](https://github.com/microsoft/playwright-mcp) — browser flag accepts `chrome | firefox | webkit | msedge` (not `chromium`)
- [simple-icons](https://simpleicons.org/) — MIT-licensed browser logos
