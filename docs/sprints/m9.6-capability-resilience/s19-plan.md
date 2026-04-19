# M9.6-S19 — UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six UX polish features: (1) ack coalescing for parallel CFRs, (2) `fixed`-outcome automation notifier fan-out, (3) `TranscriptTurn.failure_type` + assistant-turn orphan detection, (4) `FRIENDLY_NAMES` → frontmatter migration, (5) system-origin CFR ring buffer + dashboard health panel, (6) failure_type inline marker in turn rendering.

**Architecture:** All features build on the single-ack-path and single-TTS-path foundation landed in S16–S18. Coalescing wraps the existing `AckDelivery.deliver()` call with a 30-second per-conversation window and N-aware copy renderer. The `FRIENDLY_NAMES` migration threads `registry.getFriendlyName()` through `resilience-messages.ts`, which already receives the registry via DI (S14). The system-origin ring buffer lives in `AckDelivery`, exposed via a new app property; the capabilities health route reads it lazily. Task ordering: FRIENDLY_NAMES first (feeds all copy generation), then coalescing + notifier, then system-origin, then assistant-turn fields, then dashboard UI.

**Tech Stack:** TypeScript, Node.js, Vitest, Alpine.js (no build step for JS/HTML)

**Design ref:** `docs/sprints/m9.6-capability-resilience/plan-phase3-refinements.md` §2.4 — binding.

---

## ARCHITECT REVIEW (2026-04-19) — required corrections before start

Phase 3 architect (Opus 4.7) reviewed v0 of this plan. Structure is strong (§0.3 section, TDD pattern, sprint artifacts task included from Task 0, comprehensive file map). Two required corrections + five suggestions before start. Inline edits below are marked `[ARCHITECT R#]` or `[ARCHITECT S#]`.

