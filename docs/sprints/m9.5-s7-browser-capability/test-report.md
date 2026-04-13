# M9.5-S7 External Test Report

**Reviewer:** External Opus
**Date:** 2026-04-12
**Branch:** `sprint/m9.5-s7-browser-capability` @ `2508406`
**Base:** `master` @ `5c60a72`

---

## 1. Diff scope

```
46 files changed, 5087 insertions(+), 118 deletions(-)
```

Major additions:
- `skills/capability-templates/browser-control.md` (342 lines)
- `packages/core/src/capabilities/well-known-types.ts` (62 lines, new)
- `packages/core/src/capabilities/registry.ts` (+115 lines: `listByProvides`, `toggleByName`, `delete`)
- `packages/core/tests/browser-extraction.test.ts` (228 lines)
- `packages/core/tests/capabilities/registry-multi-instance.test.ts` (221 lines)
- `packages/core/tests/capabilities/no-first-match-browser-control.test.ts` (112 lines)
- `packages/core/tests/fixtures/browser-chrome-fixture/` + `browser-edge-fixture/`
- `packages/dashboard/src/routes/capabilities.ts` (+236 lines: v2 routes)
- `packages/dashboard/public/index.html` (+198 lines: multi-instance card + delete dialog)
- `packages/dashboard/public/icons/browsers/` (brave, firefox, generic, googlechrome, microsoftedge, safari SVGs)
- `packages/dashboard/tests/browser/capabilities-singleton-visual.test.ts` + baseline PNG
- `docs/sprints/m9.5-s7-browser-capability/screenshots/baseline/capabilities-singletons.png`

---

## 2. TypeScript checks

```bash
cd packages/core && npx tsc --noEmit      # → 0 errors, 0 output
cd packages/dashboard && npx tsc --noEmit # → 0 errors, 0 output
```

**Result:** Clean on both packages.

---

## 3. Test suite — core

```
Test Files  43 passed | 1 skipped (44)
     Tests  379 passed | 7 skipped (386)
Duration    28.71s
```

Sprint-targeted subsets (verified individually):

```
tests/capabilities/no-first-match-browser-control.test.ts  1 test  pass
tests/capabilities/registry-multi-instance.test.ts         16 tests pass
tests/browser-extraction.test.ts                           15 tests pass
  ✓ reads provides, interface, entrypoint from frontmatter (383ms)
  ✓ testCapability returns ok with at least one tool       (1702ms)
  ✓ two browser-control fixtures both register, distinct names (462ms)
  ✓ toggle one without affecting the other                 (415ms)
  ✓ delete one without affecting the other                 (430ms)
  ✓ both fixtures pass the harness as distinct MCP servers (2007ms)
```

---

## 4. Test suite — dashboard

```
Test Files  3 failed | 136 passed | 4 skipped (143)
     Tests  4 failed | 1183 passed | 12 skipped (1199)
Duration    59.72s
```

**Failures verified as pre-existing on master** (unchanged test files):

```bash
git diff master..HEAD -- \
  packages/dashboard/tests/unit/ui/progress-card.test.ts \
  packages/dashboard/tests/browser/progress-card.test.ts \
  packages/dashboard/tests/browser/automation-ui.test.ts
# → empty output (no sprint modifications)
```

The failures:
1. `tests/unit/ui/progress-card.test.ts` — "uses correct status colors from design spec"
2. `tests/unit/ui/progress-card.test.ts` — "uses correct status icons" (asserts `\u21bb`)
3. `tests/browser/progress-card.test.ts` — "T4: expanded view shows all steps with status icons"
4. `tests/browser/automation-ui.test.ts` — "settings tab shows automation schedule editor"

These match the reported pre-existing baseline exactly.

Sprint-introduced tests verified individually:

```
tests/capabilities-routes.test.ts                      10 tests  pass
tests/unit/capabilities/capability-system.test.ts      29 tests  pass
tests/browser/capabilities-singleton-visual.test.ts     1 test   pass (pixel-identical to baseline)
```

