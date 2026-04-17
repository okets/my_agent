---
sprint: M9.6-S11
title: Template smoke fixtures + installed-plug backfill — architect review
architect: Opus 4.7 (Phase 2 architect)
review_date: 2026-04-17
verdict: APPROVED on re-review (was REJECTED on first pass; all 5 blocking items fixed)
---

# S11 Architect Review

**Sprint:** M9.6-S11 — Template smoke fixtures + installed-plug backfill
**Branch:** `sprint/m9.6-s11-template-smoke-fixtures`
**Reviewed:** 2026-04-17
**Verdict:** **REJECTED.** Sprint did not deliver one of its two core requirements (installed-plug backfill is missing entirely), did out-of-scope work (runSmokeFixture is S13 territory), and committed multiple §0.3 process violations. None of the failures are work the dev can't fix; re-review after corrections lands.

---

## 1. Required dev fixes before re-review

### 1.1 BLOCKING — Installed-plug backfill is missing entirely

`plan-phase2-coverage.md §2.3` Files section:

> **Files (installed-plug backfill — read `.my_agent/capabilities/` at sprint-time to enumerate):**
> - For every installed plug folder, write a `scripts/smoke.sh` matching its template's reference shape.

Verification:
```bash
$ ls .my_agent/capabilities/*/scripts/smoke.sh
ls: cannot access '.my_agent/capabilities/*/scripts/smoke.sh': No such file or directory
```

**Zero installed plugs got `smoke.sh`.** This is half the sprint. Without it, the plan's stated motivation — "Without the backfill, S13's `runSmokeFixture` ships with degraded fall-through behavior on day one" — comes true.

**Required:** create `scripts/smoke.sh` (chmod +x) in:
- `.my_agent/capabilities/stt-deepgram/scripts/smoke.sh` — runs `transcribe.sh` against bundled fixture audio; checks JSON `text` field present. Exit 2 with `SMOKE_SKIPPED` on stderr if `DEEPGRAM_API_KEY` unset.
- `.my_agent/capabilities/tts-edge-tts/scripts/smoke.sh` — synthesizes a fixed phrase, checks output has Ogg/WAV header.
- `.my_agent/capabilities/browser-chrome/scripts/smoke.sh` — spawns MCP server, runs `browser_navigate about:blank`, tears down. Exit 2 with `SMOKE_SKIPPED: chromium not available` on stderr if chromium absent.
- `.my_agent/capabilities/desktop-x11/scripts/smoke.sh` — checks `xset q` reachable. Exit 2 if no display.

Each must:
- Have exec bit set (`chmod +x`, committed via `git update-index --chmod=+x`).
- Exit 0 healthy / exit 2 = `SMOKE_SKIPPED` / exit non-2 non-0 = broken (per design v2 §6.4).

If the `.my_agent/` write-guard hook blocks the writes, file a deviation proposal naming the exemption mechanism — don't bypass.

### 1.2 BLOCKING — `multi_instance: false` missing from 4 of 5 templates

Plan §2.3 explicitly says:

> Each template adds frontmatter fields: `fallback_action: ...` **and** `multi_instance: boolean` (defaults false; set to true only on `browser-control`).

"Defaults false" describes the default *value*, not "omit if false." S15's `registry.isMultiInstance(type)` reads this field; absent ≠ false in a strict reader.

Verification:
```bash
$ grep -l "multi_instance:" skills/capability-templates/*.md
skills/capability-templates/browser-control.md   # only one
```

**Required:** add `multi_instance: false` to the YAML frontmatter of:
- `skills/capability-templates/audio-to-text.md`
- `skills/capability-templates/text-to-audio.md`
- `skills/capability-templates/text-to-image.md`
- `skills/capability-templates/desktop-control.md`

### 1.3 BLOCKING — Revert premature roadmap-done commit

Commit `742dc47 docs(m9.6-s11): mark S11 Done in roadmap` violates Phase 1 §0.3 verbatim:

> The roadmap-done commit is the LAST commit on the sprint branch, landed AFTER the architect-review commit.

Phase 2 §0.3 also forbids the dev claiming approval. The dev marked Done *and* the external auditor wrote `verdict: APPROVED` *and* the dev pushed both before notifying the CTO. This is the same anti-pattern S9 had — it has not stuck despite §0.3 being in the plan.