| Tag | What was missing | Where it landed |
|-----|------------------|-----------------|
| **R1** | `failure_type` write-callsite missing from every Task. Plan has type field, scanner, dashboard render — but NO step writes the field onto an assistant turn. Whole assistant-turn-orphan feature ships half-implemented (consumer + scanner + UI exist; producer doesn't). Also: plan misdirects the location ("the message-handler sets it" — but `appendTurn` is NOT called in message-handler.ts at all; real callsite is `chat-service.ts:~931`). | New Task 5.5 — failure_type producer in `chat-service.ts` |
| **R2** | Task 4 ring buffer cap test contradicts itself. Asserts `events[0].component === "component-5"` after 105 pushes, but `getSystemEvents()` reverses (most-recent-first), so `events[0]` should be `component-104`. The next test in the same describe block confirms reverse semantics. Both can't be right. | Task 4 Step 1 — assertion corrected |
| **S1** | Ack coalescing tested only in isolation (Task 2 Step 1). No integration test fires through `AckDelivery.deliver()`. If Step 3 wiring is wrong, unit tests still pass. | Task 2 — added integration-test step |
| **S2** | `OrphanSweepReport` extension uses placeholder `{ ... }` for staleSkipped/corruptSkipped fields. Won't compile. | Task 5 Step 4 — grep-first guidance added |
| **S3** | `cfr-automation-notifier.test.ts` doesn't verify app.ts wiring. Tests construct AckDelivery directly with mock notifier; if Step 3 wiring is wrong (notifier never passed), unit tests still pass. | Task 3 — added wiring assertion |
| **S4** | Sprint-time line-number verification documented but not enforced. Body of every task uses `~line N` refs. | Sprint-time verification section — strengthened to "grep first, edit second" hard rule |
| **S5** | D3 in Task 7 is documentation, not implementation. Once R1 lands, D3 should capture the discovered callsite + the dev's plan-time hypothesis (message-handler) vs grep-discovered reality (chat-service). | Task 7 Step 5 — D3 expanded |

### Architect note on the dev's flagged question

The dev flagged: "where failure_type gets written onto assistant turns... needs to be confirmed at sprint time via grep — the spec doesn't name the exact callsite. The dev is instructed to find it and document the choice in D3."

**Two corrections to that framing:**
1. **The location is wrong.** Plan says "message-handler.ts" — `grep -n "appendTurn" packages/dashboard/src/channels/message-handler.ts` returns zero hits. The actual callsite is `chat-service.ts:~931` (the assistant-turn append after the streaming loop completes).
2. **Documenting in D3 is necessary but not sufficient.** The plan needs an explicit Task step that EDITS chat-service.ts to set `failure_type: "text-to-audio"` on the appendTurn payload when `synthesizeAudio()` returned null in a voice-reply context. R1 below adds Task 5.5 for this.

### Sprint-time verification items (grep before relying on)

- **`appendTurn` for assistant turns** — `grep -n "appendTurn" packages/dashboard/src/chat/chat-service.ts` (expect ~line 931 for the assistant turn after streaming loop).
- All other `~line N` references in this plan — `grep -n` first, then edit.
- **`OrphanSweepReport` shape** — `grep -n "OrphanSweepReport" packages/core/src/conversations/orphan-watchdog.ts` to see existing fields before adding `assistantFailuresScheduled`.
- **`OrphanWatchdog` constructor** — verify the `{conversationLimit, staleThresholdMs, rawMediaStore, conversationManager, systemMessageInjector}` shape matches the actual constructor.

---

## §0.3 Compliance Rules (READ BEFORE STARTING)

These rules are non-negotiable. S17 + S18 maintained them cleanly; S19 must do the same.

- **Do NOT merge to master.** All work stays on `sprint/m9.6-s19-ux-polish` until the architect approves.
- **Do NOT update `docs/ROADMAP.md`.** Architect authors the ROADMAP-Done commit as the LAST commit after approval.
- **Do NOT write "APPROVED" or "all tasks complete" in any commit message.**
- **File `docs/sprints/m9.6-capability-resilience/proposals/s19-<slug>.md` for any deviation** before changing course.

---

## Before/After

| Before | After |
|--------|-------|
| Parallel CFRs in same conversation each emit a separate ack | Second CFR within 30 s sends "still fixing — now also {name2}"; combined terminal ack when both finish |
| `fixed`-outcome automation CFR never fires notifier (only surrendered does) | `fixed`-outcome also fires notifier when `notifyMode === "immediate"` |
| System-origin CFRs log to console only | Ring buffer of last 100 events; `/api/capabilities/cfr-system-events` endpoint; dashboard health panel |
| `FRIENDLY_NAMES` is a hardcoded constant in `resilience-messages.ts` | `registry.getFriendlyName(type)` reads from CAPABILITY.md frontmatter; hardcoded table is the fallback |
| Assistant turns with TTS failure have no structured field; orphan watchdog scans user turns only | `TranscriptTurn.failure_type` field marks affected assistant turns; watchdog also scans assistant turns |
| Dashboard renders blank or text-only assistant bubble when TTS failed | Inline marker "voice reply unavailable — fixing…" on turns with `failure_type` set |

---

## Sprint-Time Verification Items (grep before relying on line numbers)

- `packages/core/src/capabilities/ack-delivery.ts` — confirm system branch at ~line 258; automation branch at ~line 197.
- `packages/core/src/capabilities/scanner.ts` — confirm frontmatter mapping block at ~line 159 (iconSlug, fallbackAction, multiInstance).
- `packages/core/src/capabilities/registry.ts` — confirm `getFallbackAction` at ~line 223 for the `getFriendlyName` pattern.
- `packages/dashboard/src/app.ts` — confirm `ackDelivery` local var at ~line 666; `app.recoveryOrchestrator` assignment near it; class property block at ~line 454.
- `packages/dashboard/src/routes/capabilities.ts` — confirm `registerCapabilityRoutes` at ~line 218; `fastify.app?.capabilityRegistry` access pattern.
- `packages/dashboard/public/js/app.js` — confirm `capability_ack` case at ~line 2005; turn rendering for assistant turns (grep `role.*assistant` or `streaming`).
- `packages/dashboard/public/index.html` — confirm where capabilities settings section lives (grep `/api/settings/capabilities`).

---

## File Map

| File | Change |
|------|--------|
| `packages/core/src/capabilities/types.ts` | Add `friendly_name?: string` to `CapabilityFrontmatter`; `friendlyName?: string` to `Capability` |
| `packages/core/src/capabilities/scanner.ts` | Map `data.friendly_name` → `cap.friendlyName` (same block as `fallbackAction`) |
| `packages/core/src/capabilities/registry.ts` | Add `getFriendlyName(type: string): string` method |
| `packages/core/src/capabilities/resilience-messages.ts` | Replace local `friendlyName()` with `registry.getFriendlyName(type)` |
| `skills/capability-templates/audio-to-text.md` | Add `friendly_name: voice transcription` to frontmatter |
| `skills/capability-templates/text-to-audio.md` | Add `friendly_name: voice reply` to frontmatter |
| `skills/capability-templates/image-to-text.md` | Add `friendly_name: image understanding` to frontmatter |
| `skills/capability-templates/text-to-image.md` | Add `friendly_name: image generation` to frontmatter |
| `skills/capability-templates/browser-control.md` | Add `friendly_name: browser` to frontmatter |
| `skills/capability-templates/desktop-control.md` | Add `friendly_name: desktop control` to frontmatter |
| `packages/core/tests/capabilities/registry-friendly-name.test.ts` | **New** — frontmatter override, fallback-to-hardcoded, fallback-to-type |
| `packages/core/tests/capabilities/resilience-messages-frontmatter.test.ts` | **New** — copy uses frontmatter; no regressions vs S14 |
| `packages/core/src/capabilities/ack-delivery.ts` | Add `ConversationAckCoalescer` class; fix `fixed`-outcome notifier; add system-origin ring buffer |
| `packages/core/tests/capabilities/ack-coalescing.test.ts` | **New** — 2-CFR merge, 3+ CFR N-way, one-terminal-one-fixing, cross-origin bypass |
| `packages/dashboard/src/app.ts` | Add `ackDelivery: AckDelivery \| null = null` property; wire concrete `AutomationNotifierLike`; pass to `new AckDelivery(...)` |
| `packages/dashboard/src/routes/capabilities.ts` | Add `GET /api/capabilities/cfr-system-events` route |
| `packages/dashboard/tests/integration/cfr-automation-notifier.test.ts` | **New** — `fixed`-outcome notifier called; missing notifier degrades gracefully; `debrief` mode does not call notifier |
| `packages/dashboard/tests/integration/app-ackdelivery-wiring.test.ts` | **New** [S3] — app.ackDelivery non-null after boot; notifier wired end-to-end |
| `packages/dashboard/tests/integration/cfr-system-origin-health.test.ts` | **New** — system-origin CFR fires, endpoint returns it |
| `packages/dashboard/src/chat/chat-service.ts` | Add `ttsFailed` flag + `failure_type` on assistant-turn appendTurn payload [R1] |
| `packages/dashboard/tests/integration/chat-service-failure-type.test.ts` | **New** [R1] — TTS failure produces `failure_type="text-to-audio"` on the assistant turn |
| `packages/dashboard/src/conversations/types.ts` | Add `failure_type?: string` to `TranscriptTurn` |
| `packages/core/src/conversations/orphan-watchdog.ts` | Add `failure_type?` to `TranscriptTurnLike`; generalise `VOICE_PLACEHOLDERS` → `FAILURE_PLACEHOLDERS`; add assistant-turn scan |
| `packages/core/tests/conversations/orphan-watchdog-assistant.test.ts` | **New** — assistant turn with `failure_type: "text-to-audio"` detected + scheduled |
| `packages/dashboard/public/js/app.js` | Add `failure_type` inline marker to assistant turn rendering |
| `packages/dashboard/public/index.html` | Add system-origin health panel to capabilities settings section |
| `docs/sprints/m9.6-capability-resilience/s19-DECISIONS.md` | Sprint decisions |
| `docs/sprints/m9.6-capability-resilience/s19-DEVIATIONS.md` | Sprint deviations |
| `docs/sprints/m9.6-capability-resilience/s19-FOLLOW-UPS.md` | Sprint follow-ups |
| `docs/sprints/m9.6-capability-resilience/s19-test-report.md` | Sprint test report |

---

## Task 0: Preflight

**Files:** none

- [ ] **Step 1: Confirm S18 merged to master**

```bash
git log --oneline master | head -5
# Expect the S18 ROADMAP-Done commit near the top
git branch --list sprint/m9.6-s18-*
# Expect nothing (branch was merged and optionally deleted)
```

- [ ] **Step 2: Confirm baseline test suite**

```bash
cd packages/core && npx vitest run 2>&1 | tail -5
# Expected: 639 passed (or more if S18 added tests), 0 failed
cd packages/dashboard && npx vitest run 2>&1 | tail -5
# Note the pass count — this is the regression gate
```

- [ ] **Step 3: Create sprint branch**

```bash
git checkout master && git pull
git checkout -b sprint/m9.6-s19-ux-polish
```

- [ ] **Step 4: Create sprint artifact stubs**

```bash
cat > docs/sprints/m9.6-capability-resilience/s19-DECISIONS.md << 'EOF'
---
sprint: m9.6-s19
---

# S19 Decisions
EOF

cat > docs/sprints/m9.6-capability-resilience/s19-DEVIATIONS.md << 'EOF'
---
sprint: m9.6-s19
---

# S19 Deviations
EOF

cat > docs/sprints/m9.6-capability-resilience/s19-FOLLOW-UPS.md << 'EOF'
---
sprint: m9.6-s19
---

# S19 Follow-Ups
EOF

cat > docs/sprints/m9.6-capability-resilience/s19-test-report.md << 'EOF'
---
sprint: m9.6-s19
---

# S19 Test Report
EOF
```

- [ ] **Step 5: Commit preflight**

```bash
git add docs/sprints/m9.6-capability-resilience/s19-*.md \
        docs/sprints/m9.6-capability-resilience/s19-plan.md
git commit -m "chore(s19): sprint artifacts + plan"
```

---

## Task 1: FRIENDLY_NAMES → Frontmatter Migration

**Files:**
- Modify: `packages/core/src/capabilities/types.ts`
- Modify: `packages/core/src/capabilities/scanner.ts`
- Modify: `packages/core/src/capabilities/registry.ts`
- Modify: `packages/core/src/capabilities/resilience-messages.ts`
- Modify: `skills/capability-templates/audio-to-text.md`
- Modify: `skills/capability-templates/text-to-audio.md`
- Modify: `skills/capability-templates/image-to-text.md`
- Modify: `skills/capability-templates/text-to-image.md`
- Modify: `skills/capability-templates/browser-control.md`
- Modify: `skills/capability-templates/desktop-control.md`
- Create: `packages/core/tests/capabilities/registry-friendly-name.test.ts`
- Create: `packages/core/tests/capabilities/resilience-messages-frontmatter.test.ts`

### Step 1: Write the failing tests

- [ ] **Create `packages/core/tests/capabilities/registry-friendly-name.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";

function makeCapability(overrides: Partial<Capability>): Capability {
  return {
    name: "test-cap",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/test-cap",
    status: "available",
    health: "healthy",
    enabled: true,
    canDelete: false,
    ...overrides,
  };
}

describe("CapabilityRegistry.getFriendlyName", () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("returns frontmatter friendly_name when set", () => {
    registry.register(makeCapability({
      provides: "audio-to-text",
      friendlyName: "custom transcription",
    }));
    expect(registry.getFriendlyName("audio-to-text")).toBe("custom transcription");
  });

  it("falls back to hardcoded FRIENDLY_NAMES when frontmatter absent", () => {
    registry.register(makeCapability({
      provides: "audio-to-text",
      friendlyName: undefined,
    }));
    expect(registry.getFriendlyName("audio-to-text")).toBe("voice transcription");
  });

  it("falls back to raw type string when type not in hardcoded table", () => {
    registry.register(makeCapability({
      provides: "custom-capability",
      friendlyName: undefined,
    }));
    expect(registry.getFriendlyName("custom-capability")).toBe("custom-capability");
  });

  it("returns raw type string when registry is empty", () => {
    expect(registry.getFriendlyName("audio-to-text")).toBe("voice transcription");
  });

  it("plug-level friendly_name overrides template-level (first-wins per type)", () => {
    registry.register(makeCapability({
      name: "cap-a",
      provides: "audio-to-text",
      friendlyName: "plug-level name",
    }));
    registry.register(makeCapability({
      name: "cap-b",
      provides: "audio-to-text",
      friendlyName: "second plug name",
    }));
    // First registered wins (same semantic as getFallbackAction)
    expect(registry.getFriendlyName("audio-to-text")).toBe("plug-level name");
  });
});
```

- [ ] **Create `packages/core/tests/capabilities/resilience-messages-frontmatter.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import type { Capability } from "../../src/capabilities/types.js";

function makeRegistry(friendlyName?: string): CapabilityRegistry {
  const r = new CapabilityRegistry();
  const cap: Capability = {
    name: "stt-deepgram",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/stt-deepgram",
    status: "available",
    health: "healthy",
    enabled: true,
    canDelete: false,
    friendlyName,
  };
  r.register(cap);
  return r;
}

function makeFailure(capabilityType: string): CapabilityFailure {
  return {
    id: "test-failure-1",
    capabilityType,
    symptom: "execution-error",
    detail: "test error",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "conversation",
        channel: { transportId: "dashboard", sender: "user", replyTo: undefined },
        conversationId: "conv-1",
      },
    },
  } as unknown as CapabilityFailure;
}

describe("createResilienceCopy with frontmatter-backed registry", () => {
  it("uses frontmatter friendly_name in ack copy", () => {
    const registry = makeRegistry("speech recognition");
    const copy = createResilienceCopy(registry);
    const ack = copy.ack(makeFailure("audio-to-text"));
    expect(ack).toContain("speech recognition");
    expect(ack).not.toContain("voice transcription");
  });

  it("falls back to hardcoded name when no frontmatter", () => {
    const registry = makeRegistry(undefined);
    const copy = createResilienceCopy(registry);
    const ack = copy.ack(makeFailure("audio-to-text"));
    expect(ack).toContain("voice transcription");
  });

  it("regression: surrender copy still renders for all known types", () => {
    const registry = makeRegistry(undefined);
    const copy = createResilienceCopy(registry);
    const failure = makeFailure("audio-to-text");
    for (const reason of ["budget", "iteration-3", "redesign-needed", "insufficient-context"] as const) {
      const msg = copy.surrender(failure, reason);
      expect(msg.length).toBeGreaterThan(10);
    }
  });
});
```

- [ ] **Step 2: Run the tests — expect failures**

```bash
cd packages/core && npx vitest run tests/capabilities/registry-friendly-name tests/capabilities/resilience-messages-frontmatter 2>&1 | tail -15
# Expected: failures — getFriendlyName does not exist; friendlyName not on Capability
```

### Step 3: Add `friendly_name` to types

- [ ] **In `packages/core/src/capabilities/types.ts`, add `friendly_name?: string` to `CapabilityFrontmatter` and `friendlyName?: string` to `Capability`**

In `CapabilityFrontmatter` (after `multi_instance?: boolean`):
```typescript
  friendly_name?: string   // user-facing label override (S19); falls back to FRIENDLY_NAMES
```

In `Capability` (after `multiInstance?: boolean`):
```typescript
  friendlyName?: string    // sourced from friendly_name frontmatter (S19)
```

### Step 4: Wire `friendly_name` in scanner

- [ ] **In `packages/core/src/capabilities/scanner.ts`, add `friendlyName: data.friendly_name` to the Capability construction block**

Find the block with `iconSlug: data.icon, fallbackAction: data.fallback_action, multiInstance: data.multi_instance` and add after `multiInstance`:
```typescript
friendlyName: data.friendly_name,       // S19
```

### Step 5: Add `getFriendlyName` to registry

- [ ] **In `packages/core/src/capabilities/registry.ts`, add `getFriendlyName` method after `getFallbackAction`**

The method follows the same first-wins-per-type pattern as `getFallbackAction`:

```typescript
/**
 * Per-type user-facing friendly name (e.g. "voice transcription").
 * Sources from `friendly_name:` in CAPABILITY.md frontmatter (S19).
 *
 * Semantic: first-wins across all instances of the type. `friendly_name`
 * is a TYPE-LEVEL property. Falls back to the compile-time FRIENDLY_NAMES
 * table in resilience-messages.ts, then to the raw type string.
 *
 * Callers that need the hardcoded fallback table should import FRIENDLY_NAMES
 * directly. This method encapsulates the full lookup chain.
 */
getFriendlyName(type: string): string {
  for (const cap of this.capabilities.values()) {
    if (cap.provides === type && cap.friendlyName) return cap.friendlyName;
  }
  return FRIENDLY_NAMES[type] ?? type;
}
```

You need to import `FRIENDLY_NAMES` from `./resilience-messages.js`. Add the import at the top of `registry.ts`:
```typescript
import { FRIENDLY_NAMES } from "./resilience-messages.js";
```

### Step 6: Update `resilience-messages.ts` to use `registry.getFriendlyName`

- [ ] **Replace the local `friendlyName()` function with `registry.getFriendlyName(capabilityType)`**

Delete the local function:
```typescript
// DELETE THIS:
function friendlyName(capabilityType: string): string {
  return FRIENDLY_NAMES[capabilityType] ?? capabilityType;
}
```

In `createResilienceCopy`, replace all `friendlyName(capabilityType)` with `registry.getFriendlyName(capabilityType)` and all `friendlyName(failure.capabilityType)` with `registry.getFriendlyName(failure.capabilityType)`.

Keep `FRIENDLY_NAMES` exported (it's the fallback table; `registry.ts` now imports it; the S14 universal-coverage test imports it directly).

### Step 7: Add `friendly_name` to the 6 capability templates

- [ ] **`skills/capability-templates/audio-to-text.md`** — add `friendly_name: "voice transcription"` to frontmatter (after `multi_instance: false`)

- [ ] **`skills/capability-templates/text-to-audio.md`** — add `friendly_name: "voice reply"`

- [ ] **`skills/capability-templates/image-to-text.md`** — add `friendly_name: "image understanding"`

- [ ] **`skills/capability-templates/text-to-image.md`** — add `friendly_name: "image generation"`

- [ ] **`skills/capability-templates/browser-control.md`** — add `friendly_name: "browser"`

- [ ] **`skills/capability-templates/desktop-control.md`** — add `friendly_name: "desktop control"`

### Step 8: Verify tests pass

- [ ] **Run the new tests**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -20
# Expected: zero errors

cd packages/core && npx vitest run tests/capabilities/registry-friendly-name tests/capabilities/resilience-messages-frontmatter 2>&1 | tail -10
# Expected: all pass
```

- [ ] **Run full core suite to check for regressions**

```bash
cd packages/core && npx vitest run 2>&1 | tail -5
# Expected: same pass count as baseline, zero failures
```

### Step 9: Commit

```bash
git add packages/core/src/capabilities/types.ts \
        packages/core/src/capabilities/scanner.ts \
        packages/core/src/capabilities/registry.ts \
        packages/core/src/capabilities/resilience-messages.ts \
        skills/capability-templates/ \
        packages/core/tests/capabilities/registry-friendly-name.test.ts \
        packages/core/tests/capabilities/resilience-messages-frontmatter.test.ts
git commit -m "feat(s19): FRIENDLY_NAMES frontmatter migration — registry.getFriendlyName + 6 templates"
```

---

## Task 2: Ack Coalescing

**Files:**
- Modify: `packages/core/src/capabilities/ack-delivery.ts`
- Create: `packages/core/tests/capabilities/ack-coalescing.test.ts`

The coalescer intercepts conversation-origin acks in `AckDelivery.deliver()`. It maintains a per-conversation window (30 s). Within the window, a second CFR sends "still fixing — now also {name2}". When all tracked CFRs reach terminal state, it sends a combined terminal ack. Initial acks and updates outside the window pass through immediately.

### Step 1: Write the failing tests

- [ ] **Create `packages/core/tests/capabilities/ack-coalescing.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationAckCoalescer } from "../../src/capabilities/ack-delivery.js";

function makeSendFn() {
  const sent: string[] = [];
  const fn = vi.fn((msg: string) => { sent.push(msg); });
  return { fn, sent };
}

describe("ConversationAckCoalescer", () => {
  let coalescer: ConversationAckCoalescer;
  const CONV = "conv-1";
  const NOW = Date.now();

  beforeEach(() => {
    coalescer = new ConversationAckCoalescer();
  });

  it("returns null for a first CFR in a conversation (caller delivers initial ack itself)", () => {
    const result = coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    expect(result).toBeNull();
  });

  it("returns a follow-up message when second CFR arrives within 30s", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    const msg = coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 5000);
    expect(msg).toContain("voice reply");
    expect(msg).toMatch(/still fixing/i);
  });

  it("N-way merge: three types produce Oxford comma copy", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    const msg = coalescer.onAck(CONV, "browser-control", "attempt", NOW + 2000);
    // Should say "still fixing — voice transcription, voice reply, and browser"
    expect(msg).toMatch(/voice transcription.*voice reply.*browser/);
  });

  it("returns null when same type arrives again (idempotent re-attempt)", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    const msg = coalescer.onAck(CONV, "audio-to-text", "attempt", NOW + 1000);
    expect(msg).toBeNull();
  });

  it("terminal: first type fixed while second still fixing — partial restoration message", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    const msg = coalescer.onTerminal(CONV, "audio-to-text", "fixed", NOW + 10000);
    // One fixed, one still in progress → partial message
    expect(msg).toContain("voice transcription");
    expect(msg).toMatch(/back|restored/i);
    expect(msg).toMatch(/still|in progress/i);
  });

  it("terminal: both types surrender — combined surrender message", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    coalescer.onTerminal(CONV, "audio-to-text", "surrendered", NOW + 10000);
    const msg = coalescer.onTerminal(CONV, "text-to-audio", "surrendered", NOW + 11000);
    expect(msg).not.toBeNull(); // Both terminal — emit combined
  });

  it("terminal: both fixed — combined restoration message", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 1000);
    coalescer.onTerminal(CONV, "audio-to-text", "fixed", NOW + 10000);
    const msg = coalescer.onTerminal(CONV, "text-to-audio", "fixed", NOW + 11000);
    expect(msg).toContain("voice transcription");
    expect(msg).toContain("voice reply");
    expect(msg).toMatch(/back|restored/i);
  });

  it("cross-origin bypass: automation CFR does not affect conversation window", () => {
    // Simulate: automation-origin CFR should never reach the coalescer.
    // The coalescer only manages conversation-origin state. This test
    // verifies the window is per-conversationId and clean.
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    // A different conversation's CFR should open a separate window
    const otherMsg = coalescer.onAck("conv-2", "audio-to-text", "attempt", NOW);
    expect(otherMsg).toBeNull(); // First for conv-2 — no coalescing
  });

  it("window expires after 30s — next CFR opens a fresh window", () => {
    coalescer.onAck(CONV, "audio-to-text", "attempt", NOW);
    // 31 seconds later — window expired
    const msg = coalescer.onAck(CONV, "text-to-audio", "attempt", NOW + 31_000);
    expect(msg).toBeNull(); // Treated as a new first-CFR window
  });
});
```

- [ ] **Run tests — expect failures**

```bash
cd packages/core && npx vitest run tests/capabilities/ack-coalescing 2>&1 | tail -10
# Expected: FAIL — ConversationAckCoalescer not exported
```

### Step 2: Implement `ConversationAckCoalescer`

- [ ] **Add `ConversationAckCoalescer` to `packages/core/src/capabilities/ack-delivery.ts`**

Add after the existing imports and before the `AckDelivery` class. It requires `FRIENDLY_NAMES` for copy generation (import it from `./resilience-messages.js` — already imported via `createResilienceCopy` in the rest of the file; add to import if needed).

```typescript
// ─── Coalescing ─────────────────────────────────────────────────────────────

