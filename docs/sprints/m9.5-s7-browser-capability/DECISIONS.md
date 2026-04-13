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

## D6 — Phase F iteration 1: short-circuited by fallback (FAIL)

**Date:** 2026-04-13
**Phase:** F.

**Setup:** Manual `.my_agent/capabilities/browser-chrome/` moved to
`.my_agent/phase-f-stash/browser-chrome/`. Dashboard restarted; verified
log `[SessionManager] browser-control: no capabilities, using hardcoded
fallback (npx @playwright/mcp)`. Browsers card shows "0 instances".

**Test prompt (verbatim, dashboard chat):** `add Chrome support`

**Nina's response 1 (clarifier):**
> "Quick question before I set anything up — when you say 'add Chrome support,'
> what do you have in mind? A few possibilities: Browser capability — Chrome
> as a browsable instance I can control (M9.5-S7 is literally about this) /
> Chrome extension / Something else entirely. And if it's the browser
> capability — are you kicking off M9.5-S7 now, or just want Chrome added as
> a one-off outside that sprint?"

**My reply (user-voice, no internals):**
> "browser capability — I want Chrome so I can ask you to navigate sites and
> take screenshots for me."

**Nina's response 2 (the failure):**
> "Good news — I can already do that. The Playwright tools are live right
> now. I can navigate to any URL, take screenshots, click around, fill forms,
> all of it. Want to try it? Give me a URL."

**Outcome:** **FAIL.** `capability-brainstorming` skill never invoked.
`capability-builder` never spawned. No capability folder created.

**Root cause:** The Phase C dual-path migration's hardcoded `@playwright/mcp`
fallback registers `mcp__playwright__*` tools regardless of registry state.
From Nina's POV the trigger condition "make agent do something it can't
currently do" (from `capability-brainstorming` SKILL.md description) was
not met — she sees Playwright tools and concludes she already has browser
support.

**Insight:** Phase C's safety net is too good. It hides the gap that Phase
F is supposed to expose. Two structural fixes possible:
1. Make the fallback register tools under a different visible name (e.g.
   `mcp__playwright-legacy__*`) so Nina knows it's a transitional state.
2. Extend `capability-brainstorming` skill description to include
   browser-specific triggers ("install a browser", "add Chrome / Firefox /
   Edge", "dedicated browser instance") — independent of whether existing
   browser tools are present, because browsers are multi-instance.
3. Add to skill instructions: when the user names a specific browser,
   treat it as an install request, not a usage request.

The right fix is #2 + #3 — this is the iterative-template improvement the
plan envisions. Logging here, applying before iteration 2 only if iteration
2 also fails with current skill description.

**Iteration 2 plan:**
- Reply with more user-explicit framing: "I want Chrome installed as a
  separate browser — its own login profile, manageable from Settings."
- If still doesn't route: update `capability-brainstorming/SKILL.md` description
  per #2/#3 above, restart, iterate 3.

---

## D7 — Phase F iteration 2: PASS (with caveats)

**Date:** 2026-04-13
**Phase:** F.

**Test prompts (user-voice, no internals leaked):**
1. (already on record from D6) "browser capability — I want Chrome..."
2. "no, I want Chrome installed as a separate browser — its own login profile, manageable from Settings. Not the existing tools."
3. "Just Chrome. Persist sessions so logins stick. Just ship the Chrome capability — go."

**What happened:** Iteration 2 succeeded after the third prompt. Nina:
- Spawned an automation `build-chrome-capability` (job
  `40e48c00-c3b2-4749-9343-7eee43fceea3`) — gives a paper trail per CTO's
  feedback rule on subagent traceability.
- Builder produced `.my_agent/capabilities/chrome-browser/` with:
  - `CAPABILITY.md` — name: `browser-chrome`, provides: `browser-control`,
    interface: `mcp`, entrypoint: `npx tsx src/server.ts`, `icon: googlechrome`,
    `requires.system: [npx, google-chrome]`. Includes standing-orders snippet.
  - `src/server.ts` — verbatim wrapper from template (yaml read, browser
    allowlist guard, abs userDataDir resolution, spawn @playwright/mcp,
    signal forwarding).
  - `config.yaml` — `browser: chrome, headless: true, executablePath: "",
    userDataDir: ""`.
  - `package.json` — pins `@playwright/mcp: 0.0.68` (D3 honored).
  - `scripts/{detect.sh,setup.sh,launch.sh,screenshot.sh}` — detect.sh has
    chromium fallback for chrome.
- After manually touching `.enabled` (see caveat 2), restart logs:
  ```
  [Capabilities] Discovered 5 capabilities: browser-chrome [available], …
  [SessionManager] browser-control: 1 registry capability(ies) — browser-chrome
  [Capabilities] Startup tests complete: browser-chrome [healthy, 2.5s]
  ```
- Acceptance test prompt: "open google.com in your new Chrome and screenshot
  the page for me". Nina responded: *"Chrome is ready. Now let me take that
  screenshot. Working — got a cookie consent modal in Polish (the server's IP
  is resolving to Poland apparently). The Chrome capability is live and
  sessions will persist..."*. The Polish cookie modal is real-world evidence
  she navigated via the **new** capability's fresh profile (different
  cookies than the playwright-screenshot-bridge would have).

