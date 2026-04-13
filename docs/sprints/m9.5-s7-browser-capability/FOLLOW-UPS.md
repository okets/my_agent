# M9.5-S7 Follow-ups

Items discovered during sprint execution that are out of scope but worth tracking.

---

## FU2 — Capability folder slug should match `name:` field

**Discovered:** Phase F (iteration 2).

Nina's capability-builder created the folder as `.my_agent/capabilities/chrome-browser/`
but the `CAPABILITY.md` declares `name: browser-chrome`. The registry uses
the `name:` field as the canonical identifier, so the folder slug is
purely cosmetic — but the mismatch invites confusion in `ls capabilities/`
output, in profile-dir resolution debugging, and in user-facing UI when
they look for the install location.

**Options:**
- Scanner emits a warning when folder basename ≠ capability `name`.
- Capability-builder skill enforces matching folder name = capability name.
- Auto-rename on first scan.

**Why not this sprint:** Phase F gate passed — capability is functional.
This is a UX/consistency polish for a follow-up.

---

## FU3 — Capability-builder should auto-create `.enabled` on successful build

**Discovered:** Phase F (iteration 2).

Nina's build produced a complete, healthy capability — but `.enabled` was
never created. Scanner correctly marked it `available`, but the registry
filter in dual-path migration (`status === 'available' && enabled`) excluded
it, falling back to the hardcoded `@playwright/mcp` until I manually
touched `.enabled`.

M9.5-S5 plan / memory says "Auto-create `.enabled` on build." This wasn't
honored by the capability-builder flow Nina used. Either:
- The capability-builder skill needs an explicit final step "create
  `.enabled` once the harness test passes."
- Template's `setup.sh` could create it as the last action (but that may
  conflict with the user's intent — they may want to install but not enable).
- Or framework auto-enables newly-built capabilities (more ergonomic
  default; user disables via the trash icon if they don't want it).

**Why not this sprint:** Phase F gate passed (manual workaround was a
single `touch`). This is a P1 polish for the next capability sprint.

---

## FU4 — `capability-brainstorming` skill description needs browser triggers

**Status:** CLOSED in-sprint via commit `dabdd69`. See DECISIONS.md D8. Kept
in this log as reference for future multi-instance capability types (same
pattern will be needed when adding a second multi-instance type).

---

## FU4 (original) — `capability-brainstorming` skill description needs browser triggers

**Discovered:** Phase F (D6 + D7).

The skill triggered on prompt 3 of 3 in iteration 2, after the user
explicitly said "Just ship the Chrome capability — go." Earlier user-voice
prompts ("add Chrome support", "browser capability so I can navigate") did
NOT route Nina to the skill. She instead noticed she had `mcp__playwright__*`
tools (from Phase C's hardcoded fallback) and answered "you already have
this."

Skill description in `packages/core/skills/capability-brainstorming/SKILL.md`
should be extended to include browser-specific triggers:
- "install a browser" / "install Chrome/Firefox/Edge/Brave/Safari"
- "dedicated browser" / "browser as a managed capability"
- "browser with its own profile" / "separate browser instance"

And a hard rule: "When the user names a specific browser (Chrome, Edge,
Firefox, etc.) and asks to add/install/set up that browser, treat as a
capability install request — even if existing browser tools are present.
Browsers are multi-instance."

**Why not this sprint:** Phase F gate passed via persistence. Skill
iteration is its own initiative — this finding is the input to that
iteration. Don't slot template/skill changes into a sprint that already
shipped.

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
