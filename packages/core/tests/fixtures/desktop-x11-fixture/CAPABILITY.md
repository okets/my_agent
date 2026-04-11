---
name: Desktop X11 Test
provides: desktop-control
interface: mcp
entrypoint: npx tsx src/server.ts
requires:
  system: []
---

Test fixture for desktop-x11 capability integration tests.
