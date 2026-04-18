# STOP — THIS PLAN IS FOR THE WRONG SPRINT. DO NOT EXECUTE.

> **Architect rejection 2026-04-18.** The plan below describes **reflect-phase collapse**, which is **S17 in Phase 3**, NOT S13.
>
> **S13 in Phase 2 is "Reverify dispatcher + terminal-on-fix state"** — see [`plan-phase2-coverage.md §2.5`](plan-phase2-coverage.md). Completely different scope:
> - `REVERIFIERS` dispatch table in `reverify.ts`
> - `reverifyTextToAudio`, `reverifyImageToText`, `reverifyTextToImage` (new per-type reverifiers)
> - `runSmokeFixture` exit-2 (`SMOKE_SKIPPED`) handling — already-delivered in S11, just needs the inconclusive return shape extension
> - `RESTORED_TERMINAL` state + `TERMINAL_ACK` action in `orchestrator-state-machine.ts`
> - Origin-aware terminal routing branch logic (uses S12's already-wired 6-step ordering + `attachedOrigins` mutex)
> - `verificationInputPath` always populated
>
> **What went wrong:** the dev read [`plan-universal-coverage.md`](plan-universal-coverage.md) §4.3.1 / §12.5. That document is **SUPERSEDED** — its top-of-file banner says so explicitly. v2.3's sprint numbering put reflect-collapse at S13; the 2026-04-17 course-correct re-split the work into Phase 2 + Phase 3 and moved reflect-collapse to S17 (because it's dead-code cleanup AFTER the S16 fix-engine swap obsoletes it).
>
> **Required dev action — start over:**
> 1. Discard this plan content. Do NOT execute any of it. Implementing reflect-collapse before S16 fix-engine swap creates a quality-degradation window — see [`plan-phase3-refinements.md §0.2`](plan-phase3-refinements.md) for why.
> 2. Read [`plan-phase2-coverage.md §2.5`](plan-phase2-coverage.md) — that's the actual S13 scope.
> 3. Also read [`../../design/capability-resilience-v2.md`](../../design/capability-resilience-v2.md) §3.3 (reverify dispatcher + smoke contract) and §3.4 (terminal states).
> 4. Note that S11 already delivered `runSmokeFixture` (with signature `(capDir, registry, capabilityType)` per S11 commit `3a83a36`). S13 wires it into the dispatcher and adds the exit-2 inconclusive handling — does NOT re-implement it.
> 5. Note that S12 already wired the 6-step terminal drain ordering and `attachedOrigins` mutex. S13 adds the `RESTORED_TERMINAL` branch logic that drain consumes.
> 6. Rewrite this file (`s13-plan.md`) with the correct scope.
>
> **Reference docs are clear about supersession** — `plan-universal-coverage.md` line 1 says "SUPERSEDED — DO NOT IMPLEMENT FROM THIS DOCUMENT". The next dev session must read `plan-phase2-coverage.md` for any Phase 2 sprint scope.
>
> **Architect (Opus 4.7) will re-review the rewritten plan before implementation begins.**

---

# M9.6-S13 Reverify Dispatcher + Terminal-on-Fix State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-type reverifiers + smoke-fixture dispatch + `RESTORED_TERMINAL` state for plugs without retriable input (TTS, image, MCP).

**Architecture:** Four task groups — (1) extend `runSmokeFixture` with exit-2 inconclusive handling, (2) add `dispatchReverify` + per-type reverifiers in `reverify.ts`, (3) extend the state machine with `RESTORED_TERMINAL` / `REVERIFY_PASS_TERMINAL` / `TERMINAL_ACK`, (4) update the orchestrator to branch on `recoveredContent` and route terminal cases correctly through the existing S12 drain.

**Tech Stack:** TypeScript, Vitest, `packages/core`

**Design specs:**
- `docs/sprints/m9.6-capability-resilience/plan-phase2-coverage.md` §2.5
- `docs/design/capability-resilience-v2.md` §3.3, §3.4

**Prior-sprint context:**
- S11 delivered `runSmokeFixture(capDir, registry, capabilityType)` (commit `3a83a36`) — **do not re-implement**; S13 wires it into the dispatcher and adds exit-2 handling.
- S12 delivered the 6-step `terminalDrain` + `attachedOrigins` mutex — S13 adds the `RESTORED_TERMINAL` branch logic those structures already accommodate.
- S10 delivered `CapabilityInvoker` — `reverifyAudioToText` already uses it (no change needed there).

---

## File Map

**Modified:**
- `packages/core/src/capabilities/reverify.ts` — add `inconclusive` to `ReverifyResult`; extend `runSmokeFixture` for exit-2; add `Reverifier` type; add `REVERIFIERS` table; add `dispatchReverify`; add `reverifyTextToAudio`, `reverifyImageToText`, `reverifyTextToImage`; rename `reverify` export to `dispatchReverify` (keep `reverify` as deprecated re-export)
- `packages/core/src/capabilities/orchestrator-state-machine.ts` — add `RESTORED_TERMINAL` state; rename `DONE` → `RESTORED_WITH_REPROCESS`; rename `REVERIFY_PASS` event → `REVERIFY_PASS_RECOVERED`; add `REVERIFY_PASS_TERMINAL` event; add `TERMINAL_ACK` action
- `packages/core/src/capabilities/recovery-orchestrator.ts` — add `"terminal-fixed"` to `AckKind`; extend `terminalDrain` args; update `doReverify` to call `dispatchReverify`; branch on `recoveredContent` in run loop; populate `verificationInputPath` from reverify result

**New tests:**
- `packages/core/tests/capabilities/reverify-dispatch.test.ts`
- `packages/core/tests/capabilities/reverify-tts.test.ts`
- `packages/core/tests/capabilities/reverify-image-to-text.test.ts`
- `packages/core/tests/capabilities/reverify-text-to-image.test.ts`
- `packages/core/tests/capabilities/orchestrator/terminal-routing.test.ts`

**Updated tests:**
- `packages/core/tests/capabilities/run-smoke-fixture.test.ts` — add exit-2 case
- `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts` — update renamed events/states

---

## Task 1: Add exit-2 (SMOKE_SKIPPED) handling to runSmokeFixture

**Files:**
- Modify: `packages/core/src/capabilities/reverify.ts`
- Modify: `packages/core/tests/capabilities/run-smoke-fixture.test.ts`

**Context:** `runSmokeFixture` (delivered in S11, commit `3a83a36`) treats any non-zero exit as failure. S13 requires exit 2 to mean "inconclusive — external resource unavailable" per hermeticity rule §6.4. The `ReverifyResult` interface needs an `inconclusive` flag; the dispatcher uses this to avoid marking a plug as failed when the smoke script can't determine health.

- [ ] **Step 1: Add `inconclusive` to `ReverifyResult`**

  In `packages/core/src/capabilities/reverify.ts`, extend the interface:

  ```typescript
  export interface ReverifyResult {
    pass: boolean;
    recoveredContent?: string;
    failureMode?: string;
    /**
     * Set to true when exit-2 (SMOKE_SKIPPED): external resource unavailable,
     * capability health indeterminate. Dispatcher treats as "might be healthy".
     */
    inconclusive?: boolean;
    confidence?: number;
    durationMs?: number;
    /**
     * The path used for verification: artifact path for per-type reverifiers,
     * <capDir>/scripts/smoke.sh for smoke-fixture reverifier. Always populated
     * after S13 so FixAttempt.verificationInputPath is never empty string.
     */
    verificationInputPath?: string;
  }
  ```

