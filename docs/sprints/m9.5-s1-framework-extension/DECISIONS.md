# M9.5-S1: Framework Extension — Decisions Log

> Trip sprint decisions. Minor/medium decisions logged here. Major deviations in DEVIATIONS.md.

---

## D1: `@modelcontextprotocol/sdk` added to core package

**Decision:** Added `@modelcontextprotocol/sdk` to `packages/core/package.json` as a dependency.

**Why:** The MCP spawner and test harness need `Client` and `StdioClientTransport` to connect to capability servers. Previously only used in dashboard. Core needs it now because the capability lifecycle is a core concern.

**Alternatives:** Could have kept it in dashboard only and injected the client — but the spawner and test harness are core capabilities module code, not dashboard code. Direct dependency is cleaner.

## D2: Crash recovery emits event, doesn't set health directly

**Decision:** The spawner emits a `crash` event when a child process exits unexpectedly. It does NOT directly set `health = 'degraded'` on the capability — the consumer (app.ts) is responsible for listening and updating the registry.

**Why:** The spawner doesn't have a reference to the registry. Coupling them would create a circular dependency (registry → spawner → registry). The event-based approach is cleaner and matches how the registry already works (EventEmitter-based, with `capability:changed` events).

**S3 action required:** When app.ts wires the spawner, it must listen for `crash` events and update the corresponding capability's health to `degraded`.
