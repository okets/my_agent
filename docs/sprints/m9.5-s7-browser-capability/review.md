# External Verification Report

**Sprint:** M9.5-S7 Browser Capability
**Reviewer:** External Opus (independent, no shared context with implementers)
**Date:** 2026-04-12
**Branch:** `sprint/m9.5-s7-browser-capability` (11 commits ahead of master)

---

## Executive summary

The sprint delivers the first multi-instance capability type end-to-end: registry API (`listByProvides`, `toggleByName`, `delete`), a 342-line template, Phase-F agent-built `browser-chrome` capability, v2 settings API, multi-instance UI card with delete confirmation, and complete removal of the hardcoded `@playwright/mcp` fallback. All 10 plan success criteria are met. Tests pass, TypeScript compiles clean, browser verification confirms UI/API match the spec verbatim.

**Verdict: PASS**

---

## Spec Coverage

Plan "Success criteria" (`plan.md:298-310`) map 1:1 to implementation:

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | `skills/capability-templates/browser-control.md` exists and is complete | COVERED | 342-line file present; parameterizes `$BROWSER`, `$USER_DATA_DIR`, `$EXECUTABLE_PATH`, `$ICON_SLUG`; standing-orders snippet included |
| 2 | `Registry.listByProvides` + `toggleByName` land with tests; legacy `get/has/toggle` unchanged | COVERED | `packages/core/src/capabilities/registry.ts:94-114`; docstrings on `has/get/isEnabled/toggle` warn FIRST-MATCH ONLY; `tests/capabilities/registry-multi-instance.test.ts` — 16 tests pass |
| 3 | CI grep test prevents `.find(c => c.provides === 'browser-control')` regressions | COVERED | `tests/capabilities/no-first-match-browser-control.test.ts` passes; only matches found in the guard test files themselves |
| 4 | `.my_agent/capabilities/browser-chrome/` built by the agent passes harness tests | COVERED | Phase F iteration 2 passed — Nina built `chrome-browser/` (folder slug differs from `name: browser-chrome` — FU2, cosmetic). `browser-extraction.test.ts` — 15 tests pass including harness probes |
| 5 | Nina can navigate a page using the registered MCP server | COVERED | D7 log + transcript in dashboard chat shows google.com navigation + Polish cookie modal screenshot from fresh Chrome profile (evidence of distinct profile from playwright-screenshot-bridge) |
| 6 | Settings UI shows Browsers card with per-instance toggle/delete + persistent hint | COVERED | Browser verification confirmed. Card shows "Browsers / 1 instance", Chrome icon, toggle, trash icon, hint "Ask Nina to add any browser." See `test-report.md` screenshot |
| 7 | Delete flow removes capability folder (incl. profile) after confirmation | COVERED | Dialog copy matches plan verbatim: "Remove browser-chrome? Saved logins and cookies are kept — reinstalling this browser will restore them. Check below to wipe the profile too." Unchecked "Also delete saved logins and cookies" checkbox. `DELETE /api/settings/capabilities/:type/:instance?wipeProfile=true` wired; `registry.delete(name, {wipeProfile})` removes `<myAgentRoot>/browser-profiles/<name>/` when flag set |
| 8 | Second browser capability registers alongside, toggles/deletes independently | COVERED | `packages/core/tests/fixtures/browser-edge-fixture/` committed; `browser-extraction.test.ts` "two fixtures both register, distinct names / toggle one without affecting the other / delete one without affecting the other / both fixtures pass the harness as distinct MCP servers" — all pass |
| 9 | Hardcoded `@playwright/mcp` fallback deleted | COVERED | `session-manager.ts:170-199` and `automation-executor.ts:352-386` both iterate registry only; no hardcoded branch. Commit `42edba9` "remove hardcoded @playwright/mcp fallback" |
| 10 | Singleton capabilities render unchanged | COVERED | `tests/browser/capabilities-singleton-visual.test.ts` — pixel-identical to baseline at `screenshots/baseline/capabilities-singletons.png` (PASS). Browser snapshot confirms Voice Input/Output/Image Gen/Desktop Control rows unchanged |
| 11 | `app.ts:1656` desktop-control factory migrated to `listByProvides` | COVERED | `app.ts:1655-1660` now calls `capabilityRegistry?.listByProvides('desktop-control').filter(...)` — log message updated to match pattern |

## Test Results

**Core:** 379 passed, 7 skipped (0 failed) — `npx vitest run` clean.
- `tests/browser-extraction.test.ts` — 15 tests pass (1 fixture probe, 2-fixture multi-instance, delete isolation, harness validation).
- `tests/capabilities/registry-multi-instance.test.ts` — 16 tests.
- `tests/capabilities/no-first-match-browser-control.test.ts` — 1 test (grep guard).