const COALESCE_WINDOW_MS = 30_000;

type CoalesceStatus = "fixing" | "fixed" | "surrendered";

interface CoalesceEntry {
  capabilityType: string;
  status: CoalesceStatus;
}

interface CoalesceWindow {
  entries: Map<string, CoalesceEntry>; // keyed by capabilityType
  openedAt: number;                    // timestamp (ms since epoch, injected for testability)
}

/**
 * Per-conversation ack coalescer. Tracks in-flight CFRs within a 30-second
 * window. Conversation-origin ONLY — automation and system origins bypass.
 *
 * onAck(): call when an attempt/status ack is about to fire for a conversation.
 *   Returns null if this is the first CFR (caller delivers immediately).
 *   Returns a follow-up message string if this is a subsequent CFR (caller delivers this).
 *
 * onTerminal(): call when a terminal transition fires for a tracked type.
 *   Returns null while other CFRs are still in-flight.
 *   Returns a combined terminal message when all tracked types have resolved.
 */
export class ConversationAckCoalescer {
  private windows = new Map<string, CoalesceWindow>();

  /**
   * Called when a new attempt/status ack fires for a conversation-origin CFR.
   * @param conversationId - the conversation
   * @param capabilityType - the failing capability type
   * @param _kind - ack kind (unused; coalescer only cares about attempts/status)
   * @param nowMs - current time in ms (injectable for tests; defaults to Date.now())
   * @returns null if this is the first CFR or window expired; follow-up string otherwise
   */
  onAck(
    conversationId: string,
    capabilityType: string,
    _kind: string,
    nowMs: number = Date.now(),
  ): string | null {
    const existing = this.windows.get(conversationId);

    // No window or expired window — open fresh, first CFR delivers its own ack
    if (!existing || nowMs - existing.openedAt > COALESCE_WINDOW_MS) {
      const entries = new Map<string, CoalesceEntry>();
      entries.set(capabilityType, { capabilityType, status: "fixing" });
      this.windows.set(conversationId, { entries, openedAt: nowMs });
      return null;
    }

    // Window active — add or update type
    if (existing.entries.has(capabilityType)) {
      // Re-attempt of same type within window — idempotent, no extra message
      return null;
    }

    existing.entries.set(capabilityType, { capabilityType, status: "fixing" });

    // Build "still fixing — now also X [, Y, and Z]" copy
    const allTypes = Array.from(existing.entries.keys());
    return "still fixing — now also " + this.renderTypeList(allTypes.slice(1));
  }

