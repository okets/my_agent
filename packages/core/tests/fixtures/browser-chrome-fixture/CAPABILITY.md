---
name: browser-chrome
provides: browser-control
interface: mcp
entrypoint: npx tsx src/server.ts
icon: googlechrome
requires:
  system: []
---

Test fixture for browser-control capability integration tests.

Mock MCP server exposing the same tool surface as `@playwright/mcp` (navigate,
click, snapshot, screenshot, take_screenshot, type, wait_for) but with no real
browser dependency. Used by the multi-instance test suite (Phase E).