---

## 5. Browser verification (Playwright MCP)

Dashboard running via systemd (`nina-dashboard.service`) on `http://localhost:4321`.

### 5.1 Page load

```
Page URL:   http://localhost:4321/
Page Title: {agent} — Dashboard
Console:    1 error (pre-existing 404 on /api/debug/desktop-status, unrelated)
            1 warning (pre-existing)
```

### 5.2 Capabilities card — visual

Screenshot saved: `m9.5-s7-capabilities-card.png`.

Observed layout top→bottom:
- **Voice Input** — singleton row, "Deepgram STT" sublabel, toggle off (disabled).
- **Voice Output** — singleton row, "Edge TTS" sublabel, toggle off.
- **Image Generation** — singleton row, "Ask Nina to add image generation" hint (no instance).
- **Desktop Control** — singleton row, "Desktop X11" sublabel, toggle on (checked, green).
- **Browsers** (group card, bordered) — header "Browsers / 1 instance":
  - Instance row: full-color Chrome SVG icon + `browser-chrome` label + green health dot + checked toggle + trash icon.
  - Persistent italic hint: "Ask Nina to add any browser."

### 5.3 API shape verification

`GET /api/settings/capabilities/v2`:

```json
{"capabilities":[
  {"type":"audio-to-text","label":"Voice Input","multiInstance":false,
   "hint":"Ask Nina to add voice input",
   "instances":[{"name":"Deepgram STT","label":"Deepgram STT","enabled":false,
                 "state":"disabled","canToggle":true,"canDelete":false,
                 "toggleTiming":"immediate","health":"untested"}]},
  {"type":"text-to-audio", ...},
  {"type":"text-to-image","label":"Image Generation","multiInstance":false,
   "hint":"Ask Nina to add image generation","instances":[]},
  {"type":"desktop-control","label":"Desktop Control","multiInstance":false,
   "hint":"Ask Nina to add desktop control",
   "instances":[{"name":"Desktop X11",...,"canDelete":false,...}]},
  {"type":"browser-control","label":"Browsers","multiInstance":true,
   "hint":"Ask Nina to add any browser.",
   "iconSlug":"browser",
   "instances":[{"name":"browser-chrome","label":"browser-chrome",
                 "iconSlug":"googlechrome","enabled":true,"state":"healthy",
                 "canToggle":true,"canDelete":true,
                 "toggleTiming":"next-session","health":"untested"}]}
]}
```

Exact match to `plan.md:152-174` shape, with `{agent}` substituted → "Nina".

`GET /api/settings/capabilities` (v1) → HTTP 200 (backward-compat confirmed).

### 5.4 Toggle flow (per-instance)

```
GET  /v2                                           enabled: true,  state: healthy
POST /capabilities/browser-control/browser-chrome/toggle
→ {"enabled":false,"effective":"next_session"}
GET  /v2                                           enabled: false, state: disabled
POST /capabilities/browser-control/browser-chrome/toggle
→ {"enabled":true,"effective":"next_session"}
GET  /v2                                           enabled: true,  state: healthy
```

Endpoint semantics correct. `effective: next_session` matches MCP-interface capability timing. No dashboard process restart was required by the toggle.

### 5.5 Delete dialog

Trash icon click opens modal:

```
Heading: "Remove capability"
Body:    "Remove browser-chrome? Saved logins and cookies are kept —
          reinstalling this browser will restore them. Check below to
          wipe the profile too."
Checkbox (unchecked): "Also delete saved logins and cookies"
Buttons: Cancel | Remove
```

Copy matches `plan.md:128-132` exactly. Cancel dismissed the modal without mutation. **Did not** click Remove (preserves canonical capability per review instructions).

---

## 6. Registry / harness verification

`packages/core/tests/browser-extraction.test.ts` execution covers every assertion from the "Headless App / harness verification" checklist in the review brief:

