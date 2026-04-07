# M9.2-S4 Decisions Log

**Sprint:** M9.2-S4 Delegation Todo Enforcement
**Branch:** `sprint/m9.2-s4-delegation-enforcement`
**Started:** 2026-04-07
**Mode:** Trip (CTO on mobile)

---

## D1: Single-agent execution

**Decision:** Sequential single-agent, no team.
**Why:** TDD flow + smoke tests, strictly sequential.

## D2: Smoke test — brain answered inline, no delegation

**Decision:** Accept unit tests as proof of schema enforcement. Behavioral smoke tests inconclusive.
**Why:** Sent "Research the best noise-canceling headphones under $300..." via `debug/initiate`. The brain (Sonnet) responded with 195 output tokens directly via WhatsApp — it chose to answer inline rather than delegate. This is normal brain behavior (not all requests trigger delegation).
**Impact:** The schema change (`.min(1)`, remove `.optional()`) is validated by 4 unit tests. When the brain DOES call `create_automation`, the Zod schema will enforce todos. We cannot force delegation behavior in a smoke test — it depends on the brain's judgment.
**What the Architect should know:** No degradation observed. The brain is still functional, responds to messages, and the schema change doesn't affect existing automations or the brain's conversational path. The enforcement only activates when `create_automation` is called via the MCP tool.

## D3: Smoke test rerun via Playwright browser (proper path)

**Decision:** Reran smoke test through Playwright browser UI after CTO flagged the `debug/initiate` approach.
**What happened:** Sent "Research the best noise-canceling headphones under $300..." via the dashboard chat textbox (Playwright). Brain (Sonnet) answered inline with a detailed 3-option comparison table + chart. No `create_automation` tool call was made — brain chose to answer directly from training data.
**Behavioral observation:** For straightforward research questions, the brain prefers inline responses over delegation. The visual augmentation hook correctly fired (42 numbers → chart generated). No degradation from the schema change.
**Conclusion:** Schema enforcement is validated by 4 unit tests. Behavioral delegation depends on brain judgment and cannot be forced in a smoke test. The proper user path (browser UI) was used this time — no system-level injection.

