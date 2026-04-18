# M9.6-S14 — Friendly Names + Multi-Instance + Per-Type Fallback Copy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every user-facing CFR ack message to use proper friendly names, append instance names for multi-instance plugs (e.g. "browser (chrome)"), and source per-type fallback actions from capability frontmatter via a registry-injected factory.

**Architecture:** Factory pattern — `createResilienceCopy(registry)` returns a `ResilienceCopy` object. Follows the established S10/S12 DI pattern (CapabilityInvoker, createMcpCapabilityCfrDetector). Wired at boot alongside `capabilityInvoker`. The existing `defaultCopy` object is deleted; its test is migrated to the factory with a stub registry. Two new registry methods (`isMultiInstance`, `getFallbackAction`) source data from `fallback_action` / `multi_instance` frontmatter fields added to the scanner in Task 1.

**Tech Stack:** TypeScript, Vitest, Node.js. No new dependencies.

**Design refs:** `plan-phase2-coverage.md §2.6`, `capability-resilience-v2.md §2 principle 5 + §3.4`, `s10-FOLLOW-UPS.md FU-4`.

**Dependencies:** S13 APPROVED (RESTORED_TERMINAL + terminal-fixed AckKind already wired).

---

## 0. Pre-flight — read these before starting

- `packages/core/src/capabilities/resilience-messages.ts` — current state (no registry dep, `defaultCopy` plain object)
- `packages/core/src/capabilities/types.ts` — `Capability` + `CapabilityFrontmatter` shapes
- `packages/core/src/capabilities/scanner.ts` — where to add frontmatter reads (~line 159)
- `packages/core/src/capabilities/registry.ts` — where to add `isMultiInstance` + `getFallbackAction`
- `packages/core/src/capabilities/invoker.ts` — cap-selection block (~line 73-86)
- `packages/dashboard/src/app.ts` lines 455-565 — capability boot block; lines 724-733 — emitAck switch
- `packages/core/tests/capabilities/resilience-copy.test.ts` — test to migrate
- `plan-phase2-coverage.md §0` — implementing-agent rules (Stop-On-Deviation, Deviation Proposal Protocol)

**Stop-on-deviation rule:** if any implementation step requires touching a file not listed here, STOP and write a deviation proposal to `proposals/s14-<slug>.md` before proceeding.

---

## File map

| File | Action | What changes |
|---|---|---|
| `packages/core/src/capabilities/types.ts` | Modify | Add `fallback_action?` + `multi_instance?` to `CapabilityFrontmatter`; add `fallbackAction?` + `multiInstance?` to `Capability` |
| `packages/core/src/capabilities/scanner.ts` | Modify | Read and populate the two new fields at scan time |
| `packages/core/src/capabilities/registry.ts` | Modify | Add `isMultiInstance()` + `getFallbackAction()` methods |
| `packages/core/src/capabilities/resilience-messages.ts` | Modify | Add factory, terminal ack, multi-instance suffix, updated surrender; delete `defaultCopy` |
| `packages/core/src/capabilities/index.ts` | Modify | Replace `defaultCopy` export with `createResilienceCopy` |
| `packages/core/src/lib.ts` | Modify | Replace `defaultCopy` export with `createResilienceCopy` |
| `packages/core/src/capabilities/invoker.ts` | Modify | Add `capabilityName?` to `InvokeOptions`; filter by name when set |
| `packages/dashboard/src/app.ts` | Modify | Add `resilienceCopy` field; import `createResilienceCopy`; wire at boot; update `emitAck` switch |
| `packages/core/tests/capabilities/resilience-copy.test.ts` | Modify | Migrate from `defaultCopy` to `createResilienceCopy(stubRegistry)` |
| `packages/core/tests/capabilities/registry-multi-instance.test.ts` | Create | Unit tests for `isMultiInstance` + `getFallbackAction` |
| `packages/core/tests/capabilities/resilience-messages-coverage.test.ts` | Create | Universal-coverage gate — every registered type has friendly name + fallback action |
| `packages/core/tests/capabilities/resilience-messages-multi-instance.test.ts` | Create | Multi-instance ack includes instance name; single-instance does not |
| `packages/core/tests/capabilities/resilience-messages-terminal.test.ts` | Create | Every type has terminal-recovery copy |
| `packages/core/tests/capabilities/invoker.test.ts` | Modify | Add named-instance test (FU-4) |
| `docs/sprints/m9.6-capability-resilience/s14-DECISIONS.md` | Create | Decision log |
| `docs/sprints/m9.6-capability-resilience/s14-DEVIATIONS.md` | Create | Deviation stub |
| `docs/sprints/m9.6-capability-resilience/s14-FOLLOW-UPS.md` | Create | FRIENDLY_NAMES migration + multiInstance backfill |
| `docs/sprints/m9.6-capability-resilience/s14-test-report.md` | Create | Verification output |

---

## Task 1 — Extend types + scanner

**Files:** `packages/core/src/capabilities/types.ts`, `packages/core/src/capabilities/scanner.ts`

- [ ] **Step 1: Add fields to `CapabilityFrontmatter`**

In `types.ts`, find `CapabilityFrontmatter` (line ~53) and add two optional fields after `requires?`:

```typescript
export interface CapabilityFrontmatter {
  name: string
  provides?: string
  interface: 'script' | 'mcp'
  entrypoint?: string
  icon?: string
  requires?: {
    env?: string[]
    system?: string[]
  }
  fallback_action?: string  // e.g. "could you resend as text"
  multi_instance?: boolean  // true → instance name appended in ack copy
}
```

- [ ] **Step 2: Add fields to `Capability` interface**

In `types.ts`, find the `Capability` interface (line ~6) and add two optional fields after `iconSlug?`:

```typescript
export interface Capability {
  name: string
  provides?: string
  interface: 'script' | 'mcp'
  path: string
  status: 'available' | 'unavailable' | 'invalid'
  unavailableReason?: string
  error?: string
  health: 'healthy' | 'degraded' | 'untested'
  degradedReason?: string
  lastTestLatencyMs?: number
  mcpConfig?: CapabilityMcpConfig
  enabled: boolean
  entrypoint?: string
  canDelete: boolean
  iconSlug?: string
  fallbackAction?: string   // sourced from fallback_action frontmatter (S14)
  multiInstance?: boolean   // sourced from multi_instance frontmatter (S14)
}
```

- [ ] **Step 3: Populate in scanner**

In `scanner.ts`, find the capability object construction block (around line 150 — the `const capability: Capability = {` line). Add the two new fields after `iconSlug: data.icon`:

```typescript
const capability: Capability = {
  name: data.name,
  provides: data.provides,
  interface: data.interface,
  path: capDir,
  status: allMissing.length === 0 ? 'available' : 'unavailable',
  health: 'untested',
  enabled,
  canDelete: data.provides ? WELL_KNOWN_MULTI_INSTANCE.has(data.provides) : false,
  iconSlug: data.icon,
  fallbackAction: data.fallback_action,    // new (S14)
  multiInstance: data.multi_instance,      // new (S14)
}
```

