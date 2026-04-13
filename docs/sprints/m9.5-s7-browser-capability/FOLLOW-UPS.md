# M9.5-S7 Follow-ups

Items discovered during sprint execution that are out of scope but worth tracking.

---

## FU1 — Legacy "Browser Automation (Playwright)" install card

**File:** `packages/dashboard/public/index.html:3247-3346`
**Discovered:** Phase D (frontend-dev).

The older `playwright-status` install UI is a separate card from the new capabilities system. With `browser-control` capabilities now installable via the Browsers card, the legacy card is redundant for most users — it installs a single system-wide `@playwright/mcp` into some legacy path, whereas the new capabilities approach gives per-instance profiles and per-browser isolation.

**Options:**
- Remove the legacy card entirely once browser-control capabilities are universally present.
- Keep for backwards compat with existing deployments that depend on `playwright-status` install path.
- Consolidate the two install flows into a single "Add browser" button inside the Browsers card.

**Why not this sprint:** Out of Phase D scope; no user-visible bug, only UX redundancy. Needs CTO input on which direction (remove vs consolidate). Tracks against the same theme as the `playwright-screenshot-bridge` coexistence question raised in plan.md §"Coexistence with playwright-screenshot-bridge".

---
