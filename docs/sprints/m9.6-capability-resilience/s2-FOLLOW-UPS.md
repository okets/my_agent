# S2 Follow-Ups

**Sprint:** M9.6-S2 — Deps wiring at App boot
**Date:** 2026-04-15

---

## FU1: `postResponseHooks` log/logError use `console.*` not Fastify logger

**Observed in:** `app.ts` boot wiring block.

The `setDeps` call in `App.create()` uses `log: (msg) => console.log(msg)` and `logError: (err, msg) => console.error(msg, err)`. The WS handler's old call used `fastify.log.info` and `fastify.log.error`, which are structured (pino) loggers. The App doesn't have access to the Fastify logger.

**Impact:** Minor. Log output from chat-service during channel-origin processing goes to stdout/stderr (unstructured) rather than pino. Pino output only kicks in when the WS handler path is used (i.e., browser dashboard). Channel-origin messages always went through the channel handler, not WS, so the logger difference is pre-existing for that path.

**Suggested fix:** Pass a structured log adapter into `App.create()` options, or expose a logger interface on App. Out of scope for S2.

---

## FU2: `App.shutdown()` doesn't stop `idleTimerManager`

**Observed in:** `app.ts` shutdown block.

`IdleTimerManager.shutdown()` clears all pending timers. It's currently called implicitly by the WS handler when the server closes (the module-level singleton's garbage-collection). After S2, `idleTimerManager` is an App field but the shutdown block at line ~1856 does not call `app.idleTimerManager?.shutdown()`.

**Impact:** Minor. If `App.shutdown()` is called (e.g., from tests or headless scripts), pending idle timers leak until the process exits. They would fire during shutdown and may log errors if the queue is already drained.

**Suggested fix:** Add `this.idleTimerManager?.shutdown()` to the shutdown sequence. Low-risk one-liner.

---

## FU3: S4 should reference `app.idleTimerManager` in triggeringInput context

**Observed during planning:** `TriggeringInput` (cfr-types.ts) has `artifact.rawMediaPath` but no `idleTimerManager` interaction. S4's recovery orchestrator may need to call `app.idleTimerManager.touch(convId)` after recovery to reset the idle clock on the corrected turn.

**Impact:** None for S2-S3. Mention here so S4 implementer checks.