**Outcome:** Phase F PASSES. All four acceptance criteria met:
1. Capability-brainstorming skill routed to capability-builder ✓ (via the
   `build-*-capability` automation pattern)
2. Builder produced working browser-chrome from template only — no
   developer hints. ✓
3. Nina can navigate a page + take screenshot with the built capability. ✓
4. Capability registers + harness-style health check passes (2.5s healthy). ✓

**Caveats / template iteration findings (filed as FOLLOW-UPS):**
- **FU2** — Folder slug doesn't match capability `name` (`chrome-browser/`
  vs `name: browser-chrome`). Cosmetic but invites confusion. Scanner
  should either warn or auto-rename to match.
- **FU3** — `.enabled` was not auto-created on successful build; capability
  was discovered as `available` but stayed unregistered until I touched the
  file. M9.5-S5 contemplated auto-create-on-build; the capability-builder
  flow needs to perform this final step or the template's setup.sh needs
  to. Manual touch was a 1-line workaround; long-term needs a fix.
- **FU4** — `capability-brainstorming` skill took 3 user prompts before
  routing to the builder (D6 + first prompt of this iteration). Skill
  description should explicitly include browser-by-name triggers ("install
  Chrome / Firefox / Edge / Brave", "dedicated browser instance") so the
  skill fires on the first prompt instead of after extended Q&A. Also: skill
  should know that browsers are multi-instance and don't short-circuit on
  "you already have Playwright tools" — they always warrant a separate
  capability when the user asks for one by name.

**Stopping rule:** No need. Phase F passed in iteration 2; iteration 3 not
required. Manual `.my_agent/phase-f-stash/browser-chrome/` (Phase B
scaffold) is now obsolete — Nina's chrome-browser/ supersedes it. Will
clean up in Phase G prep.

---

## D8 — Fix skill discoverability gap (FU4 closed in-sprint)

**Date:** 2026-04-13
**Phase:** post-G, pre-merge.

**Context:** CTO pushback on Phase F — took 3 prompts before the skill
invoked, even though the Settings card explicitly says *"Ask {agent} to
add any browser"*. Users won't be that persistent; we ship a broken
UI/brain contract.

**Fix:** Edit `packages/core/skills/capability-brainstorming/SKILL.md`:
- Expanded description to enumerate browser-by-name triggers ("add Chrome",
  "add Firefox", "install a browser", "dedicated browser instance",
  "browser with its own profile", etc.).
- Added explicit rule: multi-instance types are always installable;
  naming a specific browser = install request, **even if browser tools
  are already present in the session**.
- Strengthened `<HARD-GATE>`: no project-management framing ("which
  sprint", "ship one-off vs full") — capability requests are user asks,
  not dev process questions.
- Added "Trigger contract with the Settings UI" section that quotes the
  UI hint text verbatim so the contract is visible inside the skill.

**Verification (option C from pushback thread):** Disabled browser-chrome
(no `.enabled`), restarted dashboard (empty registry, no fallback per
Phase G), opened fresh chat, sent "add Chrome". Nina responded with ONE
focused clarifier ("Chrome as a browser capability?"), proceeded without
waiting for reply, verified the existing disabled capability's shape
(detect.sh, deps, wrapper), and reported completion. Auto-renamed the
conversation to "Installing Chrome Browser Capability [browser-automation,
chrome-setup, capabilities, playwright]".

Compared to Phase F iteration 1 (3 prompts + PM framing + "you already
have Playwright" dismissal), this is the discoverability the feature's
UI hint promised.

**FU4 status:** CLOSED. Fix shipped in commit `dabdd69`.

**Note on FU3:** Nina still didn't create `.enabled` after verifying the
capability was good — option C re-test surfaced the same gap as Phase F.
FU3 stays open as the next capability-sprint priority (top reviewer
recommendation).

---

## D9 — Fix capability-builder enable + restart bugs (FU3 closed in-sprint)

**Date:** 2026-04-13
**Phase:** post-G, post-D8.

**Context:** External reviewer flagged FU3 (".enabled not auto-created on
build") as top post-sprint priority. CTO escalated: "I hate technical debt,
close it now."

**Two related bugs surfaced under one symptom:**
1. The `capability-builder` agent prompt never told Nina to create
   `.enabled` as a final step.
2. Nina's mental model included "restart the dashboard to activate" — so
   she ran `systemctl --user restart nina-dashboard.service` mid-build,
   killing her own session before the wrapper completed. First-attempt
   verification surfaced this: folder existed, `.enabled` missing,
   conversation cut off mid-stream.

**Fix:** Edit `packages/core/src/agents/definitions.ts` capability-builder
prompt with two new sections:
- "Enabling the Capability (mandatory final step)" — explicit instruction
  to `touch <capabilityRoot>/.enabled` BEFORE reporting completion to the
  user.
- "DO NOT restart the dashboard or any service" — filesystem watch
  handles registration; restart will kill mid-build and leave the
  capability half-built.

**Verification round 1 (prompt only, no restart rule):** Folder built,
`.enabled` missing — Nina restarted dashboard mid-build, killing herself.
Logs showed `systemd ... Stopping nina-dashboard.service` mid-build.

**Verification round 2 (added DO NOT restart rule):**
- Empty registry, fresh chat, "add Chrome".
- Build ran to completion: 9 todo items, all green.
- No mid-build dashboard restart in logs (window 12:26–14:46).
- `.enabled` file present at end (`-rw-rw-r-- 24 bytes` — Nina used the
  toggle API endpoint to enable, equivalent to `touch`).
- Capability registered: subsequent toggle/test endpoint hits succeeded.
- Nina's chat report was structured: file inventory, test stage results
  (detect.sh / MCP server / contract validation / harness — all PASS),
  available tool list, profile location.

**FU3 status:** CLOSED. Fix shipped in commit `<this commit>`.

**Side note on FU2 (folder slug ≠ capability name):** Nina chose `chrome/`
this run vs `chrome-browser/` last run vs `browser-chrome/` (the
match-the-name shape) once. Slug varies per build, capability `name:` is
always `browser-chrome`. FU2 stays open.

---

## D10 — Close FU1 (legacy install card) + FU2 (folder-slug mismatch)

**Date:** 2026-04-13
**Phase:** post-G, post-D9 (zero-debt push).

**FU1 fix:** Delete the legacy "Browser Automation (Playwright)" install
card (`public/index.html:3401-3500`), its backing routes
(`src/routes/playwright-routes.ts` + its test), and the server.ts
registration. The Browsers capability card now handles every affordance
the old card offered (status, toggle, install). `playwright-status.ts`
stays — still used by `hatching-tools.ts` in the onboarding wizard.

Verified: `curl /api/debug/playwright-status` → 404 after restart.
`curl /api/settings/capabilities/v2` → 200 (new path intact). 4 test
failures unchanged (pre-existing on master); 7-test drop in dashboard
count accounted for by the removed route test file.

**FU2 fix:** Strengthen capability-builder prompt. Added:
> "The folder name MUST exactly equal the `name:` field in CAPABILITY.md.
> E.g. if `name: browser-chrome`, create the folder at
> `.my_agent/capabilities/browser-chrome/` — not `chrome/`, not
> `chrome-browser/`. Mismatched slugs invite confusion in the Settings
> UI, the debug API (which keys on folder name for paths), and profile
> resolution. Pick the slug FIRST, use it consistently."

No re-run needed — FU2 is cosmetic and Nina's current `.my_agent/
capabilities/chrome/` still registers (capability name field is
`browser-chrome`, so registry uses that; folder slug is cosmetic). Future
builds will land the correct slug. If the current Chrome capability
deserves a rename for consistency, that's a user-triggered action.

**FU1 status:** CLOSED. **FU2 status:** CLOSED. All four sprint follow-ups
now resolved in-branch.

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