- [ ] **Step 4: Type-check**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: exit 0, zero errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/capabilities/types.ts packages/core/src/capabilities/scanner.ts
git commit -m "feat(m9.6-s14): add fallback_action + multi_instance to Capability type + scanner"
```

---

## Task 2 — Registry helpers: `isMultiInstance` + `getFallbackAction`

**Files:** `packages/core/src/capabilities/registry.ts`, `packages/core/tests/capabilities/registry-multi-instance.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/capabilities/registry-multi-instance.test.ts`:

```typescript
/**
 * S14 acceptance test — CapabilityRegistry.isMultiInstance + getFallbackAction.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";

function makeCapability(overrides: Partial<Capability>): Capability {
  return {
    name: overrides.name ?? "test-cap",
    provides: overrides.provides ?? "audio-to-text",
    interface: "script",
    path: "/tmp/test",
    status: "available",
    health: "untested",
    enabled: true,
    canDelete: false,
    ...overrides,
  };
}

describe("CapabilityRegistry.isMultiInstance", () => {
  it("returns true for browser-control (WELL_KNOWN_MULTI_INSTANCE fallback)", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability({ name: "browser-chrome", provides: "browser-control" })]);
    expect(registry.isMultiInstance("browser-control")).toBe(true);
  });

  it("returns true when multi_instance frontmatter is true", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability({ name: "my-browser", provides: "browser-control", multiInstance: true })]);
    expect(registry.isMultiInstance("browser-control")).toBe(true);
  });

  it("returns false for audio-to-text (not in WELL_KNOWN_MULTI_INSTANCE, no frontmatter)", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability({ name: "stt-deepgram", provides: "audio-to-text" })]);
    expect(registry.isMultiInstance("audio-to-text")).toBe(false);
  });

  it("returns false for unknown type with no capabilities registered", () => {
    const registry = new CapabilityRegistry();
    registry.load([]);
    expect(registry.isMultiInstance("nonexistent-type")).toBe(false);
  });
});

describe("CapabilityRegistry.getFallbackAction", () => {
  it("returns fallbackAction from capability frontmatter when set", () => {
    const registry = new CapabilityRegistry();
    registry.load([
      makeCapability({
        name: "stt-deepgram",
        provides: "audio-to-text",
        fallbackAction: "could you resend as text",
      }),
    ]);
    expect(registry.getFallbackAction("audio-to-text")).toBe("could you resend as text");
  });

  it("returns default fallback when no capability has fallbackAction", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability({ name: "stt-deepgram", provides: "audio-to-text" })]);
    expect(registry.getFallbackAction("audio-to-text")).toBe("try again in a moment");
  });

  it("returns default fallback for unknown type", () => {
    const registry = new CapabilityRegistry();
    registry.load([]);
    expect(registry.getFallbackAction("nonexistent-type")).toBe("try again in a moment");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core && npx vitest run tests/capabilities/registry-multi-instance
```

Expected: FAIL — `isMultiInstance is not a function` / `getFallbackAction is not a function`.

- [ ] **Step 3: Add methods to `CapabilityRegistry`**

In `packages/core/src/capabilities/registry.ts`, add these two methods after `findByName` (around line 212). Also add the import for `WELL_KNOWN_MULTI_INSTANCE` — verify it's already imported at the top (it should be, as `canDelete` uses it).

```typescript
/**
 * Whether a capability type supports multiple simultaneous instances.
 * Sources from `multi_instance: true` in CAPABILITY.md frontmatter (S14).
 * Falls back to the compile-time WELL_KNOWN_MULTI_INSTANCE set for
 * capabilities loaded before the S14 scanner changes take effect.
 */
isMultiInstance(type: string): boolean {
  for (const cap of this.capabilities.values()) {
    if (cap.provides === type) {
      return cap.multiInstance ?? WELL_KNOWN_MULTI_INSTANCE.has(type)
    }
  }
  return WELL_KNOWN_MULTI_INSTANCE.has(type)
}

/**
 * Per-type user-facing fallback action (e.g. "could you resend as text").
 * Sources from `fallback_action:` in CAPABILITY.md frontmatter (S14).
 * Returns a safe generic default when the type is not registered or the
 * frontmatter field was not set.
 *
 * Semantic (G2): first-wins across all instances of the type.
 * `fallback_action` is a TYPE-LEVEL property — all instances of the same
 * type should declare the same value (e.g. all browser-control instances
 * say "try again in a moment"). Document any mismatch in DECISIONS.md.
 * Plug-level frontmatter may override template-level (D7 in DECISIONS).
 */