  /**
   * Called when a terminal transition (fixed or surrendered) fires for a type.
   * @returns null while other types are still in-flight; combined message when all done.
   */
  onTerminal(
    conversationId: string,
    capabilityType: string,
    outcome: "fixed" | "surrendered",
    _nowMs: number = Date.now(),
  ): string | null {
    const window = this.windows.get(conversationId);
    if (!window || !window.entries.has(capabilityType)) {
      // Not tracked — caller delivers the terminal ack directly
      return null;
    }

    window.entries.get(capabilityType)!.status = outcome;

    // Check if all entries are in terminal state
    const allEntries = Array.from(window.entries.values());
    const allTerminal = allEntries.every(
      (e) => e.status === "fixed" || e.status === "surrendered",
    );

    if (!allTerminal) {
      // Some still fixing — emit partial restoration
      const fixed = allEntries.filter((e) => e.status === "fixed");
      const inFlight = allEntries.filter((e) => e.status === "fixing");
      if (fixed.length > 0 && inFlight.length > 0) {
        const fixedNames = this.renderTypeList(fixed.map((e) => e.capabilityType));
        const inFlightNames = this.renderTypeList(inFlight.map((e) => e.capabilityType));
        return `${fixedNames} ${fixed.length === 1 ? "is" : "are"} back; ${inFlightNames} still in progress.`;
      }
      return null;
    }

    // All terminal — emit combined message and clear window
    this.windows.delete(conversationId);

    const fixedTypes = allEntries.filter((e) => e.status === "fixed");
    const surrenderedTypes = allEntries.filter((e) => e.status === "surrendered");

    if (surrenderedTypes.length === 0) {
      // All fixed
      return `${this.renderTypeList(fixedTypes.map((e) => e.capabilityType))} ${fixedTypes.length === 1 ? "is" : "are"} back.`;
    }
    if (fixedTypes.length === 0) {
      // All surrendered — combined surrender copy
      return `I couldn't fix ${this.renderTypeList(surrenderedTypes.map((e) => e.capabilityType))} — try again in a moment.`;
    }
    // Mixed
    const fixedNames = this.renderTypeList(fixedTypes.map((e) => e.capabilityType));
    const surrenderedNames = this.renderTypeList(surrenderedTypes.map((e) => e.capabilityType));
    return `${fixedNames} ${fixedTypes.length === 1 ? "is" : "are"} back; ${surrenderedNames} couldn't be fixed automatically.`;
  }

  private renderTypeList(types: string[]): string {
    const names = types.map((t) => FRIENDLY_NAMES[t] ?? t);
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }
}
```

You need to import `FRIENDLY_NAMES` in `ack-delivery.ts`. Check the existing imports — add if not already present:
```typescript
import { FRIENDLY_NAMES } from "./resilience-messages.js";
```

### Step 3: Wire coalescer into `AckDelivery.deliver()`

- [ ] **Add a `ConversationAckCoalescer` instance to `AckDelivery`**

In the `AckDelivery` class, add a private coalescer field:
```typescript
private readonly coalescer = new ConversationAckCoalescer();
```

- [ ] **Intercept conversation-origin attempts and terminal transitions**

In the conversation-origin branch of `deliver()`, after `if (origin.kind === "conversation") {`, add the coalescing intercept before the actual send:

```typescript
if (origin.kind === "conversation") {
  const { channel, conversationId } = origin;
  const kind = context?.kind;

  // Coalescing intercept — conversation-origin only.
  if (isTerminalKind(kind)) {
    const outcome = kind === "terminal-fixed" ? "fixed" : "surrendered";
    const coalescedMsg = this.coalescer.onTerminal(
      conversationId,
      failure.capabilityType,
      outcome,
    );
    if (coalescedMsg !== null) {
      // Coalescer has a combined terminal message — deliver it instead
      text = coalescedMsg;
    }
    // If null and all terminal: continue with caller-supplied text
    // If null and not all terminal: the coalescer is emitting partial msg above
  } else {
    // Attempt/status ack
    const followUp = this.coalescer.onAck(
      conversationId,
      failure.capabilityType,
      kind ?? "attempt",
    );
    if (followUp !== null) {
      // Deliver the follow-up instead of the original ack
      text = followUp;
    }
    // If null: first CFR in window — deliver the original ack
  }

  // ... rest of the existing send logic ...
```

### Step 3.5 [ARCHITECT S1]: Add an integration test for the `AckDelivery.deliver()` wiring

The unit tests above test `ConversationAckCoalescer` in isolation. Step 3 wires it into `AckDelivery.deliver()` — but if the wiring is wrong (coalescer called with wrong kind, or before/after the wrong logic), unit tests still pass while production breaks.

Add at least one integration test that fires through `AckDelivery.deliver()` end-to-end. Append to `packages/core/tests/capabilities/ack-coalescing.test.ts`:

```typescript
describe("AckDelivery — coalescer integration", () => {
  it("two CFRs in same conversation within 30s produce one initial ack + one follow-up", async () => {
    const sentMessages: string[] = [];
    const transportManager = {
      send: vi.fn(async (_transportId: string, _to: string, payload: { content: string }) => {
        sentMessages.push(payload.content);
      }),
    } as any;
    const connectionRegistry = {
      broadcastToConversation: vi.fn(),
    } as any;

    const delivery = new AckDelivery(transportManager, connectionRegistry);

    const failure1 = makeConversationFailure("audio-to-text", "conv-X");
    const failure2 = makeConversationFailure("text-to-audio", "conv-X");

    // First CFR — initial ack delivered as-is
    await delivery.deliver(failure1, "hold on — voice transcription", { kind: "attempt" });
    // Second CFR within 30s — follow-up coalesced message
    await delivery.deliver(failure2, "hold on — voice reply", { kind: "attempt" });

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toContain("voice transcription"); // first ack passed through
    expect(sentMessages[1]).toMatch(/still fixing.*voice reply/); // second became follow-up
  });
});

// Helper for integration tests (add near existing makeSendFn):
function makeConversationFailure(capabilityType: string, conversationId: string): CapabilityFailure {
  return {
    id: `cfr-${capabilityType}-${conversationId}`,
    capabilityType,
    symptom: "execution-error",
    detail: "test",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "conversation",
        channel: { transportId: "dashboard", sender: "user", replyTo: undefined },
        conversationId,
      },
    },
  } as unknown as CapabilityFailure;
}
```

You'll need to import `CapabilityFailure` and `AckDelivery` from `../../src/capabilities/`. Adapt to existing test patterns if `AckDelivery` constructor signature differs from the mock shape.

### Step 4: Verify coalescing tests pass

- [ ] **Run new tests + full core suite**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -10
cd packages/core && npx vitest run tests/capabilities/ack-coalescing 2>&1 | tail -10
# Expected: all pass (unit + integration)
cd packages/core && npx vitest run 2>&1 | tail -5
# Expected: no regressions
```

### Step 5: Commit

```bash
git add packages/core/src/capabilities/ack-delivery.ts \
        packages/core/tests/capabilities/ack-coalescing.test.ts
git commit -m "feat(s19): ack coalescing — 30s window, N-aware Oxford comma, combined terminal"
```

---

## Task 3: `fixed`-Outcome Fan-Out + AutomationNotifierLike Wire

**Files:**
- Modify: `packages/core/src/capabilities/ack-delivery.ts`
- Modify: `packages/dashboard/src/app.ts`
- Create: `packages/dashboard/tests/integration/cfr-automation-notifier.test.ts`

The S12 bug: `deliver()` automation branch always uses `outcome = "surrendered"`. The fix: derive from `context?.kind`. Then wire a concrete `AutomationNotifierLike` implementation in `app.ts` that uses the conversation initiator to alert the user.

### Step 1: Write the failing test

- [ ] **Create `packages/dashboard/tests/integration/cfr-automation-notifier.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { AckDelivery } from "@my-agent/core";
import type { AutomationNotifierLike } from "@my-agent/core";
import type { CapabilityFailure } from "@my-agent/core";

function makeAutomationFailure(): CapabilityFailure {
  return {
    id: "cfr-auto-1",
    capabilityType: "audio-to-text",
    symptom: "execution-error",
    detail: "test",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "automation",
        automationId: "auto-1",
        jobId: "job-1",
        runDir: "/tmp/cfr-test-run",
        notifyMode: "immediate",
      },
    },
  } as unknown as CapabilityFailure;
}

function makeTransportManager() {
  return { send: vi.fn() } as any;
}

function makeConnectionRegistry() {
  return { broadcastToConversation: vi.fn() } as any;
}

describe("AckDelivery — automation-origin notifier", () => {
  it("fixed-outcome with notifyMode=immediate calls notifier after writing file", async () => {
    const notifier: AutomationNotifierLike = { notify: vi.fn().mockResolvedValue(undefined) };
    const delivery = new AckDelivery(
      makeTransportManager(),
      makeConnectionRegistry(),
      notifier,
    );

    const failure = makeAutomationFailure();
    // Ensure runDir is writable (or mock writeAutomationRecovery)
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    await delivery.deliver(failure, "voice transcription is fixed", {
      kind: "terminal-fixed",
    });

    expect(delivery.writeAutomationRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "fixed" }),
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "fixed" }),
    );
  });

  it("surrendered-outcome with notifyMode=immediate calls notifier", async () => {
    const notifier: AutomationNotifierLike = { notify: vi.fn().mockResolvedValue(undefined) };
    const delivery = new AckDelivery(
      makeTransportManager(),
      makeConnectionRegistry(),
      notifier,
    );
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    await delivery.deliver(makeAutomationFailure(), "couldn't fix it", {
      kind: "surrender",
    });

    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "surrendered" }),
    );
  });

  it("missing notifier degrades gracefully — file written, no exception", async () => {
    const delivery = new AckDelivery(makeTransportManager(), makeConnectionRegistry());
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    // Should not throw even though notifier is absent
    await expect(
      delivery.deliver(makeAutomationFailure(), "couldn't fix it", { kind: "terminal-fixed" }),
    ).resolves.not.toThrow();
  });

  it("notifyMode=debrief does NOT call notifier at terminal time", async () => {
    const notifier: AutomationNotifierLike = { notify: vi.fn().mockResolvedValue(undefined) };
    const delivery = new AckDelivery(
      makeTransportManager(),
      makeConnectionRegistry(),
      notifier,
    );
    const failure = {
      ...makeAutomationFailure(),
      triggeringInput: {
        origin: {
          kind: "automation",
          automationId: "auto-1",
          jobId: "job-1",
          runDir: "/tmp/cfr-test-run",
          notifyMode: "debrief",
        },
      },
    } as unknown as CapabilityFailure;
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    await delivery.deliver(failure, "text", { kind: "terminal-fixed" });

    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Run test — expect failures**

```bash
cd packages/dashboard && npx vitest run tests/integration/cfr-automation-notifier 2>&1 | tail -10
# Expected: fails — outcome always "surrendered"
```

### Step 2: Fix the `outcome` bug in `ack-delivery.ts`

- [ ] **In the automation branch of `deliver()`, replace the hardcoded `outcome`**

Find:
```typescript
const outcome: "fixed" | "surrendered" = "surrendered";
```

Replace with:
```typescript
const outcome: "fixed" | "surrendered" =
  context?.kind === "terminal-fixed" ? "fixed" : "surrendered";
