# M9.5-S7 Deviations Log

Deviations from `plan.md`. Append-only. Empty until first deviation.

---

## 2026-04-13 — Template: pin @playwright/mcp in capability's package.json

**Phase:** B (manual scaffold first-customer feedback into Phase A template).

**Deviation:** Phase A template originally declared "@playwright/mcp is invoked
via npx at runtime — deliberately not a direct dependency." During Phase B
scaffolding I flipped that: the capability's `package.json` now pins
`@playwright/mcp: "0.0.68"` exactly.

**Why:** Task #2 explicitly says "package.json (pin @playwright/mcp 0.0.68)".
Leaving it out of deps makes `npx` fetch-on-demand on first spawn, which (1)
introduces a network dependency at capability spawn time, (2) pulls `latest`
if the pin is absent anywhere in the resolution chain, and (3) defeats the
"frozen plug" intent. Pinning locally is consistent with the socket/plug
invariant from D1 — the plug owns its binary version.

**Impact:** Template updated in same commit as the scaffold. No code in
packages/** changed. The wrapper body is unchanged — `npx @playwright/mcp` now
resolves the local pin first.