getFallbackAction(type: string): string {
  for (const cap of this.capabilities.values()) {
    if (cap.provides === type && cap.fallbackAction) return cap.fallbackAction
  }
  return "try again in a moment"
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/core && npx vitest run tests/capabilities/registry-multi-instance
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Type-check**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/capabilities/registry.ts packages/core/tests/capabilities/registry-multi-instance.test.ts
git commit -m "feat(m9.6-s14): add isMultiInstance + getFallbackAction to CapabilityRegistry"
```

---

## Task 3 — Refactor `resilience-messages.ts` + migrate existing test

**Files:** `packages/core/src/capabilities/resilience-messages.ts`, `packages/core/tests/capabilities/resilience-copy.test.ts`

- [ ] **Step 1: Rewrite `resilience-messages.ts`**

Replace the entire file content:

```typescript
/**
 * resilience-messages.ts — User-facing copy for CFR ack/status/surrender/terminal turns.
 *
 * Factory pattern (S14): createResilienceCopy(registry) returns a ResilienceCopy
 * object with registry-aware copy. Follows the same DI pattern as CapabilityInvoker
 * (S10) and createMcpCapabilityCfrDetector (S12).
 *
 * FRIENDLY_NAMES is still a hardcoded table (S14 decision — see s14-DECISIONS.md).
 * Migration to frontmatter is tracked in s14-FOLLOW-UPS.md for Phase 3.
 */

import type { CapabilityFailure } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";

export type SurrenderReason = "budget" | "iteration-3" | "surrender-cooldown";

export interface ResilienceCopy {
  ack(failure: CapabilityFailure): string;
  status(failure: CapabilityFailure): string;
  surrender(failure: CapabilityFailure, reason: SurrenderReason): string;
  terminalAck(failure: CapabilityFailure): string;
}

const FRIENDLY_NAMES: Record<string, string> = {
  "audio-to-text": "voice transcription",
  "image-to-text": "image understanding",
  "text-to-audio": "voice reply",
  "text-to-image": "image generation",
  "browser-control": "browser",
  "desktop-control": "desktop control",
};

function friendlyName(capabilityType: string): string {
  return FRIENDLY_NAMES[capabilityType] ?? capabilityType;
}

function instanceSuffix(failure: CapabilityFailure, registry: CapabilityRegistry): string {
  if (failure.capabilityName && registry.isMultiInstance(failure.capabilityType)) {
    return ` (${failure.capabilityName})`;
  }
  return "";
}

/**
 * Create a ResilienceCopy implementation backed by the given registry.
 * Wire at boot: app.resilienceCopy = createResilienceCopy(registry).
 */
export function createResilienceCopy(registry: CapabilityRegistry): ResilienceCopy {
  return {
    ack(failure: CapabilityFailure): string {
      const { capabilityType, symptom } = failure;
      const name = friendlyName(capabilityType);
      const suffix = instanceSuffix(failure, registry);

      if (capabilityType === "audio-to-text" && symptom === "execution-error") {
        return `${name}${suffix} just hit an error — let me fix that.`;
      }
      return `hold on — ${name}${suffix} isn't working right, fixing now.`;
    },

    status(_failure: CapabilityFailure): string {
      return "still fixing — second attempt.";
    },

    surrender(failure: CapabilityFailure, reason: SurrenderReason): string {
      const name = friendlyName(failure.capabilityType);
      const suffix = instanceSuffix(failure, registry);
      const fallback = registry.getFallbackAction(failure.capabilityType);

      if (reason === "budget") {
        return `I've hit the fix budget for this turn. ${fallback} while I look into it? I've logged the issue.`;
      }
      if (reason === "surrender-cooldown") {
        return `I already tried fixing ${name}${suffix} recently — ${fallback} for now. I've logged it.`;
      }
      // iteration-3
      return `I tried three fixes and ${name}${suffix} isn't working today. ${fallback}? I've logged the issue.`;
    },

    terminalAck(failure: CapabilityFailure): string {
      const { capabilityType } = failure;
      const name = friendlyName(capabilityType);
      const suffix = instanceSuffix(failure, registry);

      switch (capabilityType) {
        case "audio-to-text":
          return "voice transcription is back — what's next?";
        case "text-to-audio":
          return "voice reply is back — this message went out as text, but it'll be working next time.";
        case "text-to-image":
          return "image generation is back — I'll include images next time.";
        default:
          return `${name}${suffix} is back — try again whenever you'd like.`;
      }
    },
  };
}
```

- [ ] **Step 2: Update `index.ts` exports**

In `packages/core/src/capabilities/index.ts` (around line 77-81), replace the `defaultCopy` export with `createResilienceCopy`:

Old:
```typescript
export {
  defaultCopy,
  type ResilienceCopy,
  type SurrenderReason,
} from './resilience-messages.js'
```

New:
```typescript
export {
  createResilienceCopy,
  type ResilienceCopy,
  type SurrenderReason,
} from './resilience-messages.js'
```

- [ ] **Step 3: Update `lib.ts` exports**

In `packages/core/src/lib.ts` (around line 286), replace the `defaultCopy` export:

Old:
```typescript
export { defaultCopy, AckDelivery } from './capabilities/index.js'
```

New:
```typescript
export { createResilienceCopy, AckDelivery } from './capabilities/index.js'
```

- [ ] **Step 4: Migrate `resilience-copy.test.ts`**

Replace the entire test file content. The stub registry provides the same fallback action that the old hardcoded strings used, so all expected strings remain identical:

```typescript
/**
 * Tests for the user-facing copy strings in resilience-messages.ts.
 *
 * Migrated from defaultCopy (S6) to createResilienceCopy(stubRegistry) in S14.
 * The stub registry returns "could you resend as text" as the fallback action
 * for audio-to-text — matching the value in the installed plug's frontmatter.
 */

import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

function makeStubRegistry(
  fallbackAction = "could you resend as text",
  multiInstanceTypes: string[] = [],
): CapabilityRegistry {
  return {
    isMultiInstance: (type: string) => multiInstanceTypes.includes(type),
    getFallbackAction: (_type: string) => fallbackAction,
  } as unknown as CapabilityRegistry;
}

const copy = createResilienceCopy(makeStubRegistry());

function failure(
  capabilityType: string,
  symptom: CapabilityFailure["symptom"],
  capabilityName?: string,
): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    capabilityName,
    symptom,
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

describe("createResilienceCopy — ack", () => {
  it("audio-to-text + deps-missing → voice-transcription copy", () => {
    expect(copy.ack(failure("audio-to-text", "deps-missing"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + not-enabled → voice-transcription copy", () => {
    expect(copy.ack(failure("audio-to-text", "not-enabled"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + not-installed → voice-transcription copy", () => {
    expect(copy.ack(failure("audio-to-text", "not-installed"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + execution-error → execution-error copy", () => {
    expect(copy.ack(failure("audio-to-text", "execution-error"))).toBe(
      "voice transcription just hit an error — let me fix that.",
    );
  });

  it("image-to-text → substituted friendly-name copy", () => {
    expect(copy.ack(failure("image-to-text", "deps-missing"))).toBe(
      "hold on — image understanding isn't working right, fixing now.",
    );
  });

  it("unknown capability type → raw type in fallback template", () => {
    expect(copy.ack(failure("weird-thing", "execution-error"))).toBe(
      "hold on — weird-thing isn't working right, fixing now.",
    );
  });
});

describe("createResilienceCopy — status", () => {
  it("returns the status copy", () => {
    expect(copy.status(failure("audio-to-text", "execution-error"))).toBe(
      "still fixing — second attempt.",
    );
    expect(copy.status(failure("image-to-text", "execution-error"))).toBe(
      "still fixing — second attempt.",
    );
  });
});

describe("createResilienceCopy — surrender", () => {
  it("iteration-3 reason → three-fixes copy with friendly name + fallback", () => {
    expect(copy.surrender(failure("audio-to-text", "execution-error"), "iteration-3")).toBe(
      "I tried three fixes and voice transcription isn't working today. could you resend as text? I've logged the issue.",
    );
  });

  it("budget reason → budget copy with fallback", () => {
    expect(copy.surrender(failure("audio-to-text", "execution-error"), "budget")).toBe(
      "I've hit the fix budget for this turn. could you resend as text while I look into it? I've logged the issue.",
    );
  });

  it("surrender-cooldown reason → cooldown copy", () => {
    expect(copy.surrender(failure("audio-to-text", "execution-error"), "surrender-cooldown")).toBe(
      "I already tried fixing voice transcription recently — could you resend as text for now. I've logged it.",
    );
  });
});
```

- [ ] **Step 5: Run migrated test**

```bash
cd packages/core && npx vitest run tests/capabilities/resilience-copy
```

Expected: all tests PASS (strings are identical to old defaultCopy strings for the first two surrender cases; new surrender-cooldown case added).

- [ ] **Step 6: Type-check both packages**

```bash
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
```

Expected: exit 0 for both. Dashboard will fail if it still imports `defaultCopy` — that's Task 5's job. If the failure is ONLY in `app.ts` on `defaultCopy`, that's expected at this point; fix it in Task 5.

- [ ] **Step 7: Commit**

```bash
git add \
  packages/core/src/capabilities/resilience-messages.ts \
  packages/core/src/capabilities/index.ts \
  packages/core/src/lib.ts \
  packages/core/tests/capabilities/resilience-copy.test.ts
git commit -m "feat(m9.6-s14): createResilienceCopy factory + terminalAck + multi-instance suffix; delete defaultCopy"
```

---

## Task 4 — Invoker named-instance selection (FU-4 from S10)

**Files:** `packages/core/src/capabilities/invoker.ts`, `packages/core/tests/capabilities/invoker.test.ts`

- [ ] **Step 1: Add the failing test**

Open `packages/core/tests/capabilities/invoker.test.ts`. At the end of the file (after the existing describe blocks), add a new describe block. You'll need a real script file since the invoker calls `execFile` directly — create a temporary one in the test:

```typescript
describe("named-instance selection (FU-4)", () => {
  it("selects the named instance when capabilityName is set", async () => {
    const dir = join(tmpdir(), `invoker-named-${randomUUID()}`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "scripts"), { recursive: true });

    // Two different browser-control instances — each script echoes its own name
    const chromeDir = join(dir, "chrome");
    const firefoxDir = join(dir, "firefox");
    mkdirSync(join(chromeDir, "scripts"), { recursive: true });
    mkdirSync(join(firefoxDir, "scripts"), { recursive: true });

    const chromeScript = join(chromeDir, "scripts", "run.sh");
    const firefoxScript = join(firefoxDir, "scripts", "run.sh");
    writeFileSync(chromeScript, "#!/bin/sh\necho chrome\n");
    writeFileSync(firefoxScript, "#!/bin/sh\necho firefox\n");
    chmodSync(chromeScript, 0o755);
    chmodSync(firefoxScript, 0o755);

    const chromeCap: Capability = {
      name: "browser-chrome",
      provides: "browser-control",
      interface: "script",
      path: chromeDir,
      status: "available",
      enabled: true,
      health: "healthy",
      canDelete: true,
    };
    const firefoxCap: Capability = {
      name: "browser-firefox",
      provides: "browser-control",
      interface: "script",
      path: firefoxDir,
      status: "available",
      enabled: true,
      health: "healthy",
      canDelete: true,
    };

    const { cfr } = makeCfr();
    const registry = {
      listByProvides: vi.fn((_type: string) => [chromeCap, firefoxCap]),
    } as unknown as CapabilityRegistry;

    const invoker = new CapabilityInvoker({
      cfr,
      registry,
      originFactory: () => makeTriggeringInput().origin,
    });

    const result = await invoker.run({
      capabilityType: "browser-control",
      capabilityName: "browser-firefox",
      scriptName: "run.sh",
      args: [],
      triggeringInput: makeTriggeringInput(),
    });

    expect(result.kind).toBe("success");
    expect((result as { kind: "success"; stdout: string }).stdout.trim()).toBe("firefox");
  });

  it("emits not-installed when the named instance does not exist", async () => {
    const { cfr, emitted } = makeCfr();
    const registry = {
      listByProvides: vi.fn(() => [
        { name: "browser-chrome", provides: "browser-control", interface: "script",
          path: "/tmp", status: "available", enabled: true, health: "healthy", canDelete: true },
      ]),
    } as unknown as CapabilityRegistry;

    const invoker = new CapabilityInvoker({
      cfr,
      registry,
      originFactory: () => makeTriggeringInput().origin,
    });

    const result = await invoker.run({
      capabilityType: "browser-control",
      capabilityName: "browser-nonexistent",
      scriptName: "run.sh",
      args: [],
      triggeringInput: makeTriggeringInput(),
    });

    expect(result.kind).toBe("failure");
    expect((result as { kind: "failure"; symptom: string }).symptom).toBe("not-installed");
    expect(emitted[0]?.symptom).toBe("not-installed");
  });
});
```

- [ ] **Step 2: Run to verify failures**

```bash
cd packages/core && npx vitest run tests/capabilities/invoker --reporter=verbose 2>&1 | tail -20
```

Expected: the two new tests FAIL (TypeScript won't compile — `capabilityName` not in `InvokeOptions` yet).

- [ ] **Step 3: Add `capabilityName` to `InvokeOptions` and filter logic**

In `packages/core/src/capabilities/invoker.ts`:

**a)** Add to `InvokeOptions` interface:
```typescript
export interface InvokeOptions {
  capabilityType: string;
  scriptName: string;
  args: string[];
  triggeringInput: TriggeringInput;
  timeoutMs?: number;
  expectJson?: boolean;
  capabilityName?: string;  // when set, select only the instance with this name (S14 FU-4)
}
```

**b)** In the `run` method, replace the existing cap-selection block (current lines ~73-86):

```typescript
// Registry lookup + granular status checks
const allCaps = registry.listByProvides(capabilityType);
const candidates = opts.capabilityName
  ? allCaps.filter(c => c.name === opts.capabilityName)
  : allCaps;

if (candidates.length === 0) {
  const detail = opts.capabilityName
    ? `No ${capabilityType} capability named '${opts.capabilityName}' installed`
    : `No ${capabilityType} capability installed`;
  return emit("not-installed", detail);
}
// Prefer the first enabled+available instance; fall back to first-by-insertion
// so the granular checks below emit the correct symptom.
const cap = candidates.find(c => c.enabled && c.status === "available") ?? candidates[0];
if (!cap.enabled) {
  return emit("not-enabled", `${cap.name} is disabled`, cap.name);
}
if (cap.status !== "available") {
  const reason = cap.unavailableReason ? `: ${cap.unavailableReason}` : "";
  return emit("execution-error", `${cap.name} is not available (${cap.status}${reason})`, cap.name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/core && npx vitest run tests/capabilities/invoker
```

Expected: all tests PASS including the two new named-instance tests.

- [ ] **Step 5: Type-check**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/capabilities/invoker.ts packages/core/tests/capabilities/invoker.test.ts
git commit -m "feat(m9.6-s14): add capabilityName to InvokeOptions for named-instance selection (FU-4)"
```

---

## Task 5 — Wire `createResilienceCopy` at boot in `app.ts`

**Files:** `packages/dashboard/src/app.ts`

- [ ] **Step 1: Update imports**

In `packages/dashboard/src/app.ts`, in the `@my-agent/core` import block (around line 50-60), replace `defaultCopy` with `createResilienceCopy`:

Old:
```typescript
  defaultCopy,
```

New:
```typescript
  createResilienceCopy,
```

Also add `ResilienceCopy` to the type imports if not already present. Check if `ResilienceCopy` is imported anywhere — if not, add it to the type imports:
```typescript
import type { ResilienceCopy } from "@my-agent/core";
```

- [ ] **Step 2: Add `resilienceCopy` field to App class**

In the App class, find the capability fields section (around line 457-465). Add after `capabilityInvoker`:

```typescript
  // User-facing CFR copy (M9.6-S14)
  resilienceCopy: ResilienceCopy | null = null;
```

- [ ] **Step 3: Wire at boot**

In the capability boot block, after the `capabilityInvoker` assignment (around line 560), add:

```typescript
      // M9.6-S14: registry-aware copy (friendly names + multi-instance + fallback actions)
      app.resilienceCopy = createResilienceCopy(registry);
```

- [ ] **Step 4: Update `emitAck` switch**

Find the `emitAck` callback (around line 718-734). Replace the entire text-selection block:

Old:
```typescript
          let text: string;
          if (kind === "attempt") {
            text = defaultCopy.ack(failure);
          } else if (kind === "status") {
            text = defaultCopy.status(failure);
          } else if (kind === "surrender" || kind === "surrender-cooldown") {
            text = defaultCopy.surrender(failure, "iteration-3");
          } else {
            // "surrender-budget"
            text = defaultCopy.surrender(failure, "budget");
          }
```

New:
```typescript
          if (!app.resilienceCopy) {
            // Should never fire — resilienceCopy is wired at boot before any CFR
            // can arrive. If this warns, it's a boot-order bug.
            console.warn("[CFR] resilienceCopy not set at emitAck time — falling back to inline factory (G4)");
          }
          const copy = app.resilienceCopy ?? createResilienceCopy(registry);
          let text: string;
          if (kind === "attempt") {
            text = copy.ack(failure);
          } else if (kind === "status") {
            text = copy.status(failure);
          } else if (kind === "terminal-fixed") {
            text = copy.terminalAck(failure);
          } else if (kind === "surrender") {
            text = copy.surrender(failure, "iteration-3");
          } else if (kind === "surrender-cooldown") {
            text = copy.surrender(failure, "surrender-cooldown");
          } else {
            // "surrender-budget"
            text = copy.surrender(failure, "budget");
          }
```

Note: the `terminal-fixed` case was previously missing (fell through to `surrender-budget`). This is the fix.

- [ ] **Step 5: Type-check**

```bash
cd packages/dashboard && npx tsc --noEmit
```

Expected: exit 0. If you see `defaultCopy` not found errors, verify the import was fully replaced in Step 1.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(m9.6-s14): wire resilienceCopy at boot; fix terminal-fixed ack path in emitAck switch"
```

---

## Task 6 — Acceptance tests (3 new files)

**Files:** 3 new test files under `packages/core/tests/capabilities/`

### 6a — Universal-coverage gate

**G1 fix:** The test scans `.my_agent/capabilities/` at runtime so it catches new types automatically. A hardcoded array would silently miss a new plug. The test also has a static layer that checks `FRIENDLY_NAMES` for the framework's well-known types.

**Prerequisite:** Export `FRIENDLY_NAMES` from `resilience-messages.ts` so the static layer can inspect it. Add this line after the `FRIENDLY_NAMES` declaration in `resilience-messages.ts`:

```typescript
// Exported for the universal-coverage test (S14). Do not use outside tests.
export { FRIENDLY_NAMES };
```

- [ ] **Step 1: Create `resilience-messages-coverage.test.ts`**

```typescript
/**
 * S14 universal-coverage gate — every installed capability type must have
 * a non-empty friendly name and a non-empty fallback action.
 *
 * Two layers:
 *   1. Static: checks FRIENDLY_NAMES for the framework's well-known types.
 *   2. Dynamic: scans the actual .my_agent/capabilities/ directory and
 *      asserts every installed `provides` type has non-raw ack copy.
 *      Skips gracefully when .my_agent/ is absent (CI environments).
 *
 * Per plan-phase2-coverage.md §0.1 universal-coverage rule.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createResilienceCopy, FRIENDLY_NAMES } from "../../src/capabilities/resilience-messages.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import { scanCapabilities } from "../../src/capabilities/scanner.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root → packages/core/tests/capabilities → ../../../.. → repo root
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CAP_DIR = path.join(REPO_ROOT, ".my_agent", "capabilities");
const ENV_PATH = path.join(REPO_ROOT, "packages", "dashboard", ".env");

function makeFailure(capabilityType: string, capabilityName?: string): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    capabilityName,
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

// ── Layer 1: Static — well-known types in FRIENDLY_NAMES ──────────────────────

const WELL_KNOWN_TYPES = [
  "audio-to-text",
  "text-to-audio",
  "browser-control",
  "desktop-control",
  "text-to-image",
  "image-to-text",
];

describe("static coverage — FRIENDLY_NAMES has entry for every well-known type", () => {
  for (const type of WELL_KNOWN_TYPES) {
    it(`${type}: has a FRIENDLY_NAMES entry`, () => {
      expect(FRIENDLY_NAMES[type]).toBeDefined();
      expect(FRIENDLY_NAMES[type]?.length).toBeGreaterThan(0);
    });
  }
});

// ── Layer 2: Dynamic — scan actual .my_agent/capabilities/ ───────────────────

describe("dynamic coverage — every installed capability type has non-raw copy", () => {
  const hasCapDir = existsSync(CAP_DIR);

  it.skipIf(!hasCapDir)("capabilities directory exists (skipped in CI)", () => {
    expect(hasCapDir).toBe(true);
  });

  if (!hasCapDir) {
    it.skip("skipping dynamic scan — .my_agent/capabilities/ not present", () => {});
    // No further tests to register — avoid async top-level.
    return; // vitest allows early return from describe callback
  }

  // Load the real registry synchronously via a beforeAll pattern using a
  // top-level async describe workaround: register a single async test that
  // performs all assertions so the scan runs once.
  it("every installed provides type has non-raw ack + non-empty fallback", async () => {
    const caps = await scanCapabilities(CAP_DIR, ENV_PATH);
    const registry = new CapabilityRegistry();
    registry.load(caps);
    const copy = createResilienceCopy(registry);

    // Gather unique provides types from installed capabilities
    const installedTypes = [...new Set(
      caps
        .filter(c => c.provides && c.status !== "invalid")
        .map(c => c.provides!)
    )];

    expect(installedTypes.length).toBeGreaterThan(0);

    for (const type of installedTypes) {
      const ackText = copy.ack(makeFailure(type));
      // Raw type string as ack = not registered in FRIENDLY_NAMES and no frontmatter name
      expect(ackText, `${type}: ack must not be the raw type string`).not.toMatch(
        new RegExp(`hold on — ${type} isn't working right`),
      );
      expect(ackText.length, `${type}: ack must be non-empty`).toBeGreaterThan(0);

      const terminalText = copy.terminalAck(makeFailure(type));
      expect(terminalText.length, `${type}: terminalAck must be non-empty`).toBeGreaterThan(0);

      const surrenderText = copy.surrender(makeFailure(type), "iteration-3");
      expect(surrenderText.length, `${type}: surrender must be non-empty`).toBeGreaterThan(0);

      // Warn (not fail) if falling back to generic fallback action — should be in frontmatter
      const fallback = registry.getFallbackAction(type);
      if (fallback === "try again in a moment") {
        console.warn(
          `[S14 coverage] ${type}: getFallbackAction returning generic default — ` +
          `add fallback_action to .my_agent/capabilities/<name>/CAPABILITY.md or the template`,
        );
      }
    }
  });
});
```

- [ ] **Step 2: Run coverage gate**

```bash
cd packages/core && npx vitest run tests/capabilities/resilience-messages-coverage
```

Expected: all tests PASS. The dynamic suite skips when `.my_agent/` is absent. When present, it scans every installed type. Any type using the generic fallback gets a `console.warn` (not a failure).

### 6b — Multi-instance ack disambiguation

- [ ] **Step 3: Create `resilience-messages-multi-instance.test.ts`**

```typescript
/**
 * S14 acceptance test — multi-instance ack includes instance name; single does not.
 */

import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

function makeCapability(name: string, provides: string, multiInstance?: boolean): Capability {
  return {
    name,
    provides,
    interface: "script",
    path: "/tmp/test",
    status: "available",
    health: "untested",
    enabled: true,
    canDelete: false,
    multiInstance,
    fallbackAction: "try again in a moment",
  };
}

function makeFailure(
  capabilityType: string,
  capabilityName?: string,
): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    capabilityName,
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

describe("multi-instance ack disambiguation", () => {
  it("includes instance name in ack for multi-instance type", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability("browser-chrome", "browser-control", true)]);
    const copy = createResilienceCopy(registry);

    const text = copy.ack(makeFailure("browser-control", "browser-chrome"));
    expect(text).toContain("browser (browser-chrome)");
  });

  it("does NOT include instance name for single-instance type", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability("stt-deepgram", "audio-to-text", false)]);
    const copy = createResilienceCopy(registry);

    const text = copy.ack(makeFailure("audio-to-text", "stt-deepgram"));
    expect(text).not.toContain("(stt-deepgram)");
    expect(text).toContain("voice transcription");
  });

  it("does NOT include instance name when capabilityName is absent", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability("browser-chrome", "browser-control", true)]);
    const copy = createResilienceCopy(registry);

    const text = copy.ack(makeFailure("browser-control")); // no capabilityName
    expect(text).not.toContain("(");
  });

  it("terminalAck includes instance name for multi-instance type", () => {
    const registry = new CapabilityRegistry();
    registry.load([makeCapability("browser-chrome", "browser-control", true)]);
    const copy = createResilienceCopy(registry);

    const text = copy.terminalAck(makeFailure("browser-control", "browser-chrome"));
    expect(text).toContain("browser-chrome");
  });
});
```

### 6c — Terminal-recovery ack per type

- [ ] **Step 4: Create `resilience-messages-terminal.test.ts`**

```typescript
/**
 * S14 acceptance test — terminal-recovery ack per capability type.
 */

import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

function makeCapability(name: string, provides: string, multiInstance?: boolean): Capability {
  return {
    name,
    provides,
    interface: "script",
    path: "/tmp/test",
    status: "available",
    health: "untested",
    enabled: true,
    canDelete: false,
    multiInstance,
    fallbackAction: "try again in a moment",
  };
}

function makeFailure(capabilityType: string, capabilityName?: string): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    capabilityName,
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

function makeRegistry(...caps: ReturnType<typeof makeCapability>[]) {
  const registry = new CapabilityRegistry();
  registry.load(caps);
  return registry;
}

describe("terminalAck — per-type copy", () => {
  it("audio-to-text → voice transcription is back copy", () => {
    const copy = createResilienceCopy(makeRegistry(makeCapability("stt-deepgram", "audio-to-text")));
    expect(copy.terminalAck(makeFailure("audio-to-text"))).toBe(
      "voice transcription is back — what's next?",
    );
  });

  it("text-to-audio → voice reply is back copy", () => {
    const copy = createResilienceCopy(makeRegistry(makeCapability("tts-edge", "text-to-audio")));
    expect(copy.terminalAck(makeFailure("text-to-audio"))).toBe(
      "voice reply is back — this message went out as text, but it'll be working next time.",
    );
  });

  it("text-to-image → image generation is back copy", () => {
    const copy = createResilienceCopy(makeRegistry(makeCapability("img-gen", "text-to-image")));
    expect(copy.terminalAck(makeFailure("text-to-image"))).toBe(
      "image generation is back — I'll include images next time.",
    );
  });

  it("browser-control (single) → browser is back copy", () => {
    const copy = createResilienceCopy(makeRegistry(makeCapability("browser-chrome", "browser-control", false)));
    expect(copy.terminalAck(makeFailure("browser-control"))).toBe(
      "browser is back — try again whenever you'd like.",
    );
  });

  it("browser-control (multi-instance) → browser (name) is back copy", () => {
    const copy = createResilienceCopy(makeRegistry(makeCapability("browser-chrome", "browser-control", true)));
    expect(copy.terminalAck(makeFailure("browser-control", "browser-chrome"))).toBe(
      "browser (browser-chrome) is back — try again whenever you'd like.",
    );
  });

  it("desktop-control → desktop control is back copy", () => {
    const copy = createResilienceCopy(makeRegistry(makeCapability("desktop-x11", "desktop-control")));
    expect(copy.terminalAck(makeFailure("desktop-control"))).toBe(
      "desktop control is back — try again whenever you'd like.",
    );
  });

  it("unknown type → raw type in default template", () => {
    const copy = createResilienceCopy(makeRegistry());
    expect(copy.terminalAck(makeFailure("my-custom-plug"))).toBe(
      "my-custom-plug is back — try again whenever you'd like.",
    );
  });
});
```

- [ ] **Step 5: Run all new acceptance tests**

```bash
cd packages/core && npx vitest run \
  tests/capabilities/resilience-messages-coverage \
  tests/capabilities/resilience-messages-multi-instance \
  tests/capabilities/resilience-messages-terminal
```

Expected: all tests PASS.

- [ ] **Step 6: Run full capabilities regression**

```bash
cd packages/core && npx vitest run tests/capabilities
```

Expected: all tests pass. Zero failures.

- [ ] **Step 7: Commit**

```bash
git add \
  packages/core/tests/capabilities/resilience-messages-coverage.test.ts \
  packages/core/tests/capabilities/resilience-messages-multi-instance.test.ts \
  packages/core/tests/capabilities/resilience-messages-terminal.test.ts
git commit -m "test(m9.6-s14): add universal-coverage gate + multi-instance + terminal ack tests"
```

---

## Task 7 — Sprint artifacts

**Files:** DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report

- [ ] **Step 1: Write DECISIONS**

Create `docs/sprints/m9.6-capability-resilience/s14-DECISIONS.md`:

```markdown
---
sprint: m9.6-s14
date: 2026-04-18
---

# M9.6-S14 Decisions

## D1 — Factory pattern: createResilienceCopy(registry)

**Decision:** Export a factory function rather than a singleton or module-level variable.

**Rationale:** Consistent with S10 (CapabilityInvoker), S12 (createMcpCapabilityCfrDetector), and AckDelivery — all use constructor/factory DI. Registry-aware at call time. Tests pass a stub. No singleton state.

**CTO confirmation:** 2026-04-18 — "Option A. Factory matches the established pattern from S10."

## D2 — frontmatter-driven fallback_action (not hardcoded constants)

**Decision:** Add `fallback_action` and `multi_instance` to `CapabilityFrontmatter` and `Capability`. Scanner reads both. Registry exposes `getFallbackAction(type)` and `isMultiInstance(type)`.

**Rationale:** CLAUDE.md core principle "Markdown is source of truth." fallback_action lives in template markdown (S11 landed it). Surfacing via scanner is the principled wiring; a parallel hardcoded table creates two sources that will drift. Custom plugs can also override the default.

**CTO confirmation:** 2026-04-18 — "CLAUDE.md core principle. Extensibility matches the plug/socket framing. Scanner change is trivial."

## D3 — FRIENDLY_NAMES stays hardcoded in S14

**Decision:** `FRIENDLY_NAMES` remains a hardcoded table in `resilience-messages.ts`. Migration to frontmatter is deferred.

**Rationale:** Same principle would apply (markdown is source of truth), but the migration is out of S14 scope. Filed in FOLLOW-UPS as target for Phase 3 (S19 or S20).

## D4 — isMultiInstance falls back to WELL_KNOWN_MULTI_INSTANCE

**Decision:** `isMultiInstance(type)` checks `cap.multiInstance` from frontmatter first, then falls back to `WELL_KNOWN_MULTI_INSTANCE.has(type)` for capabilities loaded without the S14 scanner changes.

**Rationale:** Safety net. `WELL_KNOWN_MULTI_INSTANCE` already exists in types.ts. The fallback costs nothing and prevents silent failures if a capability is loaded from a pre-S14 scan result.

## D7 — plug-level frontmatter may override template-level

**Decision:** A plug's own `CAPABILITY.md` frontmatter fields (`fallback_action`, `multi_instance`) take precedence over the template defaults. This is consistent with how `requires.env` is handled — the plug declares what it needs, the template is the reference shape.

**Practical effect:** `getFallbackAction` returns the first non-empty value found across all instances of the type. If an instance overrides the template value, it wins (first-match). This is intentional — a customized plug should be able to declare its own user-facing copy.

**Source:** S10 architect-review §6.1 asked for plug-level override to be documented. S11 plan §2.6 notes "Plug-level frontmatter can override template-level (advanced use case)."

---

## D5 — terminal-fixed ack path was missing in app.ts

**Discovery during Task 5:** The `emitAck` switch in app.ts had no case for `"terminal-fixed"` — it fell through to `"surrender-budget"` which emitted the wrong message. Fixed in Task 5.

**Logged as:** Bug fix, not a deviation. The AckKind was wired in S13 but the switch was never updated.
```

- [ ] **Step 2: Write DEVIATIONS stub**

Create `docs/sprints/m9.6-capability-resilience/s14-DEVIATIONS.md`:

```markdown
---
sprint: m9.6-s14
date: 2026-04-18
---

# M9.6-S14 Deviations

No deviations filed.
```

(Update this file if any deviations arise during execution.)

- [ ] **Step 3: Write FOLLOW-UPS**

Create `docs/sprints/m9.6-capability-resilience/s14-FOLLOW-UPS.md`:

```markdown
---
sprint: m9.6-s14
date: 2026-04-18
---

# M9.6-S14 Follow-Ups

## FU-1 — FRIENDLY_NAMES → frontmatter migration

**What:** `FRIENDLY_NAMES` in `resilience-messages.ts` is a hardcoded table (D3 above). The same "markdown is source of truth" principle that drove `fallback_action` to frontmatter applies here too. When a user installs a custom capability and doesn't happen to register a friendly name in FRIENDLY_NAMES, the ack falls back to the raw capability type string (e.g. "hold on — my-custom-stt isn't working right"). Migrating to a `friendly_name:` frontmatter field would fix this.

**Why deferred:** Out of S14 scope. S14 only landed frontmatter fields that were already prescribed in S11 templates. FRIENDLY_NAMES is a separate migration requiring a new template field.

**Target sprint:** S19 or S20 (Phase 3). The migration is non-breaking (frontmatter field optional; hardcoded table stays as fallback).

## FU-2 — Verify multi_instance frontmatter in installed plugs

**What:** S11 added `multi_instance: true` to the `browser-control` capability template. Verify at S14 sprint time that `.my_agent/capabilities/browser-chrome/CAPABILITY.md` (and any other browser-control instances) carry `multi_instance: true` in their frontmatter. If not, the `isMultiInstance` fallback to `WELL_KNOWN_MULTI_INSTANCE` will cover it, but the frontmatter should be updated for consistency.

**To check:**
```bash
grep "multi_instance" .my_agent/capabilities/*/CAPABILITY.md
```

**Target:** Backfill as a maintenance commit if missing. Not a sprint task.
```

- [ ] **Step 4: Run full verification and write test report**

```bash
cd packages/core && npx tsc --noEmit 2>&1
cd packages/dashboard && npx tsc --noEmit 2>&1
cd packages/core && npx vitest run tests/capabilities/resilience-messages-coverage tests/capabilities/resilience-messages-multi-instance tests/capabilities/resilience-messages-terminal tests/capabilities/registry-multi-instance tests/capabilities/invoker 2>&1
cd packages/core && npx vitest run tests/capabilities 2>&1
```

Create `docs/sprints/m9.6-capability-resilience/s14-test-report.md` and paste the actual output from these commands. Use this template:

```markdown
---
sprint: m9.6-s14
date: <today>
---

# M9.6-S14 Test Report

## Verification commands and output

### Core typecheck
\`\`\`
<paste tsc output here>
\`\`\`
exit: 0

### Dashboard typecheck
\`\`\`
<paste tsc output here>
\`\`\`
exit: 0

### S14 acceptance tests
\`\`\`
<paste vitest output here>
\`\`\`

### Full capabilities regression
\`\`\`
<paste vitest output here>
\`\`\`

## Universal coverage check

Every type registered in `.my_agent/capabilities/` at sprint time:

| Type | Friendly name | Fallback action source | Terminal ack | Multi-instance |
|---|---|---|---|---|
| audio-to-text | "voice transcription" | frontmatter | "voice transcription is back — what's next?" | false |
| text-to-audio | "voice reply" | frontmatter | "voice reply is back — ..." | false |
| browser-control | "browser (chrome)" | frontmatter | "browser (chrome) is back — ..." | true |
| desktop-control | "desktop control" | frontmatter or default | "desktop control is back — ..." | false |
| text-to-image | "image generation" | frontmatter or default | "image generation is back — ..." | false |
| image-to-text | "image understanding" | frontmatter or default | "image understanding is back — ..." | false |
```

- [ ] **Step 5: Final commit (artifacts only — not APPROVED framing)**

```bash
git add \
  docs/sprints/m9.6-capability-resilience/s14-DECISIONS.md \
  docs/sprints/m9.6-capability-resilience/s14-DEVIATIONS.md \
  docs/sprints/m9.6-capability-resilience/s14-FOLLOW-UPS.md \
  docs/sprints/m9.6-capability-resilience/s14-test-report.md
git commit -m "docs(m9.6-s14): sprint artifacts — decisions, deviations, follow-ups, test report"
```

---

## Final verification

Run all checks in sequence:

```bash
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/resilience-messages-coverage tests/capabilities/resilience-messages-multi-instance tests/capabilities/resilience-messages-terminal tests/capabilities/registry-multi-instance tests/capabilities/invoker
cd packages/core && npx vitest run tests/capabilities
```

All must exit clean.

---

## Branch note

S13's branch `sprint/m9.6-s13-reverify-dispatcher` was architect-APPROVED (commit `d4df2af`). This S14 branch should be created from that branch's tip (before the S13 → master merge), or from master after the merge. Either is valid. The S13 merge and roadmap-done commit are separate administrative tasks.

Create S14 branch:
```bash
git checkout -b sprint/m9.6-s14-friendly-names
```

---

*Plan created: 2026-04-18*
*Sprint: M9.6-S14 — Phase 2, Sprint 6/7*
*Depends on: S13 APPROVED*

---

## Architect gap review (Phase 2 architect, 2026-04-18)

Plan is solid: factory pattern + frontmatter wiring per CTO decisions, FU-4 properly integrated, process compliance clean. Two important gaps and two minor observations to address before execution.

### G1 — IMPORTANT: Universal-coverage gate uses hardcoded array, not the actual registry

`resilience-messages-coverage.test.ts` iterates a hardcoded `REGISTERED_TYPES` array. The §0.1 rule says "every capability type registered in `.my_agent/capabilities/` at sprint-end" — but the test only enforces what's in the array. If a future sprint adds a new capability type and forgets to update the array, the universal-coverage rule is silently violated and the test still passes.

**Required fix:** make the gate read the actual registry at test time. Add a second test that:
1. Loads the real `.my_agent/capabilities/` directory via `scanCapabilities()` (or similar — confirm helper at sprint-time).
2. For each scanned capability with a `provides` field, asserts: `friendlyName(type) !== type` (i.e., not the raw fallback) AND `registry.getFallbackAction(type)` is non-empty AND `copy.terminalAck(makeFailure(type))` is non-empty.
3. The test fails loudly with the offending type name when a registered type has no copy.

The hardcoded `REGISTERED_TYPES` array can stay as the explicit test cases (good for clear pass/fail), but the **dynamic registry-driven test must also exist** — that's the actual rule enforcement.

**If scanning `.my_agent/` from tests is fragile** (paths, env, etc.), file a deviation proposal naming an alternative (e.g., a fixture-capability dir). But do not ship S14 without the dynamic gate.

### G2 — IMPORTANT: `getFallbackAction` is first-wins across multi-instance plugs

Current code:
```typescript
for (const cap of this.capabilities.values()) {
  if (cap.provides === type && cap.fallbackAction) return cap.fallbackAction
}
```

For multi-instance types (`browser-control` with both `browser-chrome` and `browser-firefox` registered), this returns the first cap's `fallbackAction`. If chrome and firefox declare different `fallback_action` strings in their CAPABILITY.md frontmatter, the user gets whichever loaded first — non-deterministic from the user's perspective.

**Required:** decide and document the semantic. Two options:

- **Option A (current code, but documented):** "first-wins is intentional — multi-instance plugs of the same type should agree on fallback copy; if they don't, framework picks the first registered." Add to `s14-DECISIONS.md` as D6, and add a FOLLOW-UP note that per-instance fallback can be added later if a real conflict surfaces.
- **Option B (per-instance lookup):** add an optional `capabilityName` parameter — `getFallbackAction(type, capabilityName?)`. When provided, find the named cap first; else fall back to first-wins. Mirrors the FU-4 pattern in the invoker.

Recommend **Option A** for S14 minimum scope (no current multi-instance plug declares a non-default fallback). But pick one and document, do not ship the ambiguity unmarked.

### G3 — Observation: Plug-level override is implicit

From S10 architect-review §6.1: "Plug-level frontmatter can override template-level (advanced use case; document in DECISIONS.md whether to allow override or always inherit from template)."

The current implementation lets plug-level frontmatter set `fallbackAction` (read by scanner from each plug's CAPABILITY.md, not the template). So plug-level **does** override template-level today. Add a one-liner to DECISIONS (D7) recording this: "Plug-level CAPABILITY.md frontmatter overrides template-level fallback_action — the scanner reads from the plug, not from the template."

Non-blocking but the override behavior should be intentional + documented.

### G4 — Observation: `app.resilienceCopy` fallback hides boot-order bugs

Task 5 Step 4 has `const copy = app.resilienceCopy ?? createResilienceCopy(registry);`. The fallback creates a fresh instance per emit if `resilienceCopy` is null. Functionally correct but it hides a class of bugs: if any emit path fires before boot completes the wiring, the silent fallback masks the bug.

Acceptable for S14 (defensive), but **add a `console.warn` when the fallback fires** so future devs see the diagnostic without debugging:
```typescript
const copy = app.resilienceCopy ?? (() => {
  console.warn("[emitAck] resilienceCopy not initialized at boot — using fresh instance");
  return createResilienceCopy(registry);
})();
```

Or convert to throw-on-null after one full sprint of clean operation. Either is fine; do not silently mask.

---

After G1 + G2 are addressed in the plan (G3 + G4 can be in-flight DECISIONS during execution), sprint is approved to execute.

**Design feature → task coverage check (post-corrections):**

| Feature | Source | Plan task |
|---|---|---|
| `createResilienceCopy(registry)` factory | architect §2.6 + CTO decision | Task 3 |
| `FRIENDLY_NAMES` extended for every type | architect §2.6 | Task 3 (kept hardcoded per D3 + FU-1 deferral to S19/S20) |
| Multi-instance ack disambiguation | architect §2.6 | Task 3 + Task 6b tests |
| `surrender()` uses friendlyName + suffix uniformly | architect §2.6 | Task 3 |
| Terminal-recovery ack copy per type | architect §2.6 | Task 3 (`terminalAck`) + Task 6c tests |
| `RESTORED_TERMINAL` ack wired in app.ts emitAck switch | S13 follow-through | Task 5 (D5 — bug fix) |
| `registry.isMultiInstance(type)` + frontmatter source | architect §2.6 | Task 1 (scanner) + Task 2 (registry) |
| `registry.getFallbackAction(type)` + frontmatter source | architect §2.6 + CTO decision | Task 1 + Task 2 + G2 (semantic decision) |
| `multi_instance` + `fallback_action` frontmatter loader | architect §2.6 | Task 1 |
| `capabilityName?: string` on `InvokeOptions` (FU-4) | S10-FU-4 / S10 architect §6.1 | Task 4 |
| Universal-coverage gate test | architect §2.6 | Task 6a + G1 (dynamic gate) |
| FRIENDLY_NAMES → frontmatter migration deferred | CTO decision | FU-1 to S19/S20 |
| Plug-level override semantics documented | S10 architect §6.1 | G3 (DECISION D7) |

— Architect: Opus 4.7 (Phase 2 architect)
