# M9.5-S1: Framework Extension — Architect Review

**Reviewer:** CTO architect session
**Date:** 2026-04-11

---

## Verdict: PASS

All S1 deliverables implemented and tested. 34 tests passing, TypeScript compiles clean. The pre-implementation gap analysis identified 7 risks — all 7 were addressed in the implementation. No critical issues. Two important issues and a set of deferred items to track.

---

## Spec Compliance

| Design Spec Requirement | Status | Notes |
|---|---|---|
| `entrypoint` field on types | Done | `types.ts`, tested |
| `requires.system` with tool probing | Done | Scanner uses `which`, tested with missing + present tools |
| `.enabled` file read during scan | Done | Scanner reads presence, tested |
| `get()` gates on available AND enabled | Done | Registry, tested all 4 state combinations |
| `has()` respects enabled gate | Done | Delegates to `get()`, tested |
| `isEnabled()` method | Done | Registry, tested |
| `toggle()` writes/removes `.enabled` + emits event | Done | Registry, event payload tested |
| MCP server spawning (child process, stdio) | Done | Spawner, tested with smoke server |
| Per-session factory pattern | Done | Tested with 2 sessions, different PIDs |
| SIGTERM → 5s → SIGKILL shutdown | Done | Spawner, `SHUTDOWN_TIMEOUT_MS` used |
| Crash recovery (exit listener, event emission) | Done | Spawner emits `crash` event. **Not tested** — see C1. |
| Rate limiter (sliding window) | Done | Middleware, tested |
| Audit logger | Done | Middleware, tested |
| Screenshot interceptor | Done | Middleware, tested |
| `detect.sh` gates MCP test harness | Done | Returns early with `untested` on failure |
| MCP test harness (spawn, connect, list tools) | Done | Tested with smoke server |
| Dispatch by interface type | Done | `test-harness.ts` checks `interface === 'mcp'` |
| `.mcp.json` coexistence | Done | Regression test added |
| Middleware wiring to PostToolUse hooks | Deferred to S3 | Correctly deferred — primitives exported, wiring in `app.ts` |
| Tool schema validation against template contract | Deferred to S4 | Correct — no template exists yet |
| Functional screenshot test (`desktop_screenshot` call) | Deferred to S3/S4 | Correct — smoke server has no screenshot tool |

---

## Corrections Required

### C1: Crash recovery path must be tested

The spawner's `exit` event listener and `crash` event emission (lines 69-86) have zero test coverage. The code looks structurally correct, but untested crash recovery is not crash recovery — it's hope.

**Action:** Add a test to `mcp-spawner.test.ts` that:
1. Spawns the smoke server
2. Kills the child process via `process.kill(handle.pid, 'SIGKILL')`
3. Asserts the `crash` event fires with the correct capability name and session ID
4. Asserts the handle is removed from `listActive()`

This is an S1 correction, not a deferral. Fix before starting S2.

### C2: Scanner `.mcp.json` guard missing for `entrypoint` capabilities

The spec says `entrypoint` and `.mcp.json` are mutually exclusive. The scanner loads `.mcp.json` for all `interface: 'mcp'` capabilities, even when `entrypoint` is present. The conditional should be:

```typescript
if (data.interface === 'mcp' && !data.entrypoint) {
```

Harmless today (spawner ignores `mcpConfig`), but violates the spec and could cause confusion if a capability accidentally ships both.

**Action:** Fix the conditional in `scanner.ts`. S1 correction.

---

## Important Issues (non-blocking, fix when touched)

### I1: Spawner accesses private `_process` on StdioClientTransport

`mcp-spawner.ts` line 65 accesses `transport._process` via `unknown` cast. This is undocumented SDK internals. If `@modelcontextprotocol/sdk` changes that property name:
- PID becomes 0
- Crash recovery stops working (no exit listener)
- SIGTERM/SIGKILL shutdown falls back to `client.close()` only

**Recommendation:** Add a runtime warning log when `_process` is null after spawn. This way a future SDK update surfaces immediately instead of silently degrading.

### I2: Audit logger writer callback is sync, will need to be async for S3

`mcp-middleware.ts` declares `writer: (entry: AuditEntry) => void` but S3 will wire this to file I/O (async). The callback signature will need to become `(entry: AuditEntry) => void | Promise<void>` or similar.

Not an S1 bug — just a note for S3 implementation.

---

## Architectural Decisions — Reviewed

| Decision | Verdict |
|---|---|
| D1: `@modelcontextprotocol/sdk` added to core | Agree. Capability lifecycle is a core concern. |
| D2: Crash recovery emits event, doesn't set health directly | Agree. Avoids circular dependency. S3 must wire the listener. |

---

## Deferred Items — Sprint Assignment

Items correctly deferred from S1 that must land in a specific later sprint:

| Item | Assigned To | Why |
|---|---|---|
| Middleware wiring to PostToolUse hooks in `app.ts` | **S3** | S3 rewires `app.ts` — natural place to wire middleware |
| Crash event → health `degraded` wiring in `app.ts` | **S3** | Same — spawner emits, `app.ts` listens and updates registry |
| Audit logger writer becomes async-compatible | **S3** | S3 wires to JSONL file writes |
| Tool schema validation against template contract | **S4** | S4 writes the template — can't validate what doesn't exist |
| Functional screenshot test (call `desktop_screenshot`) | **S4** | Requires real desktop capability, not smoke server |
| `_process` access fragility warning | **S3** | S3 integrates spawner into `app.ts`, natural place to add |

---

## Summary

Clean sprint. All planned deliverables present, well-tested, architecturally sound. Two corrections required before S2 (crash recovery test + scanner guard). Six items correctly deferred with clear sprint assignments. No design deviations.