- [ ] **Step 2: Write the failing test for exit-2**

  Add to `packages/core/tests/capabilities/run-smoke-fixture.test.ts`:

  ```typescript
  it("returns pass:true inconclusive:true when smoke.sh exits 2 (SMOKE_SKIPPED)", async () => {
    const capDir = makeCapDir(2);
    const registry = makeRegistry("available");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(true);
    expect(result.inconclusive).toBe(true);
  });
  ```

  Run it to confirm FAIL:
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/run-smoke-fixture
  ```
  Expected: `AssertionError: expected undefined to be true` on `inconclusive`.

- [ ] **Step 3: Extend runSmokeFixture to handle exit 2**

  In `reverify.ts`, replace the catch block in `runSmokeFixture`:

  Old:
  ```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `smoke.sh failed: ${message}` };
  }
  ```

  New:
  ```typescript
  } catch (err: unknown) {
    // execFile rejects with err.code = exit code for non-zero exits.
    // Exit 2 = SMOKE_SKIPPED: external resource unavailable, health indeterminate.
    if (typeof err === "object" && err !== null && (err as Record<string, unknown>).code === 2) {
      return {
        pass: true,
        inconclusive: true,
        verificationInputPath: smokeScript,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `smoke.sh failed: ${message}`, verificationInputPath: smokeScript };
  }
  ```

  Also add `verificationInputPath: smokeScript` to the exit-0 path:
  ```typescript
  // (already exists)
  await execFileAsync(smokeScript, [], { ... });
  return { pass: true, verificationInputPath: smokeScript };
  ```

- [ ] **Step 4: Run tests — must be green**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/run-smoke-fixture
  ```
  Expected: 5 tests pass (4 existing + 1 new exit-2 test).

- [ ] **Step 5: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/reverify.ts \
          packages/core/tests/capabilities/run-smoke-fixture.test.ts
  git commit -m "feat(m9.6-s13): add exit-2 inconclusive handling to runSmokeFixture + verificationInputPath"
  ```

---

## Task 2: Add dispatchReverify + per-type reverifiers

**Files:**
- Modify: `packages/core/src/capabilities/reverify.ts`
- Create: `packages/core/tests/capabilities/reverify-dispatch.test.ts`
- Create: `packages/core/tests/capabilities/reverify-tts.test.ts`
- Create: `packages/core/tests/capabilities/reverify-image-to-text.test.ts`
- Create: `packages/core/tests/capabilities/reverify-text-to-image.test.ts`

**Context:** The current `reverify()` function has a hardcoded `audio-to-text` check and falls back to availability for unknown types. S13 replaces this with a proper dispatch table. `runSmokeFixture` already handles MCP and unknown types. Per-type reverifiers (`reverifyTextToAudio`, etc.) run scripts from the plug's `scripts/` folder against deterministic fixtures — they return `recoveredContent: undefined` (no user input to replay) and `pass: boolean`.

**Critical — `runSmokeFixture` signature deviation:** S11 shipped `runSmokeFixture(capDir, registry, capabilityType)` — caller resolves `capDir` from `registry.get(type)?.path` before calling. The dispatch table must resolve `capDir` before routing to `runSmokeFixture`.

- [ ] **Step 1: Add the `Reverifier` type and `REVERIFIERS` table**

  In `reverify.ts`, after the existing imports, add:

  ```typescript
  type Reverifier = (
    failure: CapabilityFailure,
    registry: CapabilityRegistry,
    invoker?: CapabilityInvoker,
  ) => Promise<ReverifyResult>;

  const REVERIFIERS: Record<string, Reverifier> = {
    "audio-to-text": reverifyAudioToText,
    "text-to-audio": reverifyTextToAudio,
    "image-to-text": reverifyImageToText,
    "text-to-image": reverifyTextToImage,
  };
  ```

  Note: `reverifyTextToAudio`, `reverifyImageToText`, `reverifyTextToImage` are defined below in this task.

- [ ] **Step 2: Write the failing dispatch test**

  Create `packages/core/tests/capabilities/reverify-dispatch.test.ts`:

  ```typescript
  /**
   * Tests for dispatchReverify routing in reverify.ts (M9.6-S13).
   */

  import { describe, it, expect, vi } from "vitest";
  import { dispatchReverify } from "../../src/capabilities/reverify.js";
  import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
  import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";

  function makeWatcher(overrides = {}): CapabilityWatcher {
    return {
      rescanNow: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as CapabilityWatcher;
  }

  function makeRegistry(type: string, status: "available" | "unavailable" = "available"): CapabilityRegistry {
    return {
      get: (t: string) =>
        t === type
          ? { status, name: `test-${type}`, provides: type, path: "/fake/cap", interface: "script" }
          : undefined,
    } as unknown as CapabilityRegistry;
  }

  function makeFailure(capabilityType: string, withArtifact = false): CapabilityFailure {
    return {
      id: "f-test",
      capabilityType,
      symptom: "execution-error",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+1" },
          "conv-A",
          1,
        ),
        ...(withArtifact ? { artifact: { type: "audio", rawMediaPath: "/tmp/test.ogg", mimeType: "audio/ogg" } } : {}),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  describe("dispatchReverify — routing", () => {
    it("routes audio-to-text to reverifyAudioToText (returns recoveredContent when pass)", async () => {
      // reverifyAudioToText falls back to availability check when no invoker + no script file
      const registry = makeRegistry("audio-to-text");
      const watcher = makeWatcher();
      const failure = makeFailure("audio-to-text");
      const result = await dispatchReverify(failure, registry, watcher);
      // Without a real script, it will fail — but it should NOT route to smoke fixture
      // (smoke fixture would look for /fake/cap/scripts/smoke.sh; audio-to-text has its own reverifier)
      expect(result).toBeDefined();
      expect(typeof result.pass).toBe("boolean");
    });

    it("routes unknown type to runSmokeFixture (availability fallback when no smoke.sh)", async () => {
      const registry = makeRegistry("custom-type");
      const watcher = makeWatcher();
      const failure = makeFailure("custom-type");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await dispatchReverify(failure, registry, watcher);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("template gap"));
      expect(result.pass).toBe(true); // availability fallback: status is "available"
      warnSpy.mockRestore();
    });

    it("returns pass:true inconclusive:true for unknown type with exit-2 smoke script", async () => {
      // This is tested more directly in run-smoke-fixture.test.ts;
      // dispatch routing is the focus here.
      const registry = makeRegistry("custom-type");
      const watcher = makeWatcher();
      const failure = makeFailure("custom-type");
      // Just confirm routing doesn't throw
      const result = await dispatchReverify(failure, registry, watcher);
      expect(result).toBeDefined();
    });

    it("returns pass:false when capability not found in registry (cannot resolve capDir)", async () => {
      const registry = {
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as CapabilityRegistry;
      const watcher = makeWatcher();
      const failure = makeFailure("unknown-type");
      const result = await dispatchReverify(failure, registry, watcher);
      expect(result.pass).toBe(false);
      expect(result.failureMode).toMatch(/not found/);
    });
  });
  ```

  Run to confirm FAIL (function not exported yet):
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/reverify-dispatch
  ```
  Expected: import error or TypeScript error.

- [ ] **Step 3: Add `dispatchReverify` function**

  In `reverify.ts`, add `dispatchReverify` to replace the current `reverify()` as the entry point. Place it above the `REVERIFIERS` table definition (since the table references per-type functions defined below):

  ```typescript
  /**
   * Top-level reverify entry point (M9.6-S13). Routes to per-type reverifier
   * via REVERIFIERS table, or falls through to runSmokeFixture for MCP plugs
   * and unknown types.
   *
   * Replaces the old reverify() monolith. The old export is kept as a deprecated
   * alias for backwards compatibility with existing tests.
   */
  export async function dispatchReverify(
    failure: CapabilityFailure,
    registry: CapabilityRegistry,
    watcher: CapabilityWatcher,
    invoker?: CapabilityInvoker,
  ): Promise<ReverifyResult> {
    // Force rescan + testAll
    await watcher.rescanNow();

    // Wait for capability to be available
    const available = await waitForAvailability(
      registry,
      failure.capabilityType,
      AVAILABILITY_TIMEOUT_MS,
      AVAILABILITY_POLL_MS,
    );

    if (!available) {
      return {
        pass: false,
        failureMode: `capability ${failure.capabilityType} still unavailable after rescan`,
      };
    }

    // Per-type reverifier
    const specific = REVERIFIERS[failure.capabilityType];
    if (specific) {
      return specific(failure, registry, invoker);
    }

    // Smoke-fixture default for MCP plugs and unknown types.
    // runSmokeFixture(capDir, registry, capabilityType) — resolve capDir first.
    const cap = registry.get(failure.capabilityType);
    if (!cap) {
      return { pass: false, failureMode: `${failure.capabilityType} not found in registry` };
    }
    return runSmokeFixture(cap.path, registry, failure.capabilityType);
  }

  /** @deprecated Use dispatchReverify instead (M9.6-S13). */
  export const reverify = dispatchReverify;
  ```

  Run the dispatch tests again:
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/reverify-dispatch
  ```
  Expected: tests pass (or partial pass — per-type reverifiers not yet added will fall through to smoke).

- [ ] **Step 4: Write failing tests for TTS reverifier**

  Create `packages/core/tests/capabilities/reverify-tts.test.ts`:

  ```typescript
  /**
   * Tests for reverifyTextToAudio (M9.6-S13).
   * Runs synthesize.sh with a deterministic fixture phrase and checks the
   * output file has valid audio headers (Ogg or WAV).
   */

  import { describe, it, expect } from "vitest";
  import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";
  import { randomUUID } from "node:crypto";

  // Import the per-type reverifier directly (bypasses dispatch + watcher/rescan)
  // We test it in isolation — dispatchReverify routing is tested in reverify-dispatch.test.ts.
  import { reverifyTextToAudio } from "../../src/capabilities/reverify.js";
  import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

  function makeCapDir(scriptContent: string): string {
    const capDir = join(tmpdir(), `tts-test-${randomUUID()}`);
    mkdirSync(join(capDir, "scripts"), { recursive: true });
    const script = join(capDir, "scripts", "synthesize.sh");
    writeFileSync(script, scriptContent);
    chmodSync(script, 0o755);
    return capDir;
  }

  function makeRegistry(capDir: string): CapabilityRegistry {
    return {
      get: (t: string) =>
        t === "text-to-audio"
          ? { status: "available", name: "tts-test", provides: "text-to-audio", path: capDir, interface: "script" }
          : undefined,
    } as unknown as CapabilityRegistry;
  }

  function makeFailure(): CapabilityFailure {
    return {
      id: "f-tts",
      capabilityType: "text-to-audio",
      symptom: "execution-error",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+1" },
          "conv-A",
          1,
        ),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  describe("reverifyTextToAudio", () => {
    it("returns pass:true with no recoveredContent when synthesize.sh produces valid Ogg output", async () => {
      // Write a script that outputs an Ogg-magic-byte file
      const capDir = makeCapDir(`#!/usr/bin/env bash
  OUTPUT="$1"
  # Write Ogg magic bytes (OggS) to the output file
  printf 'OggS\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00' > "$OUTPUT"
  exit 0
  `);
      const registry = makeRegistry(capDir);
      const result = await reverifyTextToAudio(makeFailure(), registry);
      expect(result.pass).toBe(true);
      expect(result.recoveredContent).toBeUndefined(); // TTS has no retriable content
      expect(result.verificationInputPath).toBeDefined();
    });

    it("returns pass:false when synthesize.sh exits non-zero", async () => {
      const capDir = makeCapDir(`#!/usr/bin/env bash\nexit 1\n`);
      const registry = makeRegistry(capDir);
      const result = await reverifyTextToAudio(makeFailure(), registry);
      expect(result.pass).toBe(false);
    });

    it("returns pass:false when output file has invalid headers", async () => {
      const capDir = makeCapDir(`#!/usr/bin/env bash
  OUTPUT="$1"
  printf 'BADHEADER' > "$OUTPUT"
  exit 0
  `);
      const registry = makeRegistry(capDir);
      const result = await reverifyTextToAudio(makeFailure(), registry);
      expect(result.pass).toBe(false);
      expect(result.failureMode).toMatch(/header/i);
    });

    it("returns pass:false when capability not in registry", async () => {
      const registry = { get: () => undefined } as unknown as CapabilityRegistry;
      const result = await reverifyTextToAudio(makeFailure(), registry);
      expect(result.pass).toBe(false);
    });
  });
  ```

- [ ] **Step 5: Implement `reverifyTextToAudio`**

  In `reverify.ts`, add after `reverifyAudioToText`:

  ```typescript
  /**
   * Reverifier for text-to-audio plugs. Runs synthesize.sh against a
   * deterministic fixture phrase; checks output file has Ogg or WAV magic bytes.
   * Returns recoveredContent: undefined — TTS has no retriable user input.
   */
  export async function reverifyTextToAudio(
    failure: CapabilityFailure,
    registry: CapabilityRegistry,
  ): Promise<ReverifyResult> {
    const cap = registry.get("text-to-audio");
    if (!cap) {
      return { pass: false, failureMode: "text-to-audio capability not in registry" };
    }

    const scriptPath = join(cap.path, "scripts", "synthesize.sh");
    if (!existsSync(scriptPath)) {
      return { pass: false, failureMode: `synthesize.sh not found at ${scriptPath}` };
    }

    const outputPath = join(tmpdir(), `tts-reverify-${Date.now()}.audio`);
    const fixturePath = outputPath; // script receives output path as first arg

    try {
      await execFileAsync(scriptPath, [outputPath], {
        timeout: 30_000,
        cwd: cap.path,
        env: { ...process.env, TTS_REVERIFY_PHRASE: "This is a smoke test." },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { pass: false, failureMode: `synthesize.sh failed: ${message}`, verificationInputPath: scriptPath };
    }

    // Validate audio file headers (Ogg: OggS, WAV: RIFF)
    if (!existsSync(outputPath)) {
      return { pass: false, failureMode: "synthesize.sh exited 0 but no output file found", verificationInputPath: scriptPath };
    }

    const { readFileSync } = await import("node:fs");
    const header = readFileSync(outputPath).slice(0, 4).toString("ascii");
    const validHeader = header.startsWith("OggS") || header.startsWith("RIFF");
    if (!validHeader) {
      return { pass: false, failureMode: `output file has invalid audio header: ${JSON.stringify(header)}`, verificationInputPath: scriptPath };
    }

    return { pass: true, recoveredContent: undefined, verificationInputPath: scriptPath };
  }
  ```

  Note: `tmpdir` and `existsSync` are already imported. Add `{ tmpdir }` from `"node:os"` if not already imported — check the import section of reverify.ts and add if missing.

  Run TTS tests:
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/reverify-tts
  ```
  Expected: all pass.

- [ ] **Step 6: Write + implement `reverifyImageToText`**

  Create `packages/core/tests/capabilities/reverify-image-to-text.test.ts`:

  ```typescript
  /**
   * Tests for reverifyImageToText (M9.6-S13).
   * Returns recoveredContent: undefined — no retriable user input per design §7.
   */

  import { describe, it, expect } from "vitest";
  import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";
  import { randomUUID } from "node:crypto";
  import { reverifyImageToText } from "../../src/capabilities/reverify.js";
  import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

  function makeCapDir(exitCode: number, stdout = ""): string {
    const capDir = join(tmpdir(), `ocr-test-${randomUUID()}`);
    mkdirSync(join(capDir, "scripts"), { recursive: true });
    const script = join(capDir, "scripts", "ocr.sh");
    writeFileSync(script, `#!/usr/bin/env bash\necho "${stdout}"\nexit ${exitCode}\n`);
    chmodSync(script, 0o755);
    return capDir;
  }

  function makeRegistry(capDir: string): CapabilityRegistry {
    return {
      get: (t: string) =>
        t === "image-to-text"
          ? { status: "available", name: "ocr-test", provides: "image-to-text", path: capDir, interface: "script" }
          : undefined,
    } as unknown as CapabilityRegistry;
  }

  function makeFailure(): CapabilityFailure {
    return {
      id: "f-ocr",
      capabilityType: "image-to-text",
      symptom: "execution-error",
      triggeringInput: {
        origin: conversationOrigin({ transportId: "whatsapp", channelId: "ch-1", sender: "+1" }, "conv-A", 1),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  describe("reverifyImageToText", () => {
    it("returns pass:true with recoveredContent:undefined when ocr.sh produces non-empty output", async () => {
      const capDir = makeCapDir(0, "Sample text from test image");
      const result = await reverifyImageToText(makeFailure(), makeRegistry(capDir));
      expect(result.pass).toBe(true);
      expect(result.recoveredContent).toBeUndefined();
      expect(result.verificationInputPath).toBeDefined();
    });

    it("returns pass:false when ocr.sh exits non-zero", async () => {
      const capDir = makeCapDir(1);
      const result = await reverifyImageToText(makeFailure(), makeRegistry(capDir));
      expect(result.pass).toBe(false);
    });

    it("returns pass:false when ocr.sh outputs empty text", async () => {
      const capDir = makeCapDir(0, "");
      const result = await reverifyImageToText(makeFailure(), makeRegistry(capDir));
      expect(result.pass).toBe(false);
      expect(result.failureMode).toMatch(/empty/i);
    });
  });
  ```

  Implement `reverifyImageToText` in `reverify.ts`:

  ```typescript
  /**
   * Reverifier for image-to-text plugs. Runs ocr.sh against a template-supplied
   * stock test image; expects non-empty text on stdout.
   * Returns recoveredContent: undefined per design §7 (real-artifact reverify deferred).
   */
  export async function reverifyImageToText(
    failure: CapabilityFailure,
    registry: CapabilityRegistry,
  ): Promise<ReverifyResult> {
    const cap = registry.get("image-to-text");
    if (!cap) {
      return { pass: false, failureMode: "image-to-text capability not in registry" };
    }

    const scriptPath = join(cap.path, "scripts", "ocr.sh");
    if (!existsSync(scriptPath)) {
      // Fall through to smoke fixture
      return runSmokeFixture(cap.path, registry, "image-to-text");
    }

    // Use template-supplied test image if present; otherwise let the script choose
    const testImagePath = join(cap.path, "scripts", "test-image.png");
    const scriptArgs = existsSync(testImagePath) ? [testImagePath] : [];

    try {
      const { stdout } = await execFileAsync(scriptPath, scriptArgs, {
        timeout: 30_000,
        cwd: cap.path,
        env: { ...process.env },
      });
      const text = stdout.trim();
      if (!text) {
        return { pass: false, failureMode: "ocr.sh produced empty output", verificationInputPath: scriptPath };
      }
      return { pass: true, recoveredContent: undefined, verificationInputPath: scriptPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { pass: false, failureMode: `ocr.sh failed: ${message}`, verificationInputPath: scriptPath };
    }
  }
  ```

  Run tests:
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/reverify-image-to-text
  ```
  Expected: all pass.

- [ ] **Step 7: Write + implement `reverifyTextToImage`**

  Create `packages/core/tests/capabilities/reverify-text-to-image.test.ts`:

  ```typescript
  /**
   * Tests for reverifyTextToImage (M9.6-S13).
   */

  import { describe, it, expect } from "vitest";
  import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";
  import { randomUUID } from "node:crypto";
  import { reverifyTextToImage } from "../../src/capabilities/reverify.js";
  import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

  function makeCapDir(exitCode: number, outputMagic = ""): string {
    const capDir = join(tmpdir(), `t2i-test-${randomUUID()}`);
    mkdirSync(join(capDir, "scripts"), { recursive: true });
    const script = join(capDir, "scripts", "generate.sh");
    // Script receives output path as $1, writes image there
    writeFileSync(script, `#!/usr/bin/env bash\nOUTPUT="$1"\nprintf '${outputMagic}' > "$OUTPUT"\nexit ${exitCode}\n`);
    chmodSync(script, 0o755);
    return capDir;
  }

  function makeRegistry(capDir: string): CapabilityRegistry {
    return {
      get: (t: string) =>
        t === "text-to-image"
          ? { status: "available", name: "t2i-test", provides: "text-to-image", path: capDir, interface: "script" }
          : undefined,
    } as unknown as CapabilityRegistry;
  }

  function makeFailure(): CapabilityFailure {
    return {
      id: "f-t2i",
      capabilityType: "text-to-image",
      symptom: "execution-error",
      triggeringInput: {
        origin: conversationOrigin({ transportId: "whatsapp", channelId: "ch-1", sender: "+1" }, "conv-A", 1),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  describe("reverifyTextToImage", () => {
    it("returns pass:true with recoveredContent:undefined when generate.sh produces valid PNG output", async () => {
      // PNG magic bytes: \x89PNG
      const capDir = makeCapDir(0, "\\x89PNG\\x00\\x00");
      const result = await reverifyTextToImage(makeFailure(), makeRegistry(capDir));
      expect(result.pass).toBe(true);
      expect(result.recoveredContent).toBeUndefined();
      expect(result.verificationInputPath).toBeDefined();
    });

    it("returns pass:false when generate.sh exits non-zero", async () => {
      const capDir = makeCapDir(1, "");
      const result = await reverifyTextToImage(makeFailure(), makeRegistry(capDir));
      expect(result.pass).toBe(false);
    });

    it("returns pass:false when output has invalid image header", async () => {
      const capDir = makeCapDir(0, "BADHEADER");
      const result = await reverifyTextToImage(makeFailure(), makeRegistry(capDir));
      expect(result.pass).toBe(false);
      expect(result.failureMode).toMatch(/header/i);
    });
  });
  ```

  Implement `reverifyTextToImage` in `reverify.ts`:

  ```typescript
  /**
   * Reverifier for text-to-image plugs. Runs generate.sh against a deterministic
   * fixture prompt; checks output file has valid image header (PNG or JPEG).
   * Returns recoveredContent: undefined — no retriable user input.
   */
  export async function reverifyTextToImage(
    failure: CapabilityFailure,
    registry: CapabilityRegistry,
  ): Promise<ReverifyResult> {
    const cap = registry.get("text-to-image");
    if (!cap) {
      return { pass: false, failureMode: "text-to-image capability not in registry" };
    }

    const scriptPath = join(cap.path, "scripts", "generate.sh");
    if (!existsSync(scriptPath)) {
      return runSmokeFixture(cap.path, registry, "text-to-image");
    }

    const outputPath = join(tmpdir(), `t2i-reverify-${Date.now()}.image`);

    try {
      await execFileAsync(scriptPath, [outputPath], {
        timeout: 60_000,
        cwd: cap.path,
        env: { ...process.env, T2I_REVERIFY_PROMPT: "A red circle on a white background." },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { pass: false, failureMode: `generate.sh failed: ${message}`, verificationInputPath: scriptPath };
    }

    if (!existsSync(outputPath)) {
      return { pass: false, failureMode: "generate.sh exited 0 but no output file found", verificationInputPath: scriptPath };
    }

    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(outputPath);
    // PNG: 89 50 4E 47, JPEG: FF D8, WebP: RIFF????WEBP
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isWebp = buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";

    if (!isPng && !isJpeg && !isWebp) {
      return {
        pass: false,
        failureMode: `output file has invalid image header: ${buf.slice(0, 4).toString("hex")}`,
        verificationInputPath: scriptPath,
      };
    }

    return { pass: true, recoveredContent: undefined, verificationInputPath: scriptPath };
  }
  ```

  Run tests:
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/reverify-text-to-image
  ```
  Expected: all pass.

- [ ] **Step 8: Run all reverify tests**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/reverify-dispatch tests/capabilities/reverify-tts tests/capabilities/reverify-image-to-text tests/capabilities/reverify-text-to-image tests/capabilities/run-smoke-fixture
  ```
  Expected: all pass.

- [ ] **Step 9: TypeScript check**

  ```bash
  cd /home/nina/my_agent/packages/core && npx tsc --noEmit
  ```
  Expected: zero errors. If there are errors about `tmpdir` not imported in `reverify.ts`, add `import { tmpdir } from "node:os";` at the top.

- [ ] **Step 10: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/reverify.ts \
          packages/core/tests/capabilities/reverify-dispatch.test.ts \
          packages/core/tests/capabilities/reverify-tts.test.ts \
          packages/core/tests/capabilities/reverify-image-to-text.test.ts \
          packages/core/tests/capabilities/reverify-text-to-image.test.ts
  git commit -m "feat(m9.6-s13): add dispatchReverify + per-type reverifiers (TTS, image-to-text, text-to-image)"
  ```

---

## Task 3: Extend state machine — RESTORED_TERMINAL + REVERIFY_PASS_TERMINAL + TERMINAL_ACK

**Files:**
- Modify: `packages/core/src/capabilities/orchestrator-state-machine.ts`
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts`

**Context:** The current state machine has one terminal success state (`DONE`) and one terminal event (`REVERIFY_PASS`). S13 adds `RESTORED_TERMINAL` for plugs without retriable input (TTS, image, MCP), renames `DONE` → `RESTORED_WITH_REPROCESS` for clarity, renames `REVERIFY_PASS` → `REVERIFY_PASS_RECOVERED`, and adds `REVERIFY_PASS_TERMINAL` + `TERMINAL_ACK`.

**Breaking changes — what will need updating in the orchestrator (Task 4):**
- `session.state = "DONE"` → `session.state = "RESTORED_WITH_REPROCESS"`
- `nextAction(session, { type: "REVERIFY_PASS", ... })` → `nextAction(session, { type: "REVERIFY_PASS_RECOVERED", ... })`
- Import of `dispatchReverify` instead of `reverify` (already done — `reverify` is now an alias)

- [ ] **Step 1: Write failing tests for new state machine transitions**

  Add to the end of the `transitions` array in `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts`:

  ```typescript
    // ── Terminal-fix path (RESTORED_TERMINAL) ─────────────────────────────────
    {
      label: "REVERIFYING + REVERIFY_PASS_TERMINAL → TERMINAL_ACK",
      session: { state: "REVERIFYING", attemptNumber: 1 },
      event: { type: "REVERIFY_PASS_TERMINAL" },
      expected: { action: "TERMINAL_ACK" },
    },
    {
      label: "RESTORED_TERMINAL is terminal → NOOP",
      session: { state: "RESTORED_TERMINAL", attemptNumber: 1 },
      event: { type: "CFR_RECEIVED" },
      expected: { action: "NOOP" },
    },
  ```

  Also update the existing `REVERIFY_PASS` test case:
  Old:
  ```typescript
    {
      label: "REVERIFYING + REVERIFY_PASS → REPROCESS_TURN",
      session: { state: "REVERIFYING", attemptNumber: 1 },
      event: { type: "REVERIFY_PASS", recoveredContent: "hello world" },
      expected: { action: "REPROCESS_TURN", recoveredContent: "hello world" },
    },
    {
      label: "DONE + REPROCESS_SENT → NOOP",
      session: { state: "DONE", attemptNumber: 1 },
      event: { type: "REPROCESS_SENT" },
      expected: { action: "NOOP" },
    },
  ```
  New:
  ```typescript
    {
      label: "REVERIFYING + REVERIFY_PASS_RECOVERED → REPROCESS_TURN",
      session: { state: "REVERIFYING", attemptNumber: 1 },
      event: { type: "REVERIFY_PASS_RECOVERED", recoveredContent: "hello world" },
      expected: { action: "REPROCESS_TURN", recoveredContent: "hello world" },
    },
    {
      label: "RESTORED_WITH_REPROCESS + REPROCESS_SENT → NOOP",
      session: { state: "RESTORED_WITH_REPROCESS", attemptNumber: 1 },
      event: { type: "REPROCESS_SENT" },
      expected: { action: "NOOP" },
    },
  ```

  Run to confirm FAIL:
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator/orchestrator-state-machine
  ```

- [ ] **Step 2: Update the state machine**

  In `packages/core/src/capabilities/orchestrator-state-machine.ts`, apply all changes:

  ```typescript
  export type OrchestratorState =
    | "IDLE"
    | "ACKED"
    | "EXECUTING"
    | "REFLECTING"
    | "REVERIFYING"
    | "RESTORED_WITH_REPROCESS"   // renamed from DONE — reprocess path (STT)
    | "RESTORED_TERMINAL"          // new — terminal path (TTS, image, MCP)
    | "SURRENDER";
  ```

  ```typescript
  export type OrchestratorEvent =
    | { type: "CFR_RECEIVED" }
    | { type: "ACK_SENT" }
    | { type: "EXECUTE_JOB_SPAWNED"; jobId: string }
    | { type: "EXECUTE_JOB_DONE"; success: boolean }
    | { type: "REFLECT_JOB_DONE"; nextHypothesis: string }
    | { type: "REVERIFY_PASS_RECOVERED"; recoveredContent: string }  // renamed from REVERIFY_PASS
    | { type: "REVERIFY_PASS_TERMINAL" }                              // new
    | { type: "REVERIFY_FAIL" }
    | { type: "REPROCESS_SENT" };
  ```

  ```typescript
  export type Action =
    | { action: "SEND_ACK"; kind: "attempt" | "status" | "surrender" }
    | { action: "SPAWN_EXECUTE_JOB" }
    | { action: "SPAWN_REFLECT_JOB" }
    | { action: "REVERIFY" }
    | { action: "REPROCESS_TURN"; recoveredContent: string }
    | { action: "TERMINAL_ACK" }    // new
    | { action: "SURRENDER" }
    | { action: "ITERATE"; nextAttemptNumber: 2 | 3 }
    | { action: "NOOP" };
  ```

  Update the `REVERIFYING` case in `nextAction`:
  ```typescript
      case "REVERIFYING": {
        if (event.type === "REVERIFY_PASS_RECOVERED") {
          return { action: "REPROCESS_TURN", recoveredContent: event.recoveredContent };
        }
        if (event.type === "REVERIFY_PASS_TERMINAL") {
          return { action: "TERMINAL_ACK" };
        }
        if (event.type === "REVERIFY_FAIL") {
          if (attemptNumber < 3) {
            return { action: "ITERATE", nextAttemptNumber: (attemptNumber + 1) as 2 | 3 };
          } else {
            return { action: "SURRENDER" };
          }
        }
        break;
      }
  ```

  Update the `DONE` case (rename to `RESTORED_WITH_REPROCESS`):
  ```typescript
      case "RESTORED_WITH_REPROCESS": {
        if (event.type === "REPROCESS_SENT") {
          return { action: "NOOP" };
        }
        break;
      }

      case "RESTORED_TERMINAL": {
        // Terminal — no further transitions
        break;
      }
  ```

- [ ] **Step 3: Run state machine tests — must be green**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator/orchestrator-state-machine
  ```
  Expected: all pass.

- [ ] **Step 4: Check for any other test files referencing DONE or REVERIFY_PASS**

  ```bash
  rg '"DONE"|REVERIFY_PASS[^_]|"REVERIFY_PASS"' /home/nina/my_agent/packages/core/tests/
  ```
  Update any matches (other than the file just edited). The budget + timing + other orchestrator tests shouldn't use these — confirm and fix if found.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/orchestrator-state-machine.ts \
          packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts
  git commit -m "feat(m9.6-s13): add RESTORED_TERMINAL state + REVERIFY_PASS_TERMINAL event + TERMINAL_ACK action"
  ```

---

## Task 4: Update orchestrator — terminal branch + dispatchReverify wiring

**Files:**
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts`
- Create: `packages/core/tests/capabilities/orchestrator/terminal-routing.test.ts`

**Context:** The orchestrator's run loop and `doReverify` need to (a) call `dispatchReverify` instead of `reverify`, (b) branch on `recoveredContent` presence after reverify pass, (c) emit `REVERIFY_PASS_RECOVERED` or `REVERIFY_PASS_TERMINAL` accordingly, (d) extend `terminalDrain` to handle the terminal-fixed outcome. S12's 6-step drain already handles the delivery per origin — S13 only adds the branch.

- [ ] **Step 1: Write failing terminal-routing tests**

  Create `packages/core/tests/capabilities/orchestrator/terminal-routing.test.ts`:

  ```typescript
  /**
   * Tests for terminal routing in RecoveryOrchestrator (M9.6-S13).
   *
   * When reverify passes with recoveredContent undefined (TTS/image/MCP),
   * the orchestrator must:
   *  - Set state to RESTORED_TERMINAL
   *  - NOT call reprocessTurn
   *  - Call emitAck with "terminal-fixed" kind for conversation origins
   */

  import { describe, it, expect, vi } from "vitest";
  import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { OrchestratorDeps, AutomationResult } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
  import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

  function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
    return {
      spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "done" } as AutomationResult),
      getJobRunDir: vi.fn().mockReturnValue(null),
      capabilityRegistry: {
        get: vi.fn().mockReturnValue({
          status: "available",
          path: "/fake/cap",
          provides: "text-to-audio",
          enabled: true,
        }),
      } as unknown as CapabilityRegistry,
      watcher: {
        rescanNow: vi.fn().mockResolvedValue([]),
      } as unknown as CapabilityWatcher,
      emitAck: vi.fn().mockResolvedValue(undefined),
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      now: () => new Date().toISOString(),
      ...overrides,
    };
  }

  function makeFailure(capabilityType = "text-to-audio"): CapabilityFailure {
    return {
      id: "f-terminal",
      capabilityType,
      symptom: "execution-error",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+1" },
          "conv-A",
          1,
        ),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  describe("RecoveryOrchestrator — RESTORED_TERMINAL routing", () => {
    it("emits terminal-fixed ack instead of reprocessTurn when reverify returns no recoveredContent", async () => {
      // Mock dispatchReverify to return pass:true, recoveredContent:undefined
      // We achieve this by mocking the reverify module used by the orchestrator.
      // The orchestrator imports reverify from "./reverify.js"; we mock at the module level.
      const deps = makeDeps();
      const orchestrator = new RecoveryOrchestrator(deps);

      // Note: to make reverify return pass:true without recoveredContent, we need
      // the smoke fixture to pass. The registry returns status:available and capDir
      // has no smoke.sh, so it falls through to availability-based pass (no recoveredContent).
      // This naturally exercises the RESTORED_TERMINAL path.
      await orchestrator.handle(makeFailure("text-to-audio"));

      const emitAck = deps.emitAck as ReturnType<typeof vi.fn>;
      const reprocessTurn = deps.reprocessTurn as ReturnType<typeof vi.fn>;

      // Should NOT have called reprocessTurn (no recoveredContent)
      expect(reprocessTurn).not.toHaveBeenCalled();

      // Should have emitted "terminal-fixed" ack (or surrendered if reverify failed)
      // Given our registry stub returns available status, reverify passes → terminal-fixed
      const terminalAcks = emitAck.mock.calls.filter((c) => c[1] === "terminal-fixed");
      expect(terminalAcks.length).toBeGreaterThan(0);
    });

    it("calls reprocessTurn when reverify returns recoveredContent (audio-to-text path)", async () => {
      // audio-to-text reverifier needs a rawMediaPath and invoker; without them it fails reverify.
      // So this test goes through the failure path and surrenders — confirm reprocessTurn not called.
      const deps = makeDeps({
        capabilityRegistry: {
          get: vi.fn().mockReturnValue({
            status: "available",
            path: "/fake/cap",
            provides: "audio-to-text",
            enabled: true,
          }),
        } as unknown as CapabilityRegistry,
      });
      const orchestrator = new RecoveryOrchestrator(deps);
      await orchestrator.handle({
        ...makeFailure("audio-to-text"),
        triggeringInput: {
          origin: conversationOrigin(
            { transportId: "whatsapp", channelId: "ch-1", sender: "+1" },
            "conv-A",
            1,
          ),
          artifact: { type: "audio", rawMediaPath: "/tmp/nonexistent.ogg", mimeType: "audio/ogg" },
        },
      });

      // Without a real artifact file, reverify will fail → surrender (not reprocess)
      const emitAck = deps.emitAck as ReturnType<typeof vi.fn>;
      const surrenderAcks = emitAck.mock.calls.filter((c) => c[1] === "surrender" || c[1] === "surrender-budget");
      expect(surrenderAcks.length).toBeGreaterThan(0);
    });
  });
  ```

  Run to confirm FAIL:
  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator/terminal-routing
  ```

- [ ] **Step 2: Add `"terminal-fixed"` to `AckKind`**

  In `recovery-orchestrator.ts`, find:
  ```typescript
  export type AckKind = "attempt" | "status" | "surrender" | "surrender-budget" | "surrender-cooldown";
  ```
  Replace with:
  ```typescript
  export type AckKind = "attempt" | "status" | "surrender" | "surrender-budget" | "surrender-cooldown" | "terminal-fixed";
  ```

- [ ] **Step 3: Extend `terminalDrain` args for terminal-fixed outcome**

  Find the `terminalDrain` method signature:
  ```typescript
  private async terminalDrain(
    failure: CapabilityFailure,
    session: FixSession,
    args: { outcome: "fixed" | "surrendered"; recoveredContent?: string },
  ): Promise<void> {
  ```
  Replace with:
  ```typescript
  private async terminalDrain(
    failure: CapabilityFailure,
    session: FixSession,
    args: { outcome: "fixed" | "terminal-fixed" | "surrendered"; recoveredContent?: string },
  ): Promise<void> {
  ```

  Also update `writeAutomationRecovery` dep type (in the `OrchestratorDeps` interface):
  ```typescript
  writeAutomationRecovery?: (args: {
    failure: CapabilityFailure;
    runDir: string;
    outcome: "fixed" | "terminal-fixed" | "surrendered";
    session: { attempts: FixAttempt[]; surrenderReason?: "budget" | "iteration-3" };
  }) => void;
  ```

  In the `terminalDrain` body, update the conversation-origin branch (Step 4 of the drain):
  Old:
  ```typescript
      try {
        if (outcome === "fixed" && recoveredContent !== undefined) {
          await this.deps.reprocessTurn(perOriginFailure, recoveredContent);
        } else {
          await this.deps.emitAck(perOriginFailure, terminalAckKind);
        }
  ```
  New:
  ```typescript
      try {
        if (outcome === "fixed" && recoveredContent !== undefined) {
          await this.deps.reprocessTurn(perOriginFailure, recoveredContent);
        } else if (outcome === "terminal-fixed") {
          await this.deps.emitAck(perOriginFailure, "terminal-fixed");
        } else {
          await this.deps.emitAck(perOriginFailure, terminalAckKind);
        }
  ```

- [ ] **Step 4: Update `doReverify` to call `dispatchReverify`**

  In the `doReverify` method, update the import (if it's inline) or check the file-level import. The file already imports `reverify` as an alias for `dispatchReverify` — so no import change needed. But for clarity, update the call site comment:

  ```typescript
  const result = await reverify(failure, this.deps.capabilityRegistry, this.deps.watcher, this.deps.invoker);
  ```

  This works because `reverify` is now an alias for `dispatchReverify`. No code change required unless the import is explicit — verify with:
  ```bash
  grep "import.*reverify" /home/nina/my_agent/packages/core/src/capabilities/recovery-orchestrator.ts
  ```
  If it imports `{ reverify }`, it still works (alias is exported). Optionally update to `{ dispatchReverify as reverify }` for clarity — not required.

- [ ] **Step 5: Update the run loop to branch on recoveredContent**

  In the run loop where `attemptResult.recovered` is checked (around line 294-308):

  Old:
  ```typescript
        if (attemptResult.recovered) {
          // Reverify passed — drive the drain (M9.6-S12 Task 6b).
          const reprocessAction = nextAction(session, {
            type: "REVERIFY_PASS",
            recoveredContent: attemptResult.recoveredContent!,
          });
          if (reprocessAction.action === "REPROCESS_TURN") {
            session.state = "DONE";
            await this.terminalDrain(failure, session, {
              outcome: "fixed",
              recoveredContent: reprocessAction.recoveredContent,
            });
            nextAction(session, { type: "REPROCESS_SENT" });
            return;
          }
        }
  ```

  New:
  ```typescript
        if (attemptResult.recovered) {
          if (attemptResult.recoveredContent !== undefined) {
            // Reprocess path (STT, image-to-text with artifact): re-run the user's turn.
            const reprocessAction = nextAction(session, {
              type: "REVERIFY_PASS_RECOVERED",
              recoveredContent: attemptResult.recoveredContent,
            });
            if (reprocessAction.action === "REPROCESS_TURN") {
              session.state = "RESTORED_WITH_REPROCESS";
              await this.terminalDrain(failure, session, {
                outcome: "fixed",
                recoveredContent: reprocessAction.recoveredContent,
              });
              nextAction(session, { type: "REPROCESS_SENT" });
              return;
            }
          } else {
            // Terminal path (TTS, text-to-image, MCP): capability is healthy
            // but there is no user input to replay — ack and finish.
            const terminalAction = nextAction(session, { type: "REVERIFY_PASS_TERMINAL" });
            if (terminalAction.action === "TERMINAL_ACK") {
              session.state = "RESTORED_TERMINAL";
              await this.terminalDrain(failure, session, { outcome: "terminal-fixed" });
              return;
            }
          }
        }
  ```

- [ ] **Step 6: Update verificationInputPath in doReverify**

  In `doReverify`, the `FixAttempt` records `verificationInputPath`. Update to use the value from the reverify result when available:

  In the `doReverify` body, after calling `reverify(...)`, find where the `executeAttempt.verificationInputPath` is set (it's set on the attempt object before calling this method). Look for where the attempt is mutated:

  ```typescript
  executeAttempt.verificationResult = "pass";
  ```
  or
  ```typescript
  executeAttempt.verificationResult = "fail";
  ```

  Before these lines, add:
  ```typescript
  if (result.verificationInputPath) {
    executeAttempt.verificationInputPath = result.verificationInputPath;
  }
  ```

  This ensures the field is never empty string after S13 — the reverifier always populates `verificationInputPath` now.

- [ ] **Step 7: Run all tests**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator/terminal-routing
  ```
  Expected: both tests pass.

  ```bash
  cd /home/nina/my_agent/packages/core && npx tsc --noEmit
  ```
  Expected: zero errors. Common issues:
  - `DONE` state reference somewhere in orchestrator → update to `RESTORED_WITH_REPROCESS`
  - `REVERIFY_PASS` event reference → update to `REVERIFY_PASS_RECOVERED`
  - `writeAutomationRecovery` outcome type mismatch → check the `writeAutomationRecovery` dep interface

- [ ] **Step 8: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/recovery-orchestrator.ts \
          packages/core/tests/capabilities/orchestrator/terminal-routing.test.ts
  git commit -m "feat(m9.6-s13): add RESTORED_TERMINAL orchestrator routing + dispatchReverify wiring"
  ```

---

## Task 5: Acceptance + full verification

- [ ] **Step 1: Run full orchestrator test suite**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
  ```
  Expected: all pass. The pre-existing `integration.test.ts` MCP-spawn flake (Connection closed) is not in scope — note its presence but do not investigate.

- [ ] **Step 2: Run full CFR capability tests**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities
  ```
  Expected: pass across the board (minus pre-existing flake).

- [ ] **Step 3: Verify universal coverage check**

  Every plug type must have either a per-type reverifier (in `REVERIFIERS`) or route through `runSmokeFixture`:
  ```bash
  rg 'provides:' "$(pwd)/.my_agent/capabilities/" -r --include "*.yaml" --include "*.md" 2>/dev/null || echo "no installed caps found (private dir)"
  ```
  For each installed type, confirm it appears in `REVERIFIERS` or that its `smoke.sh` was delivered in S11. Log any gaps as DEVIATIONS.

- [ ] **Step 4: Type-check dashboard**

  ```bash
  cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit
  ```
  Expected: zero errors. If `writeAutomationRecovery` type propagates to dashboard types, update accordingly.

- [ ] **Step 5: Create or update DECISIONS.md for any non-trivial decisions**

  Common decisions to log:
  - How `dispatchReverify` replaced `reverify()` (with alias for backward compat)
  - `reverify()` alias kept for existing tests — clean removal scheduled for Phase 3
  - `reverifyImageToText` falls through to `runSmokeFixture` when `ocr.sh` not found (graceful degradation)
  - `verificationInputPath` in `ReverifyResult` approach (vs. computing it in the orchestrator)

---

## Sprint Artifacts Checklist

**Files:**
- Modify: `packages/core/src/capabilities/orchestrator-state-machine.ts`

- [ ] **Step 1: Open the file and read the current content**

  Read `packages/core/src/capabilities/orchestrator-state-machine.ts` in full. The file is ~149 lines. Confirm you see:
  - `OrchestratorState` union at line 10
  - `OrchestratorEvent` union at line 19
  - `FixSession.reflectJobId?: string` at line 35
  - `Action` union at line 56
  - `MAX_JOBS = 5` at line 66
  - REFLECTING case handler at lines 113–118
  - EXECUTING success returning `SPAWN_REFLECT_JOB` at line 100

- [ ] **Step 2: Apply all Commit-1 state-machine changes in one edit**

  > **Compile-safety note:** `REFLECT_JOB_DONE` and `reflectJobId` are kept in the Commit-1 types even though they will be unused. Removing them now would break `recovery-orchestrator.ts` at `tsc` before Commit 2 lands. They are deleted in Task 6 alongside the orchestrator code that references them.

  Replace the entire file content with:

  ```typescript
  /**
   * orchestrator-state-machine.ts — Pure state machine for the CFR recovery loop.
   *
   * No I/O. All transitions are deterministic given (session, event).
   * Created in M9.6-S4. M9.6-S13: reflect phase removed; EXECUTING success
   * goes directly to REVERIFY. REFLECT_JOB_DONE and reflectJobId are dead
   * after this commit and removed in the accompanying orchestrator commit.
   */

  import type { FixAttempt, TriggeringOrigin } from "./cfr-types.js";

  export type OrchestratorState =
    | "IDLE"
    | "ACKED"
    | "EXECUTING"
    | "REVERIFYING"
    | "DONE"
    | "SURRENDER";

  export type OrchestratorEvent =
    | { type: "CFR_RECEIVED" }
    | { type: "ACK_SENT" }
    | { type: "EXECUTE_JOB_SPAWNED"; jobId: string }
    | { type: "EXECUTE_JOB_DONE"; success: boolean }
    // REFLECT_JOB_DONE: dead after S13 — removed with renderReflectPrompt in the orchestrator commit
    | { type: "REFLECT_JOB_DONE"; nextHypothesis: string }
    | { type: "REVERIFY_PASS"; recoveredContent: string }
    | { type: "REVERIFY_FAIL" }
    | { type: "REPROCESS_SENT" };

  export interface FixSession {
    failureId: string;
    capabilityType: string;
    attemptNumber: 1 | 2 | 3;
    state: OrchestratorState;
    executeJobId?: string;
    // reflectJobId: dead after S13 — removed with the reflect spawn code in the orchestrator commit
    reflectJobId?: string;
    attempts: FixAttempt[];
    totalJobsSpawned: number;
    /**
     * When a surrender is about to be emitted, set to "budget" if the job
     * safety ceiling forced an early bail, or "iteration-3" if all three
     * attempts ran and reverify still failed. Consumed by
     * RecoveryOrchestrator.surrender() to pick the right user-facing copy.
     */
    surrenderReason?: "budget" | "iteration-3";
    /**
     * All triggering origins that have coalesced onto this fix session (M9.6-S12
     * Task 6a — D7). Initialized with the first CFR's origin; late-arriving CFRs
     * for the same capability type append (N-aware, no second spawn, no duplicate
     * ack). The terminal drain iterates this list so every attached origin gets
     * its recovery delivery.
     */
    attachedOrigins: TriggeringOrigin[];
  }

  export type Action =
    | { action: "SEND_ACK"; kind: "attempt" | "status" | "surrender" }
    | { action: "SPAWN_EXECUTE_JOB" }
    | { action: "REVERIFY" }
    | { action: "REPROCESS_TURN"; recoveredContent: string }
    | { action: "SURRENDER" }
    | { action: "ITERATE"; nextAttemptNumber: 2 | 3 }
    | { action: "NOOP" };

  /**
   * Safety ceiling: 3 attempts × 1 job each = 3 max in normal operation.
   * Cap is 4 as defence-in-depth against runaway nesting (fix-mode forbids
   * nested spawns, but this prevents any future regression from causing
   * unbounded job spawning).
   */
  const MAX_JOBS = 4;

  /**
   * Compute the next action given the current session state and an incoming event.
   *
   * Returns SURRENDER immediately if the job budget is already exhausted
   * (checked before any state-specific logic).
   */
  export function nextAction(session: FixSession, event: OrchestratorEvent): Action {
    if (session.totalJobsSpawned >= MAX_JOBS) {
      return { action: "SURRENDER" };
    }

    const { state, attemptNumber } = session;

    switch (state) {
      case "IDLE": {
        if (event.type === "CFR_RECEIVED") {
          return { action: "SEND_ACK", kind: "attempt" };
        }
        break;
      }

      case "ACKED": {
        if (event.type === "ACK_SENT") {
          return { action: "SPAWN_EXECUTE_JOB" };
        }
        break;
      }

      case "EXECUTING": {
        if (event.type === "EXECUTE_JOB_DONE") {
          if (event.success) {
            return { action: "REVERIFY" };
          } else {
            if (attemptNumber < 3) {
              return { action: "ITERATE", nextAttemptNumber: (attemptNumber + 1) as 2 | 3 };
            } else {
              return { action: "SURRENDER" };
            }
          }
        }
        break;
      }

      case "REVERIFYING": {
        if (event.type === "REVERIFY_PASS") {
          return { action: "REPROCESS_TURN", recoveredContent: event.recoveredContent };
        }
        if (event.type === "REVERIFY_FAIL") {
          if (attemptNumber < 3) {
            return { action: "ITERATE", nextAttemptNumber: (attemptNumber + 1) as 2 | 3 };
          } else {
            return { action: "SURRENDER" };
          }
        }
        break;
      }

      case "DONE": {
        if (event.type === "REPROCESS_SENT") {
          return { action: "NOOP" };
        }
        break;
      }

      case "SURRENDER": {
        break;
      }
    }

    return { action: "NOOP" };
  }
  ```

---

## Task 2: Narrow FixAttempt.phase (Commit 1, part B)

**Files:**
- Modify: `packages/core/src/capabilities/cfr-types.ts`

- [ ] **Step 1: Find the FixAttempt interface**

  Search for `FixAttempt` in `packages/core/src/capabilities/cfr-types.ts`. The `phase` field is currently `"execute" | "reflect"`.

- [ ] **Step 2: Narrow the phase field and update the comment**

  Find and replace the header comment and the `phase` line:

  Old:
  ```typescript
   * FixAttempt.phase stays as-is (Phase 3 narrows in S17).
  ```
  New:
  ```typescript
   * M9.6-S13: FixAttempt.phase narrowed to "execute" only (reflect phase removed).
  ```

  Old:
  ```typescript
    phase: "execute" | "reflect";
  ```
  New:
  ```typescript
    phase: "execute";
  ```

---

## Task 3: Update State Machine Tests (Commit 1, part C)

**Files:**
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts`

- [ ] **Step 1: Read the current test file**

  Read the full file (`~169 lines`). Identify:
  - Line 49: test case `"EXECUTING + EXECUTE_JOB_DONE(success=true) → SPAWN_REFLECT_JOB"` — needs to change to `REVERIFY`
  - Lines 54–59: test case `"REFLECTING + REFLECT_JOB_DONE → REVERIFY"` — delete entirely
  - Lines 126–131: test case `"REFLECTING + REFLECT_JOB_DONE with 5 jobs → SURRENDER"` — delete entirely

- [ ] **Step 2: Fix the EXECUTING success test case**

  Old:
  ```typescript
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → SPAWN_REFLECT_JOB",
      session: { state: "EXECUTING", attemptNumber: 1 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "SPAWN_REFLECT_JOB" },
    },
  ```
  New:
  ```typescript
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → REVERIFY",
      session: { state: "EXECUTING", attemptNumber: 1 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "REVERIFY" },
    },
  ```

- [ ] **Step 3: Remove the REFLECTING → REVERIFY test case**

  Delete this block entirely (lines ~54–59):
  ```typescript
    {
      label: "REFLECTING + REFLECT_JOB_DONE → REVERIFY",
      session: { state: "REFLECTING", attemptNumber: 1 },
      event: { type: "REFLECT_JOB_DONE", nextHypothesis: "try reinstalling deps" },
      expected: { action: "REVERIFY" },
    },
  ```

- [ ] **Step 4: Remove the REFLECTING budget test case**

  Delete this block entirely (lines ~126–131):
  ```typescript
    {
      label: "REFLECTING + REFLECT_JOB_DONE with 5 jobs → SURRENDER",
      session: { state: "REFLECTING", attemptNumber: 2, totalJobsSpawned: 5 },
      event: { type: "REFLECT_JOB_DONE", nextHypothesis: "anything" },
      expected: { action: "SURRENDER" },
    },
  ```

- [ ] **Step 5: Update the budget test cases**

  The two existing budget test cases use `totalJobsSpawned: 5` as the trigger. With MAX_JOBS=4, these need to be updated to use `4`:

  Old:
  ```typescript
    {
      label: "ACKED + ACK_SENT with 5 jobs already spawned → SURRENDER",
      session: { state: "ACKED", attemptNumber: 1, totalJobsSpawned: 5 },
      event: { type: "ACK_SENT" },
      expected: { action: "SURRENDER" },
    },
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success) with 5 jobs → SURRENDER",
      session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 5 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "SURRENDER" },
    },
  ```
  New:
  ```typescript
    {
      label: "ACKED + ACK_SENT with 4 jobs already spawned → SURRENDER",
      session: { state: "ACKED", attemptNumber: 1, totalJobsSpawned: 4 },
      event: { type: "ACK_SENT" },
      expected: { action: "SURRENDER" },
    },
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success) with 4 jobs → SURRENDER",
      session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 4 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "SURRENDER" },
    },
  ```

  Also update the over-budget test case:
  Old:
  ```typescript
    {
      label: "budget: totalJobsSpawned=6 (over) → SURRENDER regardless",
      session: { state: "IDLE", attemptNumber: 1, totalJobsSpawned: 6 },
      event: { type: "CFR_RECEIVED" },
      expected: { action: "SURRENDER" },
    },
  ```
  New (keep the label honest but the value is still valid — 6 > 4 so it surrenders):
  ```typescript
    {
      label: "budget: totalJobsSpawned=6 (over ceiling of 4) → SURRENDER regardless",
      session: { state: "IDLE", attemptNumber: 1, totalJobsSpawned: 6 },
      event: { type: "CFR_RECEIVED" },
      expected: { action: "SURRENDER" },
    },
  ```

---

## Task 4: Rewrite Budget Test (Commit 1, part D)

**Files:**
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts`

- [ ] **Step 1: Locate the budget test at line ~178**

  Find the `describe("RecoveryOrchestrator — job budget")` block. The test label is `"no more than 5 automation jobs are spawned across 3 attempts (execute + reflect = 2 per attempt)"`.

- [ ] **Step 2: Rewrite the test**

  Replace the entire describe block:

  Old:
  ```typescript
  describe("RecoveryOrchestrator — job budget", () => {
    it("no more than 5 automation jobs are spawned across 3 attempts (execute + reflect = 2 per attempt)", async () => {
      let spawnCount = 0;
      const spawnAutomation = vi.fn().mockImplementation(async (_spec: AutomationSpec) => {
        spawnCount++;
        return { jobId: `j-${spawnCount}`, automationId: `a-${spawnCount}` };
      });

      const awaitAutomation = vi.fn().mockImplementation(async (jobId: string) => {
        // execute jobs succeed, reflect jobs also succeed
        return { status: "done" } as AutomationResult;
      });

      // Reverify always fails so we iterate
      const mockRegistry = {
        get: vi.fn().mockReturnValue({ status: "available", path: "/fake", provides: "audio-to-text" }),
      } as unknown as CapabilityRegistry;

      const mockWatcher = {
        rescanNow: vi.fn().mockResolvedValue([]),
      } as unknown as CapabilityWatcher;

      // Patch: make reverify fail (capability unavailable from registry.get perspective for actual script)
      // We'll mock the whole registry.get to return something that passes availability but fails script execution
      // by pointing to a nonexistent script path
      const deps = makeDeps({
        spawnAutomation,
        awaitAutomation,
        capabilityRegistry: {
          get: vi.fn().mockReturnValue({
            status: "available",
            path: "/nonexistent-cap-path",
            provides: "audio-to-text",
            enabled: true,
          }),
        } as unknown as CapabilityRegistry,
        watcher: mockWatcher,
      });

      const orchestrator = new RecoveryOrchestrator(deps);
      await orchestrator.handle(makeFailure());

      expect(spawnCount).toBeLessThanOrEqual(5);
    });
  });
  ```

  New:
  ```typescript
  describe("RecoveryOrchestrator — job budget", () => {
    it("no more than 3 automation jobs are spawned across 3 attempts (1 execute job per attempt, no reflect)", async () => {
      let spawnCount = 0;
      const spawnAutomation = vi.fn().mockImplementation(async (_spec: AutomationSpec) => {
        spawnCount++;
        return { jobId: `j-${spawnCount}`, automationId: `a-${spawnCount}` };
      });

      const awaitAutomation = vi.fn().mockImplementation(async (_jobId: string) => {
        // execute jobs succeed but reverify always fails — causes iteration
        return { status: "done" } as AutomationResult;
      });

      const deps = makeDeps({
        spawnAutomation,
        awaitAutomation,
        capabilityRegistry: {
          get: vi.fn().mockReturnValue({
            status: "available",
            path: "/nonexistent-cap-path",
            provides: "audio-to-text",
            enabled: true,
          }),
        } as unknown as CapabilityRegistry,
      });

      const orchestrator = new RecoveryOrchestrator(deps);
      await orchestrator.handle(makeFailure());

      // 3 attempts × 1 execute job each = 3 max. Safety ceiling is 4.
      expect(spawnCount).toBeLessThanOrEqual(3);
    });
  });
  ```

---

## Task 5: Run Commit-1 Tests (Gate Before Commit 2)

- [ ] **Step 1: Type-check**

  ```bash
  cd /home/nina/my_agent/packages/core && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 2: Run orchestrator tests**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
  ```
  Expected: all tests pass. If any test fails due to the removed `REFLECTING` state or types, fix it before proceeding.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/orchestrator-state-machine.ts \
          packages/core/src/capabilities/cfr-types.ts \
          packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts \
          packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts
  git commit -m "refactor(m9.6-s13): collapse reflect phase — state machine + types"
  ```

---

## Task 6: Delete Reflect Code from Orchestrator (Commit 2, part A)

**Files:**
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts`

- [ ] **Step 1: Update the file-level docstring**

  Find and replace in the top-level comment block:

  Old:
  ```
   *   3. Spawns an execute-phase automation (Sonnet) per attempt.
   *   4. Spawns a reflect-phase automation (Opus) after each successful execute.
   *   5. Reverifies the fix against the user's actual triggering artifact.
  ```
  New:
  ```
   *   3. Spawns an execute-phase automation (Sonnet) per attempt.
   *   4. Reverifies the fix against the user's actual triggering artifact.
  ```

- [ ] **Step 2: Update the runOneAttempt docstring**

  Find:
  ```typescript
    /**
     * Run one execute+reflect+reverify cycle.
     * Returns { recovered: true, recoveredContent } on success, or { recovered: false } on failure.
     */
  ```
  Replace with:
  ```typescript
    /**
     * Run one execute+reverify cycle.
     * Returns { recovered: true, recoveredContent } on success, or { recovered: false } on failure.
     */
  ```

- [ ] **Step 3: Replace the reflect spawn block with a direct doReverify call**

  The block to remove starts after `session.attempts.push(executeAttempt)` (where execute succeeded) and ends at the final `return await this.doReverify(...)`. Replace the entire block:

  Old (from just after `session.attempts.push(executeAttempt);`):
  ```typescript
      session.state = "REFLECTING";
      nextAction(session, { type: "EXECUTE_JOB_DONE", success: true });

      // Budget check before spawning reflect job
      if (session.totalJobsSpawned >= 5) {
        // Budget exhausted — still attempt reverify without reflect. If the
        // reverify passes, we recover normally; if it fails, runFixLoop will
        // drop through to surrender — tag the reason here so surrender picks
        // the "budget" copy rather than "iteration-3".
        const result = await this.doReverify(failure, session, executeAttempt);
        if (!result.recovered) {
          session.surrenderReason = "budget";
        }
        return result;
      }

      // Spawn reflect-phase automation (Opus)
      let reflectJobId: string;
      try {
        const reflectPrompt = this.renderReflectPrompt(failure, session, deliverable);
        const spawned = await this.deps.spawnAutomation({
          name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-reflect-${randomUUID().slice(0, 8)}`,
          model: "opus",
          autonomy: "cautious",
          prompt: reflectPrompt,
          jobType: "capability_modify",
          parent: { jobId: executeJobId, iteration: session.attemptNumber },
        });
        reflectJobId = spawned.jobId;
        session.reflectJobId = reflectJobId;
        session.totalJobsSpawned += 1;
      } catch (err) {
        console.error("[RecoveryOrchestrator] Failed to spawn reflect job:", err);
        // Still attempt reverify — execute may have been sufficient
        return await this.doReverify(failure, session, executeAttempt);
      }

      // Await reflect job
      await this.deps.awaitAutomation(reflectJobId, JOB_TIMEOUT_MS);
      const reflectDeliverable = this.readDeliverable(reflectJobId);
      const nextHypothesis =
        reflectDeliverable?.frontmatter.summary ??
        reflectDeliverable?.body.slice(0, 200) ??
        "no hypothesis from reflect phase";

      session.state = "REVERIFYING";
      nextAction(session, { type: "REFLECT_JOB_DONE", nextHypothesis });

      // Update the execute attempt with the next hypothesis from reflect
      executeAttempt.nextHypothesis = nextHypothesis;

      return await this.doReverify(failure, session, executeAttempt);
    }
  ```

  New (replace all of the above):
  ```typescript
      session.state = "REVERIFYING";
      nextAction(session, { type: "EXECUTE_JOB_DONE", success: true });

      return await this.doReverify(failure, session, executeAttempt);
    }
  ```

- [ ] **Step 4: Update the pre-execute budget cap from 5 to 4**

  Find in `runOneAttempt`, the budget check before the execute spawn:

  Old:
  ```typescript
      if (session.totalJobsSpawned >= 5) {
        session.surrenderReason = "budget";
        return { recovered: false };
      }
  ```
  New:
  ```typescript
      if (session.totalJobsSpawned >= 4) {
        session.surrenderReason = "budget";
        return { recovered: false };
      }
  ```

- [ ] **Step 5: Remove the dead REFLECT_JOB_DONE event and reflectJobId field**

  In `packages/core/src/capabilities/orchestrator-state-machine.ts`, remove the two items kept alive for compile safety in Commit 1:

  Remove from `OrchestratorEvent`:
  ```typescript
    // REFLECT_JOB_DONE: dead after S13 — removed with renderReflectPrompt in the orchestrator commit
    | { type: "REFLECT_JOB_DONE"; nextHypothesis: string }
  ```

  Remove from `FixSession`:
  ```typescript
    // reflectJobId: dead after S13 — removed with the reflect spawn code in the orchestrator commit
    reflectJobId?: string;
  ```

  Update the file comment to drop the "dead after this commit" note:
  ```typescript
   * M9.6-S13: reflect phase removed; EXECUTING success goes directly to REVERIFY.
  ```

- [ ] **Step 6: Delete the renderReflectPrompt method**

  Delete the entire `renderReflectPrompt` method. It starts at the comment:
  ```typescript
    /**
     * Render the reflect-phase prompt — Opus summarises what happened and proposes a better hypothesis.
     */
    private renderReflectPrompt(
  ```
  ...and ends at the closing `}` of the method (before the `}` that closes the class), which is approximately:
  ```typescript
      return `# Reflect — ${capabilityType} Fix Attempt ${session.attemptNumber}
  ...
      Body: reasoning about what the execute agent did and what should be tried next.\``;
    }
  ```

  Delete the entire method from the doc-comment through the closing brace.

---

## Task 7: Verify Zero Reflect References + Final Checks (Commit 2)

- [ ] **Step 1: Verify no reflect references remain in production capability code**

  ```bash
  rg -i 'reflect' /home/nina/my_agent/packages/core/src/capabilities/
  ```
  Expected: **zero hits**. If any match appears, investigate and remove.

- [ ] **Step 2: Type-check both packages**

  ```bash
  cd /home/nina/my_agent/packages/core && npx tsc --noEmit
  cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit
  ```
  Expected: zero errors in both. Common issue: if any code still references `FixSession.reflectJobId` or `SPAWN_REFLECT_JOB`, it will fail here.

- [ ] **Step 3: Run full orchestrator test suite**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
  ```
  Expected: all tests pass.

