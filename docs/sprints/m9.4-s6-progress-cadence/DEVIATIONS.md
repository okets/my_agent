---
sprint: M9.4-S6
type: deviation log
---

# M9.4-S6 Deviations

## DEV-1 (2026-04-12) — Scope expanded mid-sprint to include progress card UI redesign

**Originally out of scope** (spec §Out of scope, bullet "Progress card template changes"): the sprint was declared prompt-only.

**What happened:** during the `/pair-browse` α-gate smoke test, prompt-only cadence worked (CTO observation: "it is progressing … step 1 is in progress"). But the observation immediately surfaced a pre-existing UX defect that was only visible *because* the cadence now worked: the progress card counter `0/3` was technically correct (0 tasks completed) but read as "nothing is happening" while the step-1 text sat right next to it. Counter semantics (done tally) diverged from step semantics (current work) during the in-progress window.

**Decision:** expand scope and fix the UI confusion in the same sprint rather than spin off an S7. Prompt-only is orthogonal to UI polish — the two changes compose cleanly, and the issue was surfaced specifically by the α-gate, so treating it as sprint feedback is the honest framing.

**What changed:**

- **Counter-semantics split** — the counter pill ("K/N Done") no longer sits inline with the step text. It floats over the top-right border of the card as a framed label. The step row gets its own identity: bullet + task number + step text.
- **Current-task visual** — pulsing orange `→` bullet (breathes at 1.5 s cycle, opacity 1 ↔ 0.35) next to the task number (1-based index of the in-progress step), followed by the step text. Row text statically colored orange; only the arrow glyph breathes.
- **Done state** — green static `✓` bullet, text "Done", pill stays `N/N Done` with a green `✓` glyph prefix.
- **Failed state** — red static `✗` bullet (no pulse), text from the first failed item, pill reads `✗ Task K failed` with a red `✗` glyph. Failed rows in the expanded list also get red treatment.
- **Expanded list** — per-row status treatment (done green dim, in-progress orange with pulsing bullet, blocked orange/60, failed red, pending gray). Row numbers appear after the bullet using a right-aligned column so single- and double-digit numbers align vertically.
- **Pill leading glyph** — `●` orange pulsing for running, `✓` green for completed, `✗` red for failed.

**Files touched (post-prompt-commit):**

- `packages/dashboard/public/index.html` — desktop + mobile progress-card templates (both restructured identically).
- `packages/dashboard/public/js/progress-card.js` — new helpers (`collapsedRowClass`, `pillIcon`, `pillIconClass`, `counterText`, `iconPulseClass`, `isFailed`, `_focalItemIndex`), `statusClass`/`statusIcon` updated, `currentStepNumber`/`currentStepText` extended to cover the failed path.
- `packages/dashboard/public/css/app.css` — `@keyframes pulse-task` animation + `.progress-counter-pill` absolute-positioned framed-label styling.

**Verification:** no unit tests cover the UI layer in this codebase; verification was by live pair-browse. Three states exercised via Alpine store mocks (running, running-with-double-digit-step, failed) and programmatic DOM inspection to confirm class wiring (only bullets carry `pulse-task`; pill text and row text stay static; row color inherits from `statusClass` / `collapsedRowClass`).

**Impact on spec acceptance criteria:** none negative. AC5 ("no regression in existing tests") still holds — the 151 automation unit tests are green; UI files have no test suite. AC6 ("no structural changes") is softened by this deviation but in a direction the CTO explicitly requested: the change is UI-only, no new hooks, no new MCP tools, no new endpoints, no wire-protocol changes — the progress event contract already carried per-item `status`, which the new UI reads.

**Impact on α gate:** prompt cadence verified independently of the UI redesign (cadence was observed working before the UI changes landed). The redesign improves readability of the cadence rather than substituting for it.