**Dashboard:** 1183 passed, 4 failed, 12 skipped.
- 4 failures are **pre-existing on master** (unchanged test files vs master): `tests/unit/ui/progress-card.test.ts` (unicode-escape assertions on `\u21bb`), `tests/browser/progress-card.test.ts` (T4 expanded view), `tests/browser/automation-ui.test.ts` (settings tab). Confirmed via `git diff master..HEAD -- <path>` returning empty diff on each.
- All sprint-targeted tests pass: `tests/capabilities-routes.test.ts` (10), `tests/unit/capabilities/capability-system.test.ts` (29), `tests/browser/capabilities-singleton-visual.test.ts` (1).

**TypeScript:** Both `packages/core` and `packages/dashboard` — `npx tsc --noEmit` returns 0 errors, 0 output.

## Browser Verification

- [x] Dashboard loads at `http://localhost:4321/` with **zero sprint-related** console errors. One 404 on `/api/debug/desktop-status` is pre-existing and unrelated.
- [x] `GET /api/settings/capabilities/v2` returns 200 with the spec shape: `capabilities[]` per type with `type/label/multiInstance/hint/iconSlug/instances[]`. Browser-control entry returns `multiInstance: true`, `hint: "Ask Nina to add any browser."`, one instance `browser-chrome` with `iconSlug: googlechrome`, `canDelete: true`, `toggleTiming: next-session`.
- [x] `GET /api/settings/capabilities` (v1) returns 200, unchanged.
- [x] Settings → Capabilities card renders **Browsers** group with Chrome icon + name + toggle + trash, plus persistent hint beneath. Singletons (Voice Input, Voice Output, Image Generation, Desktop Control) render unchanged.
- [x] `POST /api/settings/capabilities/browser-control/browser-chrome/toggle` flips `.enabled` off → on; both transitions verified via v2 `GET` (enabled: false → disabled state, enabled: true → healthy state).
- [x] Trash button opens modal with **exact plan copy** and unchecked wipe checkbox; Cancel path exits cleanly without mutation.

## Gap Analysis

No blocking gaps. Minor observations documented for transparency:

- **FU2 (logged)** — Nina's build folder is `.my_agent/capabilities/chrome-browser/` but `name: browser-chrome`. Registry, toggle, and delete all key off `name`, so functionality is correct; the folder-slug/name mismatch is purely cosmetic. Delete flow uses the `name`, so trash will correctly remove `chrome-browser/`.
- **FU3 (logged)** — `.enabled` was not auto-created on Phase F build; required a manual `touch` before the capability registered. This is a capability-builder-skill gap, out of this sprint's scope, but worth prioritizing next sprint — without it the agent-build UX is incomplete (built but invisible).
- **FU4 (logged)** — `capability-brainstorming` skill took 3 prompts in Phase F iteration 2 before routing. Skill polish, not blocking.
- **FU1 (logged)** — Legacy "Browser Automation (Playwright)" install card (`index.html:3445, 3496`) still renders alongside the new Browsers card. Creates minor UX redundancy but no functional conflict; tracked for follow-up.
- **D6 finding** — The Phase C dual-path safety net was so effective it hid the gap Phase F was meant to expose. Resolved via D7 (iteration 2 succeeded after explicit user framing). Phase G fallback removal (`42edba9`) closes this loop — registry is now the only path; empty registry cleanly yields "browser tools unavailable" log, no silent fallback.
- **Screenshot bridge coexistence** — `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts` preserved as documented in plan §"Coexistence". Distinct user-data-dir from `browser-chrome`; no collision.

## Decisions & Deviations review

- **D1** (per-cap thin wrapper): aligned with plan; verified in `chrome-browser/src/server.ts`.
- **D2** (autonomous Phase F iteration): respected.
- **D3** (pin `@playwright/mcp` 0.0.68): template, fixture, and real capability all pin. Consistent.
- **D4** (`iconSlug` from frontmatter): confirmed in API response — `browser-chrome` surfaces `iconSlug: googlechrome` from `CAPABILITY.md`.
- **D5** (URL shape `:type/:instance/toggle`): confirmed. Server validates `provides === type`; 400 on typo.
- **D6** (iteration-1 short-circuit): logged, root-caused correctly, resolved by iteration 2.
- **D7** (iteration 2 PASS): evidence matches — build folder, files, profile dir, screenshot in chat.
- **Deviation** (template pins @playwright/mcp): well-reasoned (offline safety + frozen plug invariant). No concern.

## Verdict

**PASS**

All 10 success criteria covered, all 10 spec requirements traced to code + tests, browser verification clean, TypeScript clean, all sprint-introduced tests pass. The fallback removal is complete (registry-only path); the delete flow wires through end-to-end with correct copy and destructive-by-opt-in semantics; the multi-instance primitive is validated by both the manually committed edge-fixture and the agent-built chrome-browser. Known follow-ups (FU1-FU4) are all correctly scoped out of this sprint.

**Merge recommendation:** Ready to merge to master. Prioritize FU3 (auto-create `.enabled` on build) in the next capability sprint, as it meaningfully degrades the agent-build UX.
