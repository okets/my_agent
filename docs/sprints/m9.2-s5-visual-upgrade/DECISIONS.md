# M9.2-S5 Decisions Log

**Sprint:** M9.2-S5 Visual System Upgrade
**Branch:** `sprint/m9.2-s5-visual-upgrade`
**Started:** 2026-04-07
**Mode:** Trip (CTO on mobile)

---

## D1: Single-agent execution

**Decision:** Sequential single-agent, no team.
**Why:** 4 parts but all sequential. Skill rewrite → hook change → schema → tests → smoke.

## D2: create_chart description already required

**Decision:** Skip Step 5 code change. `create_chart` in `chart-server.ts` already has `description: z.string()` without `.optional()`. Only `fetch_image` needs the change. Will add invariant comment to `chart-server.ts` for documentation.

## D3: Smoke test results (via Playwright browser)

**Test 1 — iPhone history (incidental numbers):** Brain generated chart ITSELF inline ("iPhone Release Timeline") — skill rewrite working. Hook was no-op (imagesStoredDuringTurn > 0). Cannot test hook filtering when brain proactively charts.

**Test 2 — Top 5 populated countries (chart-worthy):** Brain answered without `create_chart`. Hook fired with new two-step flow: `evaluating chart-worthiness` → Haiku approved: `"Top 5 Most Populated Countries (2025)"` → SVG generated → chart appended. Smart hook working correctly.

**Summary:** Skill rewrite makes brain chart more often (Test 1). When brain doesn't chart, the smart hook evaluates chart-worthiness before committing (Test 2). No dumb charts observed. Both paths working as designed.

