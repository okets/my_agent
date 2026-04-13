# M9.5-S7 Decisions Log

Decisions made during trip-mode execution. Append-only. CTO reviews via `/trip-review`.

---

## D1 — Per-capability thin wrapper (not shared framework wrapper)

**Date:** 2026-04-12
**Context:** Browser-control capabilities all spawn the same `@playwright/mcp` binary differing only in flags. Open question: per-capability `src/server.ts` vs a shared framework wrapper reading `config.yaml`.

**Decision:** Each browser capability ships its own thin `src/server.ts` (~20 lines). Pure Node `spawn` + stdio passthrough; no MCP SDK import in the wrapper. Template provides verbatim wrapper body with `$BROWSER` / `$USER_DATA_DIR` / `$EXECUTABLE_PATH` placeholders.

**Why:**
- Preserves socket/plug invariant — the plug is a real artifact, not just config. Phase F "agent builds from scratch" acceptance gate requires the agent to produce real code; if the plug collapses to YAML the gate is trivial.
- Consistent with desktop-x11 precedent (`src/server.ts`).
- Per-browser local tweaks (e.g. Edge flag quirks) stay contained.
- Dumbness is the mitigation against duplication drift: `npx tsx src/server.ts` → `spawn('npx', ['@playwright/mcp', '--browser', X, '--user-data-dir', Y])` + pipe stdio. Nothing to drift.

**Alternatives considered:**
- Shared framework wrapper (`packages/core/src/capabilities/browser-runner.ts`) — rejected: capability no longer self-contained; framework bug breaks all browsers; Phase F gate weakens.
- No wrapper at all, CAPABILITY.md `entrypoint` template-substituted — rejected: requires framework argv interpolation feature we don't have yet; same self-containment concerns; Phase F gate becomes "agent writes YAML".

**How to apply:** Phase A template authoring must include the wrapper body verbatim. Phase B manual scaffold follows template exactly. Phase F agent builds from that template.

**Watch for:** If Phase F agent produces buggy wrappers iteration after iteration, signal is that the placeholder approach is too loose — tighten template to full verbatim copy-paste with zero creativity required.

---

## D2 — Iteration-failure handling for Phase F

**Date:** 2026-04-12
**Decision:** Proceed autonomously through all 3 Phase F iterations. Log each attempt's structured reflection in this file. Do not ping CTO between attempts. If iteration 3 fails, ship committed fixture fallback + file FOLLOW-UPS entry, flag in review.md, sprint ends without blocking.

**Why:** CTO on mobile, explicit "you can proceed by yourself" on this question.

---

## D3 — Pin @playwright/mcp in capability's package.json (not npx fetch)

**Date:** 2026-04-13
**Phase:** B (feedback loop into A template).

**Decision:** Browser-control capabilities pin `@playwright/mcp` exactly in
their own `package.json` (e.g. `"@playwright/mcp": "0.0.68"`). `npx` at
runtime resolves the local pinned install first, so no fetch-on-demand.

**Why:** The template originally said "invoked via npx, deliberately not a
direct dependency." Phase B's first scaffold exposed two problems with that:
(1) offline spawns would fail; (2) without a pin anywhere in the resolution
chain, `npx` could pull `latest`, which would silently drift the plug's MCP
server version and break the "frozen plug" invariant from D1. Pinning
locally makes each plug a fully self-contained, version-frozen artifact.

**Alternatives considered:**
- Keep "no dependency, npx fetch-on-demand" — rejected (brittle, version
  drift, requires network on every fresh environment).
- Pin at framework level — rejected (defeats D1 self-containment: the plug
  would depend on framework state to resolve the MCP server).

**How to apply:** Phase A template updated (same commit as Phase B scaffold).
Every future browser capability's `package.json` includes
`"@playwright/mcp": "<exact-version>"`. The version may differ per
capability — upgrades are an opt-in per plug.

**Watch for:** If `npx` starts ignoring the local pin (e.g. future Node/npm
changes to `npx` resolution), switch the wrapper to invoke the binary
directly: `spawn(resolve(capabilityRoot, 'node_modules/.bin/mcp-server-playwright'), ...)`.
The wrapper is already dumb enough that this is a 2-line change.

---

## D4 — `iconSlug` sourced from CAPABILITY.md frontmatter `icon:` field

**Date:** 2026-04-13
**Phase:** D.

**Decision:** The scanner reads an optional `icon:` string from CAPABILITY.md
frontmatter and surfaces it on the `Capability` object as `iconSlug`. The
v2 settings API forwards it on each instance and the UI maps the slug to
`/icons/browsers/<slug>.svg` with a generic-globe fallback on load error.
Type-level fallback `iconSlug` (e.g. `'browser'` on `browser-control`) is
used only when an instance carries no `icon:` of its own.

**Why:** Multi-instance UIs need per-instance branding (Chrome vs Edge vs
Firefox icons distinguish rows at a glance). Using the simple-icons slug
verbatim keeps the system extensible — any future browser or capability
just adds its slug to its frontmatter and drops the SVG under
`packages/dashboard/public/icons/<group>/`. No code change needed per
new browser brand.

**Alternatives considered:**
- UI-side hardcoded mapping (`{ 'browser-chrome': 'googlechrome', ... }`)
  — rejected: every new browser would require dashboard rebuild + restart.
- Inlining the SVG in CAPABILITY.md — rejected: bloats markdown, inconsistent
  with Phase A "template provides $ICON_SLUG placeholder" already settled.

**How to apply:** Browser templates instruct the agent to set
`icon: <simple-icons-slug>` in CAPABILITY.md. Bundled SVGs live at
`packages/dashboard/public/icons/browsers/{googlechrome,microsoftedge,
firefox,safari,brave,generic}.svg`. Generic fallback applies on missing
asset (img.onerror swap).

**Watch for:** If the framework gains a non-browser multi-instance type
(e.g. `llm-provider`), generalise the icon root from `/icons/browsers/`
to `/icons/<provides-type>/` so `iconSlug` resolution stays type-scoped.

---

## D5 — v2 toggle endpoint URL shape: `/:type/:instance/toggle`

**Date:** 2026-04-13
**Phase:** D.

**Decision:** The new per-instance toggle endpoint is
`POST /api/settings/capabilities/:type/:instance/toggle`. Both segments
are validated server-side: the named instance must exist and its
`provides` field must equal `:type`, otherwise 404/400. The legacy
`POST /api/settings/capabilities/:type/toggle` route is preserved
(unchanged behaviour for singletons) and now internally delegates to
`registry.toggleByName(firstInstance.name)` — kept additive.

**Why:** Including `:type` in the v2 path is redundant given that the
instance name is globally unique, but it (a) lets the API layer enforce
that the caller's mental model matches reality (catches typos like
toggling `desktop-control/browser-chrome`); (b) keeps URL shape symmetric
with the DELETE route which needs `:type` for the `canDelete` policy
check; (c) makes server logs self-documenting.

**How to apply:** Frontend always passes both segments. New consumers of
the v2 API should follow the same pattern.

---