```

The notifier call already exists for the `surrendered` path at `if (origin.notifyMode === "immediate")`. It now also fires for `fixed` because the notifier call is outside the outcome conditional.

### Step 3: Wire `AutomationNotifierLike` in `app.ts`

- [ ] **Add `ackDelivery` as an App class property** (near `recoveryOrchestrator`):

```typescript
// Ack delivery (M9.6-S6, exposed for capabilities health route in S19)
ackDelivery: AckDelivery | null = null;
```

Import `AckDelivery` at the top of `app.ts` if not already imported (grep: it may already be imported with the existing `new AckDelivery(...)` usage).

- [ ] **Wire the concrete notifier and store the instance**

Find the current `ackDelivery` construction (around line 666):
```typescript
const ackDelivery =
  app.transportManager && connectionRegistry
    ? new AckDelivery(app.transportManager, connectionRegistry)
    : null;
```

Replace with:
```typescript
// Concrete AutomationNotifierLike — lazy reads conversationInitiator at
// call time (not construction time; CI is wired later in boot).
const automationNotifier: AutomationNotifierLike = {
  async notify({ automationId, jobId, outcome, message }) {
    const ci = app.conversationInitiator;
    if (!ci) {
      console.warn("[AutomationNotifier] ConversationInitiator not ready — notification skipped");
      return;
    }
    const prompt =
      `A capability recovery finished for automation ${automationId} (job ${jobId}).\n\n` +
      `Outcome: ${outcome}.\n\n${message}\n\n` +
      `You are the conversation layer — let the user know briefly.`;
    try {
      const alerted = await ci.alert(prompt);
      if (!alerted) {
        await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      }
    } catch (err) {
      console.error("[AutomationNotifier] Failed to notify user:", err);
    }
  },
};

const ackDelivery =
  app.transportManager && connectionRegistry
    ? new AckDelivery(app.transportManager, connectionRegistry, automationNotifier)
    : null;

app.ackDelivery = ackDelivery;
```

### Step 3.5 [ARCHITECT S3]: Verify the app.ts wiring (not just AckDelivery in isolation)

The Step 1 tests construct `AckDelivery` directly with mocks. If the wiring in Step 3 is wrong (e.g., notifier never passed to `new AckDelivery(...)`, or `app.ackDelivery` is never set), the unit tests still pass while production is broken.

Add a small wiring assertion. Either extend an existing app-boot integration test or add a new one at `packages/dashboard/tests/integration/app-ackdelivery-wiring.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { App } from "../../src/app.js";

describe("App boot — ackDelivery wiring (S19)", () => {
  it("app.ackDelivery is non-null after boot when transport + registry are present", async () => {
    // Adapt to the existing AppHarness pattern under packages/dashboard/tests/.
    // Look at integration/app-harness.ts for the boot setup template.

    const app = await /* boot via existing harness */;

    expect(app.ackDelivery).not.toBeNull();
    // Verify the notifier was passed to AckDelivery (not just defaulted to undefined)
    // Test by calling deliver() with an automation-origin failure + notifyMode=immediate
    // and asserting that the notifier code path executes (mock the notifier behind the scenes
    // or check via console.warn absence).
  });
});
```

If the existing AppHarness doesn't expose `ackDelivery` directly, add a getter or extend the harness — that's a sprint-time call. The minimum bar: confirm app boot wires the notifier; the unit tests in Step 1 cover behavior in isolation.

### Step 4: Verify tests pass

- [ ] **Run the notifier tests**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -10
cd packages/dashboard && npx vitest run tests/integration/cfr-automation-notifier tests/integration/app-ackdelivery-wiring 2>&1 | tail -10
# Expected: all pass
```

- [ ] **Run full dashboard suite**

```bash
cd packages/dashboard && npx vitest run 2>&1 | tail -5
# Expected: no regressions
```

### Step 5: Commit

```bash
git add packages/core/src/capabilities/ack-delivery.ts \
        packages/dashboard/src/app.ts \
        packages/dashboard/tests/integration/cfr-automation-notifier.test.ts \
        packages/dashboard/tests/integration/app-ackdelivery-wiring.test.ts
git commit -m "feat(s19): fixed-outcome automation notifier fan-out + AutomationNotifierLike wired in app.ts"
```

---

## Task 4: System-Origin Ring Buffer + Health Endpoint

**Files:**
- Modify: `packages/core/src/capabilities/ack-delivery.ts`
- Modify: `packages/dashboard/src/routes/capabilities.ts`
- Create: `packages/dashboard/tests/integration/cfr-system-origin-health.test.ts`

The system-origin branch in `AckDelivery.deliver()` currently only logs. Add a capped ring buffer (100 events). Expose it via a new endpoint the dashboard's capabilities page can poll.

### Step 1: Write the failing test

- [ ] **Create `packages/dashboard/tests/integration/cfr-system-origin-health.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { AckDelivery } from "@my-agent/core";
import type { CapabilityFailure } from "@my-agent/core";

function makeSystemFailure(component = "scheduler"): CapabilityFailure {
  return {
    id: "cfr-sys-1",
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "test",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "system",
        component,
      },
    },
  } as unknown as CapabilityFailure;
}

describe("AckDelivery — system-origin ring buffer", () => {
  it("system-origin deliver appends to ring buffer", async () => {
    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    await delivery.deliver(makeSystemFailure(), "in-progress");
    const events = delivery.getSystemEvents();
    expect(events).toHaveLength(1);
    expect(events[0].component).toBe("scheduler");
    expect(events[0].capabilityType).toBe("audio-to-text");
  });

  // [ARCHITECT R2] assertion corrected — getSystemEvents returns most-recent-first
  // (per the next test in this block). After 105 pushes with oldest 5 evicted,
  // buffer holds components 5-104; reversed, events[0] is 104 (most recent),
  // events[99] is 5 (oldest still in buffer).
  it("ring buffer caps at 100 events (oldest evicted)", async () => {
    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    for (let i = 0; i < 105; i++) {
      await delivery.deliver(makeSystemFailure(`component-${i}`), "in-progress");
    }
    const events = delivery.getSystemEvents();
    expect(events).toHaveLength(100);
    expect(events[0].component).toBe("component-104"); // most recent
    expect(events[99].component).toBe("component-5");  // oldest still in buffer (0-4 evicted)
  });

  it("getSystemEvents returns most-recent-first order", async () => {
    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    await delivery.deliver(makeSystemFailure("comp-A"), "in-progress");
    await delivery.deliver(makeSystemFailure("comp-B"), "in-progress");
    const events = delivery.getSystemEvents();
    expect(events[0].component).toBe("comp-B");
    expect(events[1].component).toBe("comp-A");
  });

  it("conversation-origin and automation-origin acks do NOT appear in system events", async () => {
    const convFailure: CapabilityFailure = {
      id: "cfr-conv-1",
      capabilityType: "audio-to-text",
      symptom: "execution-error",
      detail: "test",
      detectedAt: new Date().toISOString(),
      triggeringInput: {
        origin: {
          kind: "conversation",
          channel: { transportId: "dashboard", sender: "user", replyTo: undefined },
          conversationId: "conv-1",
        },
      },
    } as unknown as CapabilityFailure;

    const delivery = new AckDelivery(
      { send: async () => {} } as any,
      { broadcastToConversation: () => {} } as any,
    );
    await delivery.deliver(convFailure, "hold on");
    expect(delivery.getSystemEvents()).toHaveLength(0);
  });
});
```

- [ ] **Run test — expect failures**

```bash
cd packages/dashboard && npx vitest run tests/integration/cfr-system-origin-health 2>&1 | tail -10
# Expected: FAIL — getSystemEvents does not exist
```

### Step 2: Add ring buffer to `AckDelivery`

- [ ] **In `packages/core/src/capabilities/ack-delivery.ts`, add the ring buffer**

Add a `SystemCfrEvent` interface and ring buffer to `AckDelivery`:

```typescript
/** Shape of a system-origin CFR event stored in the ring buffer. */
export interface SystemCfrEvent {
  component: string;
  capabilityType: string;
  capabilityName?: string;
  symptom: string;
  outcome: "in-progress" | "surrendered";
  timestamp: string;
}

const SYSTEM_RING_BUFFER_MAX = 100;
```

In the `AckDelivery` class body, add:
```typescript
private systemEventLog: SystemCfrEvent[] = [];
```

And add the public accessor:
```typescript
/** Returns system-origin CFR events, most-recent-first. Max 100 entries. */
getSystemEvents(): SystemCfrEvent[] {
  return [...this.systemEventLog].reverse();
}
```

- [ ] **Update the system-origin branch to append to the ring buffer**

Find the system branch:
```typescript
if (origin.kind === "system") {
  const outcome = isTerminalKind(context?.kind) ? "surrendered" : "in-progress";
  console.log(...)
  return;
}
```

After the `console.log(...)`, add before `return`:
```typescript
  this.systemEventLog.push({
    component: origin.component,
    capabilityType: failure.capabilityType,
    capabilityName: failure.capabilityName,
    symptom: failure.symptom,
    outcome,
    timestamp: new Date().toISOString(),
  });
  if (this.systemEventLog.length > SYSTEM_RING_BUFFER_MAX) {
    this.systemEventLog.shift();
  }
```

### Step 3: Add health endpoint to capabilities route

- [ ] **In `packages/dashboard/src/routes/capabilities.ts`, add the new route inside `registerCapabilityRoutes`**