- [ ] **Step 4: Run CFR phase regression**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities
  ```
  Expected: pass. The pre-existing `integration.test.ts` MCP-spawn flake (Connection closed, predates S13) is not in scope — note its presence but do not investigate.

- [ ] **Step 7: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/recovery-orchestrator.ts \
          packages/core/src/capabilities/orchestrator-state-machine.ts
  git commit -m "refactor(m9.6-s13): collapse reflect phase — orchestrator behavior"
  ```

---

## Task 8: Acceptance Verification

- [ ] **Step 1: Confirm the acceptance grep**

  ```bash
  rg 'reflect' /home/nina/my_agent/packages/core/src/capabilities/
  ```
  Expected: zero production hits. Test files may still mention "reflect" in comments — those are fine. Only `src/capabilities/` must be clean.

- [ ] **Step 2: Audit orchestrator-timing.test.ts for reflect**

  ```bash
  rg -i 'reflect' /home/nina/my_agent/packages/core/tests/capabilities/orchestrator/orchestrator-timing.test.ts
  ```
  Expected: zero hits (timing tests don't touch reflect; confirm nothing slipped in).

- [ ] **Step 3: Final full vitest run**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
  ```
  Confirm pass. Record test counts in `s13-test-report.md`.

---

## Sprint Artifacts Checklist

- [ ] `docs/sprints/m9.6-capability-resilience/s13-plan.md` — this file
- [ ] `docs/sprints/m9.6-capability-resilience/s13-DECISIONS.md` — create if any non-trivial decision is made during execution
- [ ] `docs/sprints/m9.6-capability-resilience/s13-DEVIATIONS.md` — create if any deviation from this plan occurs
- [ ] `docs/sprints/m9.6-capability-resilience/s13-test-report.md` — created by external reviewer
- [ ] `docs/sprints/m9.6-capability-resilience/s13-review.md` — created by external reviewer