- `registry.listByProvides('browser-control')` returns fixtures list — verified (`two browser-control fixtures both register, distinct names`).
- `canDelete === true` populated for browser-control instances — verified via `registry-multi-instance.test.ts` (`canDelete true for browser-control, false for singleton`).
- `has('browser-control')` / `.get('browser-control')` preserved singleton semantics — verified in `registry-multi-instance.test.ts` (legacy `has/get/isEnabled/toggle` regression tests) + grep lint guard at `no-first-match-browser-control.test.ts`.
- `toggleByName` toggles `.enabled` — verified (`toggleByName creates .enabled file when off → on` and inverse).
- `delete()` guarded by `canDelete` — verified (`delete throws on singleton without canDelete`, `delete removes folder + emits event`).

---

## 7. Fallback removal verification (Phase G)

Confirmed both call sites iterate the registry only, with no hardcoded fallback branch:

`packages/dashboard/src/agent/session-manager.ts:170-199`:
```ts
const browserCaps = capabilityRegistry
  ?.listByProvides("browser-control")
  .filter((c) => c.status === "available" && c.enabled) ?? [];
for (const cap of browserCaps) {
  servers[cap.name] = { type: "stdio", command, args, env };
}
// no else-fallback
```

`packages/dashboard/src/automations/automation-executor.ts:352-386`: same pattern, same absence of fallback.

Empty registry yields log `browser-control: no capabilities registered — browser tools unavailable` — **no silent fallback to `npx @playwright/mcp`**.

## 8. Coexistence checks

- **playwright-screenshot-bridge** — still present at `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts` (4689 bytes, unmodified). Uses ephemeral tmp profile, distinct from `.my_agent/browser-profiles/browser-chrome/`. No collision.
- **Hatching informational find** — `hatching-tools.ts:229` still uses `.find(c => c.provides === 'desktop-control')` as plan explicitly permitted ("Leave as-is, informational only").
- **`app.ts:1656` migration** — completed. Uses `listByProvides('desktop-control').filter(...)[0]` with explicit status/enabled filters.

## 9. Files on disk

```
.my_agent/capabilities/
├── chrome-browser/                 # Phase F agent-build deliverable
│   ├── .enabled                    # manually touched (FU3)
│   ├── CAPABILITY.md               # name: browser-chrome, icon: googlechrome
│   ├── config.yaml                 # browser: chrome, headless: true
│   ├── package.json                # @playwright/mcp pinned
│   ├── node_modules/               # installed
│   ├── references/
│   ├── screenshots/
│   ├── scripts/                    # detect.sh, setup.sh, launch.sh, screenshot.sh
│   └── src/server.ts               # thin wrapper
├── desktop-x11/                    # unchanged
├── smoke-test-cap/
├── stt-deepgram/
├── tts-edge/
└── tts-edge-tts/

.my_agent/browser-profiles/
└── browser-chrome/                 # persistent profile from Phase F live run
```

Folder name (`chrome-browser/`) does not match capability `name` (`browser-chrome`) — FU2 documented. Functionally harmless; registry keys off `name`.

---

## 10. Summary

| Check | Status |
|-------|--------|
| TypeScript compiles (core + dashboard) | PASS |
| Core tests | PASS (379/386) |
| Dashboard tests (sprint subset) | PASS (40/40) |
| Dashboard pre-existing failures match master | CONFIRMED |
| Dashboard loads without sprint-introduced errors | PASS |
| v2 API shape matches spec | PASS |
| v1 API still works (backward compat) | PASS |
| Browsers card rendering | PASS (matches plan §"Settings UI") |
| Singleton visual regression | PASS (pixel-identical to baseline) |
| Toggle flow (per-instance) | PASS |
| Delete confirmation dialog copy | PASS (exact match) |
| Fallback fully removed | PASS |
| Screenshot bridge preserved | PASS |
| `app.ts:1656` migrated | PASS |
| Agent-built capability functional | PASS (with caveats FU2/FU3) |
| Anti-pattern grep guard | PASS |

**Overall: PASS.**
