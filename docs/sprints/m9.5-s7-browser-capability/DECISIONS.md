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
