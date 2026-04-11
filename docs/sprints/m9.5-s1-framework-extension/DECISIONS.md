# M9.5-S1: Framework Extension — Decisions Log

> Trip sprint decisions. Minor/medium decisions logged here. Major deviations in DEVIATIONS.md.

---

## D1: `@modelcontextprotocol/sdk` added to core package

**Decision:** Added `@modelcontextprotocol/sdk` to `packages/core/package.json` as a dependency.

**Why:** The MCP spawner and test harness need `Client` and `StdioClientTransport` to connect to capability servers. Previously only used in dashboard. Core needs it now because the capability lifecycle is a core concern.

**Alternatives:** Could have kept it in dashboard only and injected the client — but the spawner and test harness are core capabilities module code, not dashboard code. Direct dependency is cleaner.