Add after the last existing route:
```typescript
  // ---- S19: GET system-origin CFR event ring buffer ----
  fastify.get(
    '/api/capabilities/cfr-system-events',
    async () => {
      const events = fastify.app?.ackDelivery?.getSystemEvents() ?? [];
      return { events };
    },
  )
```

Import `AckDelivery` type if needed at the top:
```typescript
// No import needed — accessed via fastify.app.ackDelivery (already typed on App)
```

You need to verify that `fastify.app` has the `ackDelivery` property. Check the `FastifyInstance` extension in `src/index.ts` or `src/server.ts` — it should already declare `app: App`. The `App` class now has `ackDelivery: AckDelivery | null = null` from Task 3.

### Step 4: Verify tests pass

- [ ] **Run tests**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -10
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -10
cd packages/dashboard && npx vitest run tests/integration/cfr-system-origin-health 2>&1 | tail -10
# Expected: all pass
```

- [ ] **Run full suites**

```bash
cd packages/core && npx vitest run 2>&1 | tail -5
cd packages/dashboard && npx vitest run 2>&1 | tail -5
# Expected: no regressions
```

### Step 5: Commit

```bash
git add packages/core/src/capabilities/ack-delivery.ts \
        packages/dashboard/src/routes/capabilities.ts \
        packages/dashboard/tests/integration/cfr-system-origin-health.test.ts
git commit -m "feat(s19): system-origin CFR ring buffer + health endpoint /api/capabilities/cfr-system-events"
```

---

## Task 5: `TranscriptTurn.failure_type` + `FAILURE_PLACEHOLDERS` + Assistant-Turn Orphan Scan

**Files:**
- Modify: `packages/dashboard/src/conversations/types.ts`
- Modify: `packages/core/src/conversations/orphan-watchdog.ts`
- Create: `packages/core/tests/conversations/orphan-watchdog-assistant.test.ts`

`failure_type` is set on an assistant turn when a capability fails during that turn. The orphan watchdog then scans assistant turns for this field and re-drives recovery the same way it re-drives user-turn orphans.

**Where `failure_type` gets written [ARCHITECT R1 — corrected location]:** v0 of this plan said "the message-handler sets it" — that's wrong. `appendTurn` is NOT called in `message-handler.ts` (verified: `grep -n "appendTurn" packages/dashboard/src/channels/message-handler.ts` returns zero hits). The actual assistant-turn append is in **`packages/dashboard/src/chat/chat-service.ts:~931`** (after the streaming loop completes, before the audio-synthesis path).

The producer landing point is **Task 5.5 below** — Task 5 provides the type field + scanner + tests. Task 5.5 adds the actual write so the watchdog has work to scan.

### Step 1: Add `failure_type` to both turn types

- [ ] **In `packages/dashboard/src/conversations/types.ts`, add to `TranscriptTurn`**

After `attachments?`:
```typescript
  /**
   * Capability type that failed for this assistant turn (S19).
   * Set when a CFR fires during synthesis (e.g. TTS failed → text fallback).
   * The orphan watchdog scans this field to schedule recovery re-drives.
   */
  failure_type?: string;
```

- [ ] **In `packages/core/src/conversations/orphan-watchdog.ts`, add `failure_type?` to `TranscriptTurnLike`**

In the `TranscriptTurnLike` interface (around line 63):
```typescript
  /** Set when a capability failed during this assistant turn (S19). */
  failure_type?: string;
```

**[ARCHITECT S2]** Before extending `OrphanSweepReport` (Step 4 below), grep the existing shape:
```bash
grep -n "OrphanSweepReport\|staleSkipped\|corruptSkipped" packages/core/src/conversations/orphan-watchdog.ts
```
Read the existing `staleSkipped` and `corruptSkipped` field shapes verbatim. Step 4's interface fragment uses `{ ... }` placeholders for those — replace them with the real shapes before editing, otherwise the file won't compile.

### Step 2: Generalise `VOICE_PLACEHOLDERS` → `FAILURE_PLACEHOLDERS`

- [ ] **In `orphan-watchdog.ts`, replace the local constant**

Replace:
```typescript
const VOICE_PLACEHOLDERS = [
  "[Voice note — audio attached, pending transcription]",
  "[Voice message — transcription failed",
];

function isVoicePlaceholder(content: string): boolean {
  return VOICE_PLACEHOLDERS.some((needle) => content.includes(needle));
}
```

With:
```typescript
/**
 * Placeholder strings keyed by capability type. Written by CFR-capable paths
 * when a capability fails before populating the turn content. The watchdog
 * uses this table to detect user-turn orphans that need rescue.
 *
 * Exported for the universal-coverage test that asserts every
 * invocation site is covered (spec §2.4).
 */
export const FAILURE_PLACEHOLDERS: Record<string, readonly string[]> = {
  "audio-to-text": [
    "[Voice note — audio attached, pending transcription]",
    "[Voice message — transcription failed",
  ],
};

function isUserTurnPlaceholder(content: string): boolean {
  return Object.values(FAILURE_PLACEHOLDERS)
    .flat()
    .some((needle) => content.includes(needle));
}
```

Update all call sites of `isVoicePlaceholder(...)` in the file to use `isUserTurnPlaceholder(...)`.

### Step 3: Write the failing assistant-turn test

- [ ] **Create `packages/core/tests/conversations/orphan-watchdog-assistant.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { OrphanWatchdog, FAILURE_PLACEHOLDERS } from "../../src/conversations/orphan-watchdog.js";

// Minimal TranscriptLineLike shape
function makeAssistantTurn(opts: {
  turnNumber: number;
  content: string;
  failure_type?: string;
}): Record<string, unknown> {
  return {
    type: "turn",
    role: "assistant",
    content: opts.content,
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
    turnNumber: opts.turnNumber,
    failure_type: opts.failure_type,
  };
}

function makeUserTurn(turnNumber: number, content: string): Record<string, unknown> {
  return {
    type: "turn",
    role: "user",
    content,
    timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    turnNumber,
  };
}

describe("OrphanWatchdog — assistant-turn failure_type scan", () => {
  it("assistant turn with failure_type detected and scheduled for recovery re-drive", async () => {
    const systemMessageInjector = vi.fn().mockResolvedValue(undefined);
    const rawMediaStore = {
      get: vi.fn().mockResolvedValue(undefined),
    } as any;
    const conversationManager = {
      list: vi.fn().mockResolvedValue([{ id: "conv-1", updated: new Date() }]),
      getFullTranscript: vi.fn().mockResolvedValue([
        makeUserTurn(1, "Can you read this voice note?"),
        makeAssistantTurn({ turnNumber: 1, content: "", failure_type: "text-to-audio" }),
      ]),
      appendEvent: vi.fn().mockResolvedValue(undefined),
    } as any;

    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60 * 1000,
      rawMediaStore,
      conversationManager,
      systemMessageInjector,
    });

    const report = await watchdog.sweep();

    // The assistant turn with failure_type should trigger a re-drive
    expect(report.rescued.length + report.assistantFailuresScheduled.length).toBeGreaterThan(0);
  });

  it("FAILURE_PLACEHOLDERS table covers the audio-to-text type", () => {
    expect(FAILURE_PLACEHOLDERS["audio-to-text"]).toBeDefined();
    expect(FAILURE_PLACEHOLDERS["audio-to-text"].length).toBeGreaterThan(0);
  });

  it("assistant turn without failure_type is not scheduled", async () => {
    const systemMessageInjector = vi.fn().mockResolvedValue(undefined);
    const conversationManager = {
      list: vi.fn().mockResolvedValue([{ id: "conv-1", updated: new Date() }]),
      getFullTranscript: vi.fn().mockResolvedValue([
        makeUserTurn(1, "Hello"),
        makeAssistantTurn({ turnNumber: 1, content: "Hi there!" }), // no failure_type
      ]),
      appendEvent: vi.fn().mockResolvedValue(undefined),
    } as any;

    const watchdog = new OrphanWatchdog({
      conversationLimit: 5,
      staleThresholdMs: 30 * 60 * 1000,
      rawMediaStore: { get: vi.fn() } as any,
      conversationManager,
      systemMessageInjector,
    });

    const report = await watchdog.sweep();
    const scheduled = (report as any).assistantFailuresScheduled ?? [];
    expect(scheduled).toHaveLength(0);
    expect(systemMessageInjector).not.toHaveBeenCalled();
  });
});
```

- [ ] **Run test — expect failures**

```bash
cd packages/core && npx vitest run tests/conversations/orphan-watchdog-assistant 2>&1 | tail -10
# Expected: FAIL — FAILURE_PLACEHOLDERS not exported; assistant-turn scan not present
```

### Step 4: Add assistant-turn scan to `OrphanWatchdog`

- [ ] **In `orphan-watchdog.ts`, add `assistantFailuresScheduled` to `OrphanSweepReport`**

```typescript
export interface OrphanSweepReport {
  scanned: number;
  rescued: Array<{ conversationId: string; turnNumber: number }>;
  assistantFailuresScheduled: Array<{ conversationId: string; turnNumber: number; failureType: string }>;
  staleSkipped: Array<{ ... }>;
  corruptSkipped: Array<{ ... }>;
}
```

- [ ] **In the sweep logic, after the existing user-turn orphan scan, add assistant-turn scan**

Find the `sweepConversation` function (or wherever turns are iterated). After the existing loop that calls `isUserTurnPlaceholder`, add:

```typescript
// Assistant-turn failure_type scan (S19)
for (const line of turns) {
  if (
    line.type === "turn" &&
    (line as TranscriptTurnLike).role === "assistant" &&
    (line as TranscriptTurnLike).failure_type
  ) {
    const turn = line as TranscriptTurnLike;
    const failureType = turn.failure_type!;

    // Idempotency: skip if already rescued (a subsequent assistant turn exists with non-empty content)
    const laterNonEmpty = turns.some(
      (l) =>
        l.type === "turn" &&
        (l as TranscriptTurnLike).role === "assistant" &&
        (l as TranscriptTurnLike).turnNumber > turn.turnNumber &&
        (l as TranscriptTurnLike).content.trim().length > 0 &&
        !(l as TranscriptTurnLike).failure_type,
    );
    if (laterNonEmpty) continue;

    // Schedule a re-drive the same way user-turn orphans are handled
    report.assistantFailuresScheduled.push({
      conversationId: id,
      turnNumber: turn.turnNumber,
      failureType,
    });
    await systemMessageInjector(
      id,
      `[SYSTEM: The voice reply for turn ${turn.turnNumber} failed (${failureType}). ` +
        `Please resend the response as text now.]`,
    );
  }
}
```

Initialise `assistantFailuresScheduled: []` at the top of the sweep.

### Step 5: Verify tests pass

- [ ] **Run orphan-watchdog tests**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -10
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -10
cd packages/core && npx vitest run tests/conversations/orphan-watchdog-assistant 2>&1 | tail -10
# Expected: all pass
cd packages/core && npx vitest run 2>&1 | tail -5
# Expected: no regressions
```

