# M9.1-S7: Infrastructure Fixes + Integration Test

**Goal:** Fix 3 infrastructure bugs from M9-S8 and validate the full agentic chain with an E2E integration test before the live test in S8.

**Branch:** `sprint/m9.1-s7-infra-fixes`
**Design spec:** `docs/design/agentic-flow-overhaul.md`
**Implementation plan:** `docs/plans/2026-04-05-agentic-flow-overhaul.md` (Sprint 7 section)

---

## Tasks

### 7.1: Scanner loudness

**Files:** `packages/core/src/capabilities/scanner.ts`, `packages/core/src/capabilities/types.ts`

Currently the scanner silently skips malformed CAPABILITY.md files (empty catch block). Change to push an invalid capability object with error details so the framework and paper trail can see what went wrong.

- Add `'invalid'` to `CapabilityStatus` type union
- Add `error?: string` field to `Capability` interface
- In scanner catch block: push `{ name: null, path: capDir, status: 'invalid', error: ... }` instead of skipping

### 7.2: findById from disk (verify pre-fixed)

**Files:** `packages/dashboard/src/automations/automation-manager.ts`

The original bug: `findById()` read from SQLite (which stores empty `instructions`). Current code already delegates to `read()` which reads from disk via `readFrontmatter()`. Verify and document — no code change expected.

### 7.3: target_path from manifest

**Files:** `packages/dashboard/src/automations/automation-executor.ts`

Currently a 3-source cascade: `manifest.target_path` -> `extractTargetPath()` regex -> frontmatter. Simplify to use `manifest.target_path` directly (it's the source of truth, set at create time). Remove `extractTargetPath()` method.

### 7.4: E2E integration test

**Files:** Create `packages/dashboard/src/automations/__tests__/e2e-agentic-flow.test.ts`

Full lifecycle test: create automation with todos -> fire -> executor assembles todos -> mock worker marks items done -> validators run -> job completes -> notification created -> heartbeat delivers.

Uses mocked SDK sessions (no real LLM calls) but exercises the full framework path.

Key assertions:
- Todo assembly produces correct 3-layer list
- Validation rejects bad output
- Job completion gating catches incomplete items
- Persistent notification created on completion
- Heartbeat tick delivers notification

### 7.5: Acceptance

Task 7.4 IS the acceptance test. If it passes, the framework is ready for S8.

---

## Pass Criteria

1. E2E acceptance test passes
2. Scanner reports invalid capabilities with error messages
3. `findById` confirmed reading from disk (pre-fixed)
4. Paper trail uses `manifest.target_path` directly
5. All existing tests still pass
