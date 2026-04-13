---
name: browser-edge
provides: browser-control
interface: mcp
entrypoint: npx tsx src/server.ts
icon: microsoftedge
requires:
  system: []
---

Test fixture for the multi-instance browser-control story (Phase E item 24).
Identical to `browser-chrome-fixture` but with `name: browser-edge` so the
registry sees two distinct entries that toggle and delete independently.