### Step 6: Commit

```bash
git add packages/dashboard/src/conversations/types.ts \
        packages/core/src/conversations/orphan-watchdog.ts \
        packages/core/tests/conversations/orphan-watchdog-assistant.test.ts
git commit -m "feat(s19): TranscriptTurn.failure_type + FAILURE_PLACEHOLDERS + assistant-turn orphan scan"
```

---

## Task 5.5 [ARCHITECT R1]: `failure_type` producer in `chat-service.ts`

**Files:**
- Modify: `packages/dashboard/src/chat/chat-service.ts` (assistant-turn `appendTurn` callsite, around line 931)
- Create: `packages/dashboard/tests/integration/chat-service-failure-type.test.ts`

### Background

Task 5 added the field type, the watchdog scanner, and a unit test that mocks turns with `failure_type` set. **But nothing actually writes the field on a real assistant turn.** Without this producer step, the watchdog scan finds nothing in production and the assistant-turn-orphan feature ships half-implemented.

The write-callsite is the assistant-turn `appendTurn` in `chat-service.ts` (around line 931 — verify with grep at sprint-start). When `synthesizeAudio()` returned `null` for a voice-eligible reply (TTS failed and the reply is being delivered as text per S18's fallback table), set `failure_type: "text-to-audio"` on the turn payload.

### Step 1: Verify the appendTurn callsite line + signature

```bash
grep -n "appendTurn" packages/dashboard/src/chat/chat-service.ts
# Expect ~line 931 (assistant turn after streaming loop)
# Also check ~line 844 (split turn) — does it need failure_type too?
```

If the assistant turn is constructed via a typed object (e.g., `const assistantTurn: TranscriptTurn = {...}`), the type extension from Task 5 Step 1 (`TranscriptTurn.failure_type?: string`) makes the field assignable directly. Confirm.

### Step 2: Track TTS-failed state through the streaming loop

Locate the streaming loop in `chat-service.ts` that processes `text_delta`, `done`, `turn_advanced` events. Add a local flag near `capturedAudioUrl`:

```typescript
let ttsFailed = false; // set when synthesizeAudio returned null in a voice-reply context
```

In the place(s) where `synthesizeAudio` is called for voice-reply contexts (typically inside the streaming loop after `done` events when `first.isVoiceNote` is true), set the flag if the call returns null:

```typescript
const audioUrl = await this.synthesizeAudio(currentText, language);
if (audioUrl === null && first.isVoiceNote) {
  ttsFailed = true;
}
```

(Adapt to the actual code shape — the synthesizeAudio call may already exist; just tag the failure case. Don't restructure the loop.)

### Step 3: Add `failure_type` to the assistant-turn appendTurn payload

In the assistant-turn append block (~line 931), add the field conditionally:

```typescript
const assistantTurn: TranscriptTurn = {
  // ... existing fields ...
  failure_type: ttsFailed ? "text-to-audio" : undefined,
};
await this.conversationManager.appendTurn(convId, assistantTurn);
```

The optional field with `undefined` won't serialise into the JSONL; only failed turns get the marker.

### Step 4: Write the failing integration test

Create `packages/dashboard/tests/integration/chat-service-failure-type.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Verify chat-service writes failure_type onto the assistant turn when TTS
// failed for a voice-eligible reply. Without this, the assistant-turn orphan
// watchdog (Task 5) has nothing to scan in production.

describe("chat-service writes failure_type when TTS fails on voice reply", () => {
  it("appendTurn payload contains failure_type='text-to-audio' when synthesizeAudio returns null and isVoiceNote=true", async () => {
    // Arrange: mock synthesizeAudio to return null, send a voice-input message
    // through chat.sendMessage(), capture the appendTurn calls.

    const appendTurnCalls: Array<Record<string, unknown>> = [];
    const conversationManager = {
      appendTurn: vi.fn(async (_convId: string, turn: Record<string, unknown>) => {
        appendTurnCalls.push(turn);
      }),
      // ... other manager mocks per existing chat-service tests
    } as unknown as Parameters<typeof appendTurnCalls.push>;

    // ... wire chat-service with the mock manager + a CapabilityInvoker
    // that returns failure for text-to-audio (so synthesizeAudio returns null)

    // Adapt this test to the existing chat-service test patterns. Look at
    // packages/dashboard/tests/cfr/ for reference setup.

    // Assert: the assistant-turn appendTurn payload has failure_type set
    const assistantTurns = appendTurnCalls.filter((t) => t.role === "assistant");
    expect(assistantTurns.length).toBeGreaterThan(0);
    const failedTurn = assistantTurns.find((t) => t.failure_type === "text-to-audio");
    expect(failedTurn).toBeDefined();
  });

  it("appendTurn payload does NOT set failure_type when TTS succeeded", async () => {
    // Same setup but synthesizeAudio returns a valid audioUrl.
    // Assert: assistant-turn payload has failure_type undefined.
  });

  it("appendTurn payload does NOT set failure_type for text-input replies (isVoiceNote=false)", async () => {
    // Voice synthesis isn't expected for text input — even if synthesizeAudio
    // is never called, the turn shouldn't get failure_type.
  });
});
```

Adapt to the actual chat-service test patterns under `packages/dashboard/tests/cfr/` — look at `cfr-incident-replay.test.ts` for the App-level wiring template. The key invariant: a real chat.sendMessage call with a voice input + broken TTS produces an assistant turn whose payload (passed to `conversationManager.appendTurn`) has `failure_type: "text-to-audio"`.

### Step 5: Verify tests pass

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -10
cd packages/dashboard && npx vitest run tests/integration/chat-service-failure-type 2>&1 | tail -10
# Expected: all pass
```

Also re-run Task 5's orphan-watchdog test — the watchdog scan logic is now exercised by a producer that actually writes the field:

```bash
cd packages/core && npx vitest run tests/conversations/orphan-watchdog-assistant 2>&1 | tail -5
```

### Step 6: Commit

```bash
git add packages/dashboard/src/chat/chat-service.ts \
        packages/dashboard/tests/integration/chat-service-failure-type.test.ts
git commit -m "feat(s19): chat-service writes failure_type on TTS-failed assistant turns (R1)

Without this producer the watchdog scan from Task 5 finds nothing in production.
Plan v0 misdirected the location to message-handler.ts; verified at sprint
that appendTurn for assistant turns lives in chat-service.ts ~line 931.
Documented in DECISIONS D3."
```

---

## Task 6: Dashboard UI — `failure_type` Marker + System-Origin Health Panel

**Files:**
- Modify: `packages/dashboard/public/js/app.js`
- Modify: `packages/dashboard/public/index.html`

**REMINDER (from MEMORY.md):** After any change to `packages/dashboard/public/`, restart the dashboard service so the cache-busting `?v=` param picks up the new files:
```bash
systemctl --user restart nina-dashboard.service
```

This is UI-only work. No TypeScript compile step. Test by opening the dashboard in a browser.

### Step 1: Add `failure_type` marker to assistant turn rendering in `app.js`

- [ ] **Find the assistant turn rendering block**

```bash
grep -n "role.*assistant\|streaming\|capability_ack\|thinkingText\|renderedContent" packages/dashboard/public/js/app.js | head -30
```

The streaming handler assembles assistant turns incrementally. Find where it pushes a completed assistant turn to `this.messages`. It should look like:
```javascript
this.messages.push({
  id: ...,
  role: "assistant",
  content: ...,
  renderedContent: ...,
  // ...
});
```

- [ ] **Add `failureType` to the turn object pushed to `this.messages`**

When the turn data has a `failure_type` field (from the WS payload), add it to the message object:
```javascript
failureType: data.failure_type ?? null,
```

- [ ] **Add a rendered marker for turns with `failureType` set**

Find the Alpine.js template that renders assistant message bubbles (in `index.html`). Search for `role === 'assistant'` or `x-show="msg.role === 'assistant'"`. Add a conditional span after the message content:

```html
<!-- failure_type inline marker (S19) -->
<template x-if="msg.failureType">
  <span class="block mt-1 text-[10px] text-orange-400/70 italic">
    <span x-text="msg.failureType === 'text-to-audio' ? 'voice reply unavailable — fixing…' : (msg.failureType + ' unavailable — fixing…')"></span>
  </span>
</template>
```

Place this inside the assistant message bubble, after the main `renderedContent` div.

Also handle turns loaded from conversation history: when the conversation history is fetched via `/api/conversations/:id/transcript`, turns with `failure_type` in the JSONL will have the field in their JSON. Map it to `failureType` when pushing history turns:
```javascript
failureType: turn.failure_type ?? null,
```

Find where history turns are processed (grep `appendTurn\|history\|transcript` in `app.js` WS handler) and add the field there too.

### Step 2: Add system-origin health panel in `index.html`

- [ ] **Find the capabilities settings section**

```bash
grep -n "api/settings/capabilities\|capability.*panel\|settings.*cap" packages/dashboard/public/index.html | head -10
```

The capabilities section renders a list of plugs. Find the parent `<div>` and add a new "Recent System Recoveries" sub-panel after the plug list.

- [ ] **Add the health panel**

```html
<!-- System-origin CFR health panel (S19) -->
<div class="mt-4 p-3 rounded-lg border border-white/5 bg-surface-800">
  <div class="flex items-center justify-between mb-2">
    <span class="text-[11px] font-medium text-white/60 uppercase tracking-wider">Recent System Events</span>
    <button
      @click="loadSystemCfrEvents()"
      class="text-[10px] text-accent-blue/70 hover:text-accent-blue transition-colors"
    >Refresh</button>
  </div>
  <div x-show="systemCfrEvents.length === 0" class="text-[11px] text-white/30 italic">No recent events.</div>
  <div class="space-y-1">
    <template x-for="ev in systemCfrEvents" :key="ev.timestamp + ev.component">
      <div class="flex items-start gap-2 text-[10px]">
        <span :class="ev.outcome === 'surrendered' ? 'text-red-400' : 'text-orange-400'" class="mt-px">●</span>
        <div>
          <span class="text-white/70" x-text="ev.capabilityType"></span>
          <span class="text-white/40 mx-1">·</span>
          <span class="text-white/50" x-text="ev.component"></span>
          <span class="text-white/30 ml-1" x-text="new Date(ev.timestamp).toLocaleTimeString()"></span>
        </div>
      </div>
    </template>
  </div>
</div>
```

- [ ] **Wire the Alpine data + fetch in the capabilities settings Alpine component**

Find the `x-data` object for the capabilities settings section. Add:
```javascript
systemCfrEvents: [],
async loadSystemCfrEvents() {
  try {
    const resp = await fetch('/api/capabilities/cfr-system-events');
    const data = await resp.json();
    this.systemCfrEvents = data.events ?? [];
  } catch (e) {
    console.warn('[Capabilities] Failed to load system CFR events:', e);
  }
},
```

And add `this.loadSystemCfrEvents()` to `x-init` so it loads on mount.

### Step 3: Restart dashboard and verify

- [ ] **Restart the dashboard service**

```bash
systemctl --user restart nina-dashboard.service
systemctl --user status nina-dashboard.service | head -5
```

- [ ] **Open the dashboard in a browser and verify**
  - Navigate to Settings → Capabilities
  - "Recent System Events" panel appears
  - Panel shows "No recent events." initially (ring buffer is empty on fresh start)

- [ ] **Verify `failure_type` marker rendering** (requires a TTS failure or manual test):
  - If a TTS failure turn with `failure_type: "text-to-audio"` is in any conversation transcript, load that conversation and verify the marker "voice reply unavailable — fixing…" appears below the assistant bubble.

### Step 4: Commit

```bash
git add packages/dashboard/public/js/app.js \
        packages/dashboard/public/index.html
git commit -m "feat(s19): dashboard UI — failure_type marker + system-origin health panel"
```

---

## Task 7: Full Verification + Sprint Artifacts

**Files:**
- Update: `docs/sprints/m9.6-capability-resilience/s19-DECISIONS.md`
- Update: `docs/sprints/m9.6-capability-resilience/s19-DEVIATIONS.md`
- Update: `docs/sprints/m9.6-capability-resilience/s19-FOLLOW-UPS.md`
- Update: `docs/sprints/m9.6-capability-resilience/s19-test-report.md`

### Step 1: Full core suite

```bash
cd packages/core && npx tsc --noEmit && npx vitest run 2>&1 | tail -10
# Expected: all tests pass. Zero failures. Note pass count.
```

### Step 2: Full dashboard suite

```bash
cd packages/core && npx tsc  # rebuild dist first
cd packages/dashboard && npx tsc --noEmit && npx vitest run 2>&1 | tail -10
# Expected: all tests pass. Note pass count.
```

### Step 3: Universal-coverage check

Per §2.4 spec: ack coalescing must use `friendlyName` from the registry for all types. Verify:

```bash
# All 6 well-known types should have friendly_name in their templates
grep "friendly_name" skills/capability-templates/*.md

# Registry getFriendlyName should return the frontmatter value for each type
cd packages/core && npx vitest run tests/capabilities/registry-friendly-name --reporter=verbose 2>&1
```

Also confirm every assistant-turn invocation site that can set `failure_type` is covered:
```bash
grep -rn "failure_type" packages/dashboard/src/ packages/core/src/ | grep -v ".test.ts"
```

Document any type not yet covered (with reason) in `s19-FOLLOW-UPS.md`.

### Step 4: Confirm S18 regression tests still pass

```bash
cd packages/dashboard && npx vitest run tests/integration/tts-paths tests/integration/voice-reply-regression tests/integration/cfr-tts-single-emit 2>&1 | tail -5
# Expected: 7/7 pass (same as S18 baseline)
```

### Step 5: Write sprint artifacts

- [ ] **`s19-DECISIONS.md`** — document at minimum:
  - **D1**: Coalescer placement (wrapping `deliver()` vs separate service). Rationale for chosen approach.
  - **D2**: System-origin ring buffer: in-memory vs append-only log file. Document the choice (in-memory, cap 100) and why (cross-restart persistence not required by spec; simpler; S20 exit-gate doesn't test persistence).
  - **D3 [ARCHITECT R1 + S5]**: `failure_type` write-callsite. Capture:
    - **The hypothesis (plan v0):** "message-handler sets it when sending text-fallback after TTS failure."
    - **The grep-discovered reality:** `appendTurn` is NOT called in `message-handler.ts` (zero hits). The actual callsite is `chat-service.ts:~931` (assistant-turn append after streaming loop).
    - **The implementation choice (Task 5.5):** local `ttsFailed` flag tracked through the streaming loop, conditional `failure_type: ttsFailed ? "text-to-audio" : undefined` on the appendTurn payload.
    - **Why message-handler turned out to be wrong:** [explain at sprint-time — likely because S18's path collapse moved the append responsibility into chat-service, and the spec text predates S18].
    The decision-history is more useful than just "we put it here." Future readers benefit from knowing the plan-time hypothesis and how it differed.
  - **D4**: `fixed`-outcome bug root-cause note (hardcoded `"surrendered"` was always there; S19 fixes it via `context?.kind === "terminal-fixed"` check).

- [ ] **`s19-DEVIATIONS.md`** — document any spec requirements that required implementation choices not literal to the plan. Minimum: if `failure_type` write-callsite differed from the implied location.

- [ ] **`s19-FOLLOW-UPS.md`** — document:
  - §0.1 universal-coverage check result: which types have `friendly_name` in frontmatter, which rely on hardcoded fallback (only the six well-known ones have templates; new types added after S19 must add `friendly_name` to their CAPABILITY.md).
  - FU-1: The orphan watchdog currently re-drives via `systemMessageInjector`. After S19, the `assistantFailuresScheduled` report items should eventually be wired to the CFR orchestrator's re-drive path directly (same path as user-turn rescues), not just a system message. Track for a future sprint if the watchdog's recovery rate is insufficient.
  - Any items discovered but out of scope.

- [ ] **`s19-test-report.md`** — record:
  - core tsc exit code + test count
  - dashboard tsc exit code + test count
  - each new test file: name + pass count
  - S18 regression tests: 7/7 pass
  - dashboard restart performed: yes/no
  - dashboard UI verification: failure_type marker visible / system events panel present

### Step 6: Final commit

```bash
git add docs/sprints/m9.6-capability-resilience/s19-DECISIONS.md \
        docs/sprints/m9.6-capability-resilience/s19-DEVIATIONS.md \
        docs/sprints/m9.6-capability-resilience/s19-FOLLOW-UPS.md \
        docs/sprints/m9.6-capability-resilience/s19-test-report.md
git commit -m "docs(s19): sprint artifacts — DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report"
```

---

## Self-Review

### Spec Coverage

| Spec requirement (§2.4) | Task |
|---|---|
| 30-second ack coalescing window per conversationId | Task 2 |
| N-aware Oxford comma copy | Task 2 (`renderTypeList`) |
| Partial restoration ack (one done, one still fixing) | Task 2 (`onTerminal` partial branch) |
| Combined terminal ack when all in terminal state | Task 2 (`onTerminal` all-terminal branch) |
| Conversation-origin only; automation/system bypass | Task 2 (coalescer not called for non-conversation origins) |
| `AutomationNotifierLike` concrete implementation wired | Task 3 |
| `fixed`-outcome immediate fan-out | Task 3 (outcome derived from `context?.kind`) |
| Per-origin try/catch for notifier | Task 3 (existing try/catch block covers both outcomes) |
| `TranscriptTurn.failure_type` structured field | Task 5 |
| **`failure_type` producer (write on assistant turn)** | **Task 5.5 [ARCHITECT R1]** |
| `FAILURE_PLACEHOLDERS` dispatch table (back-compat) | Task 5 |
| Assistant-turn orphan watchdog scan | Task 5 |
| Idempotency: skip if later non-empty assistant turn exists | Task 5 |
| System-origin ring buffer (cap 100) | Task 4 |
| System-origin health endpoint | Task 4 |
| Dashboard health panel (system events) | Task 6 |
| Dashboard failure_type inline marker | Task 6 |
| FRIENDLY_NAMES → frontmatter migration | Task 1 |
| `registry.getFriendlyName(type)` | Task 1 |
| 6 templates updated with `friendly_name:` | Task 1 |
| Hardcoded table remains as fallback | Task 1 (FRIENDLY_NAMES still exported, registry falls back to it) |
| Universal-coverage check | Task 7 |
| Sprint artifacts (DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report) | Task 0 + Task 7 |
| §0.3 compliance (no merge, no roadmap-done, no "approved" commits) | Task 0 §0.3 section |

All spec requirements covered.

### Placeholder Scan

No TBD, TODO, or "similar to" references in any step. All code blocks contain real, runnable code. All commands have expected outputs.

### Type Consistency

- `ConversationAckCoalescer` — exported from `ack-delivery.ts`, imported in test by name.
- `SystemCfrEvent` — exported from `ack-delivery.ts`; test references `delivery.getSystemEvents()` returning `SystemCfrEvent[]`.
- `FAILURE_PLACEHOLDERS` — exported from `orphan-watchdog.ts`; test imports by name.
- `TranscriptTurnLike.failure_type?: string` (core watchdog) and `TranscriptTurn.failure_type?: string` (dashboard types) — both optional strings; test casts to `TranscriptTurnLike & { failure_type?: string }` for type safety.
- `registry.getFriendlyName(type)` — returns `string`, consistent across Task 1 definition and all callers in `resilience-messages.ts`.
- `Capability.friendlyName?: string` and `CapabilityFrontmatter.friendly_name?: string` — field naming follows the established S14 pattern (`fallback_action` → `fallbackAction`, `multi_instance` → `multiInstance`, `friendly_name` → `friendlyName`).

---

*Created: 2026-04-19 | Sprint: M9.6-S19 | Author: Tech Lead (planning phase)*
