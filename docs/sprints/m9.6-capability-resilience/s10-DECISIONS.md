---
sprint: m9.6-s10
title: CapabilityInvoker + exec-bit validation — decisions
---

# S10 Decisions

## D1 — originFactory in InvokerDeps is present but unused in S10

**Decision:** `originFactory: () => TriggeringOrigin` is wired into `InvokerDeps` but never called at invocation time in S10.

**Rationale:** S10 callers (chat-service, reverify) always have a full `TriggeringInput` including origin and pass it as `opts.triggeringInput`. The factory is for S12 automation workers that run in a context where there is no caller-provided origin — they need the invoker to auto-populate origin without caller-side wiring. Carrying the factory in the constructor now means S12 can wire it without changing the class interface.

**Why not omit it until S12?** It would require an interface change at S12 time with downstream churn in every caller. Cheap to carry now; avoids a migration.

---

## D2 — TTS (synthesizeAudio) intentionally NOT wired through invoker

**Decision:** `synthesizeAudio()` in chat-service.ts was given a `// TODO(S13/S17): route through invoker` comment and left on the legacy path.

**Rationale:** plan-phase2-coverage.md §2.2 explicitly defers TTS coverage to S13/S17 (Phase 3). Wiring TTS in S10 would change sprint scope without a corresponding design-spec section and would need its own CFR symptom classification for audio synthesis failures. Deferred per plan.

---

## D3 — Legacy bash wrapper kept as fallback in reverifyAudioToText

**Decision:** `reverifyAudioToText()` retains the `execFile("bash", [scriptPath, ...])` fallback when no invoker is passed. The preferred path (invoker available) runs through `invoker.run()`.

**Rationale:** Unit tests for the recovery orchestrator and reverify don't wire the full App and thus don't construct a `CapabilityInvoker`. Rather than force every existing test to build a fake invoker, the fallback path covers the no-invoker case. The fallback will be removed in S13 when all test-harness coverage migrates to use the invoker.

---

## D4 — classifySttError removed, not deprecated

**Decision:** `classifySttError` was deleted from `failure-symptoms.ts` and all exports rather than marked deprecated.

**Rationale:** The function's only job was classifying execFile errors into CFR symptoms — exactly what `CapabilityInvoker.run()` now does centrally. Leaving it would create a fork where two classification paths could diverge. No external package imports it (checked via grep). The dashboard CFR test that imported it (`cfr-emit-stt-errors.test.ts`) tested the removed function directly and was deleted; its scenarios are now covered by `invoker.test.ts`.

---

## D5 — execFile direct (not bash wrapper) in invoker

**Decision:** `CapabilityInvoker` calls `execFileAsync(scriptPath, args, ...)` directly, not `execFileAsync("bash", [scriptPath, ...])`.

**Rationale:** The exec-bit validation added in S10 marks capabilities invalid when their scripts lack the executable bit. Running via `bash script.sh` silently bypasses this check — the script executes regardless of exec bit. Direct `execFile` on the script path correctly enforces exec-bit as a hard requirement. Scripts that need the bash shell should declare `#!/bin/bash` in their shebang.

---

## D6 — Timeout detection uses killed flag + ETIMEDOUT code, not message string

**Decision:** Timeout is detected via `err.killed || err.code === "ETIMEDOUT"` with `lower.includes("etimedout") || lower.includes("timeout")` as belt-and-suspenders.

**Rationale:** Node.js `execFile` with a `timeout` option kills the process and sets `err.killed = true` and `err.code = "ETIMEDOUT"` on the error object. The error message may be "spawnSync <path> ETIMEDOUT" or similar — it doesn't reliably contain the word "timeout". Checking `killed` and `code` first is authoritative; the string check is a fallback for any environments that expose the message differently.