**Required:** `git revert 742dc47` (don't rewrite history; revert commit). The roadmap-done re-lands after architect approval.

### 1.4 BLOCKING — Missing sprint artifacts (DECISIONS, DEVIATIONS, FOLLOW-UPS)

Phase 1 §0.3 step 5–7 (carried over):
- `s11-DECISIONS.md` — judgment calls + rationale
- `s11-DEVIATIONS.md` — proposals filed (link to each)
- `s11-FOLLOW-UPS.md` — out-of-scope items noticed

None of the three exist. The signature deviation for `runSmokeFixture` (an inline code comment is **not** a deviation proposal) and the `multi_instance` omission both should have surfaced in DEVIATIONS.

**Required:** create all three files. At minimum:
- `s11-DECISIONS.md` — record the smoke-fixture liveness-vs-quality framing and any other judgment calls.
- `s11-DEVIATIONS.md` — document the signature change for `runSmokeFixture` (`(failure, registry)` → `(capDir, registry, capabilityType)`) properly per §0.3.
- `s11-FOLLOW-UPS.md` — name any out-of-scope work noticed.

### 1.5 BLOCKING — Fix `s11-review.md` frontmatter

Frontmatter currently reads `verdict: APPROVED` and `reviewer: external reviewer (Opus)`. Per §0.3 (committed in `86b9ce0`):

- `verdict: ...` is the architect's framing only. External reviewers use `recommended: APPROVE | REJECT | CONDITIONAL`.
- The dev-contracted reviewer label is `External reviewer (dev-contracted)`.

**Required edit:**
```yaml
reviewer: External reviewer (dev-contracted)
recommended: APPROVE
```
(Drop the `verdict:` line.)

### 1.6 NON-BLOCKING — Decide what `s11-plan.md` is

Untracked file `s11-plan.md` is the dev writing their own implementation plan. Two issues:
- It's the dev's working sub-tracker, not the architect plan; should not be at the same path-level as the architect's `plan-phase2-coverage.md` (confusing for future readers).
- It includes `runSmokeFixture` in scope, which the architect plan did NOT — meaning the dev wrote their own plan that disagreed with the architect's plan, then implemented their own plan. This is the procedural root cause of the scope creep in §2 below.

**Required:** either delete `s11-plan.md` (it served its purpose; archive in commit message if needed) or move to `s11-tasks.md` with a header `> NOT THE ARCHITECT PLAN — this is the dev's sub-task tracker. Architect plan is at plan-phase2-coverage.md §2.3.`

---

## 2. Scope creep — accepted but flagged

`runSmokeFixture` in `reverify.ts` is **S13 scope** per `plan-phase2-coverage.md §2.5`:

> Add `runSmokeFixture(failure, registry)` — default for MCP plugs, custom types, anything without an entry in `REVERIFIERS`. Spawns `<capDir>/scripts/smoke.sh` as a **fresh out-of-session subprocess**...

The dev implemented it in S11. Per §0.2 of the Phase 2 plan, scope expansion requires a deviation proposal *before* the work begins, not an inline code comment after.

**Decision:** **accept the work** (it's well-built and tested) and update the S13 plan to mark `runSmokeFixture` as already-delivered — **but** the process violation is the central process correction for S12 onward. Architect plan amendments are coming in §3 below.

**The §0.2 rule is non-negotiable going forward.** If a future dev finds themselves implementing something outside the sprint's "Files" list, they STOP and file `proposals/s<N>-<slug>.md`. Inline code comments are not deviation proposals.

---

## 3. Architect amendments to S13 plan (CTO deferral rule — not the dev's job)

I will edit `plan-phase2-coverage.md §2.5` (S13) to:
- Mark `runSmokeFixture` as already-delivered in S11 (commit `3a83a36`); S13 only wires it into the dispatcher.
- Note the signature change `(capDir, registry, capabilityType)` so S13's dispatcher uses it correctly.
- Reduce S13's expected file changes accordingly.

This edit lands in this architect's commit — not blocking on dev fixes.

---

## 4. What's actually fine (don't re-do)

- **5 templates have "Smoke Fixture" sections + `fallback_action`.** Quality is good. Liveness-vs-quality framing in the script-plug templates is correct.
- **Reference `smoke.sh` bodies** in templates are well-built (deterministic fixtures, `jq -e` validation, header checks, `trap ... EXIT` cleanup).
- **MCP stubs** are honest about their scope.
- **`_bundles.md`** updated.
- **`runSmokeFixture` implementation + 4 unit tests** are well-built (this is the "accept the scope creep" item from §2).
- **TypeScript clean / 492 core tests pass / 0 regressions** per the dev's test report.

---

## 5. Process correction for S12 dev (carry forward)

§0.2 (Detection lives at the gates) and §0.3 (sprint approval flow) were both violated this sprint. Two bigger pushes will go into S12's pre-sprint advice:

- **STOP and file a deviation proposal** the moment the work goes outside the architect's "Files" list. Inline code comments are not deviation proposals.
- **Do not commit `Done` / `APPROVED` claims before architect review.** Period. The auditor's `recommended: APPROVE` is informational — the architect's verdict is binding.

I'll re-emphasize both in the S12 advice block, after the dev fixes S11 and we close it out.

---

## 6. Re-review after dev fixes — APPROVED

All 5 blocking items + the non-blocking item resolved. Verified:

| Fix | Verification | Result |
|---|---|---|
| 1.1 Backfill | `ls -la .my_agent/capabilities/*/scripts/smoke.sh` → 4 files, all chmod +x. Exit-code check: browser-chrome 0, desktop-x11 0, stt-deepgram 2 (SMOKE_SKIPPED — DEEPGRAM_API_KEY absent on dev machine, correct per §6.4 hermeticity), tts-edge-tts 0. | PASS |
| 1.2 `multi_instance: false` on 4 templates | `grep multi_instance` on each template: audio-to-text=false, text-to-audio=false, text-to-image=false, desktop-control=false, browser-control=true | PASS |
| 1.3 Revert premature roadmap-done | `bfe47dd Revert "docs(m9.6-s11): mark S11 Done in roadmap"` | PASS |
| 1.4 Missing artifacts | `s11-DECISIONS.md`, `s11-DEVIATIONS.md`, `s11-FOLLOW-UPS.md` all present | PASS |
| 1.5 `s11-review.md` frontmatter | `reviewer: External reviewer (dev-contracted)` + `recommended: APPROVE` | PASS |
| 1.6 `s11-plan.md` ambiguity | Header now reads `> NOT THE ARCHITECT PLAN — this is the dev's sub-task breakdown.` | PASS |

**Bonus:** dev's `s11-FOLLOW-UPS.md` correctly tracks five forward-looking items, including FU-1 (runSmokeFixture exit-2 handling for S13 — aligns with my S13 plan amendment) and FU-5 (tts-edge-tts MP3-vs-OGG contract violation discovered while writing smoke — properly logged for plug maintenance, not pulled into sprint scope). Tracking discipline this round was good.

**Verdict on re-review: APPROVED.** Ready to merge. S12 unblocked.

---

*Architect: Opus 4.7 (1M context), Phase 2 architect*
