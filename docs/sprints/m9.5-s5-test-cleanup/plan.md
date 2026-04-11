# M9.5-S5: Test Cleanup + Deferred Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 31 failing dashboard tests from the S3 desktop extraction. Close out the `.enabled` auto-creation gap and collect structured tool UX feedback from Nina. All tests green — milestone test debt cleared.

**Design spec:** `docs/design/capability-framework-v2.md` §S5

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Delete | `packages/dashboard/tests/unit/desktop/computer-use-service.test.ts` | Tests deleted module |
| Delete | `packages/dashboard/tests/unit/desktop/desktop-capability-detector.test.ts` | Tests deleted module |
| Delete | `packages/dashboard/tests/unit/desktop/x11-backend.test.ts` | Tests deleted module |
| Delete | `packages/dashboard/tests/unit/hooks/desktop-hooks.test.ts` | Tests deleted module |
| Delete | `packages/dashboard/tests/unit/mcp/desktop-server.test.ts` | Tests deleted module |
| Modify | `packages/dashboard/tests/unit/capabilities/capability-system.test.ts` | Add `enabled: true` to test capabilities |
| Modify | `packages/dashboard/tests/session-manager-skills.test.ts` | Add missing exports to `@my-agent/core` mock |
| Modify | `packages/core/skills/capability-brainstorming/SKILL.md` | Add `.enabled` creation instruction to builder flow |

---

## Task 1: Delete orphaned test files

5 test files test modules that were deleted in S3. The modules moved to `.my_agent/capabilities/desktop-x11/` (private, gitignored). Framework-side behavior is covered by `packages/core/tests/capabilities/`.

- [ ] **Step 1: Delete the test files**

```bash
rm packages/dashboard/tests/unit/desktop/computer-use-service.test.ts
rm packages/dashboard/tests/unit/desktop/desktop-capability-detector.test.ts
rm packages/dashboard/tests/unit/desktop/x11-backend.test.ts
rm packages/dashboard/tests/unit/hooks/desktop-hooks.test.ts
rm packages/dashboard/tests/unit/mcp/desktop-server.test.ts
```

- [ ] **Step 2: Remove empty directories if applicable**

```bash
rmdir packages/dashboard/tests/unit/desktop/ 2>/dev/null || true
rmdir packages/dashboard/tests/unit/hooks/ 2>/dev/null || true
```

Check if `tests/unit/mcp/` has other files before removing:
```bash
ls packages/dashboard/tests/unit/mcp/
```
Only remove if empty.

- [ ] **Step 3: Verify no other tests import from deleted modules**

```bash
grep -rn 'desktop-capability-detector\|computer-use-service\|desktop-hooks\|desktop-server\|x11-backend' packages/dashboard/tests/ --include='*.ts' | grep -v node_modules
```

Expected: No matches (or only matches in files we just deleted).

- [ ] **Step 4: Run dashboard tests to confirm improvement**

```bash
cd packages/dashboard && npx vitest run 2>&1 | tail -10
```

Expected: ~20 fewer failures (the 5 deleted files accounted for ~20 of the 31 failures).

- [ ] **Step 5: Commit**

```bash
git add -u packages/dashboard/tests/unit/desktop/ packages/dashboard/tests/unit/hooks/ packages/dashboard/tests/unit/mcp/desktop-server.test.ts
git commit -m "test(cleanup): delete 5 orphaned test files for modules removed in S3

Deleted tests for: computer-use-service, desktop-capability-detector,
x11-backend, desktop-hooks, desktop-server. These modules were extracted
to .my_agent/capabilities/desktop-x11/ during M9.5-S3. Framework-side
coverage is in packages/core/tests/capabilities/."
```

---

## Task 2: Fix capability-system.test.ts — add `enabled: true`

S1 changed `get()` to require both `available` AND `enabled`. These tests create capabilities without `enabled`, so it defaults to `false` (or `undefined`), and `get()` returns `undefined`.

5 tests fail:
- `has(type) returns true for existing provides type`
- `get(type) returns available capability preferentially`
- `get(type) falls back to unavailable if no available match`
- `getContent(type) reads CAPABILITY.md body`
- `getReference(type, filename) reads from references/ subdir`

**Files:**
- Modify: `packages/dashboard/tests/unit/capabilities/capability-system.test.ts`

- [ ] **Step 1: Add `enabled: true` to all test capability objects**

In `packages/dashboard/tests/unit/capabilities/capability-system.test.ts`, update the three capability objects at lines 204-230:

```typescript
  const availableCap: Capability = {
    name: "deepgram-stt",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/fake/deepgram-stt",
    status: "available",
    health: "untested",
    enabled: true,          // ← add
  };

  const unavailableCap: Capability = {
    name: "whisper-stt",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/fake/whisper-stt",
    status: "unavailable",
    unavailableReason: "missing OPENAI_API_KEY",
    health: "untested",
    enabled: true,          // ← add
  };

  const otherCap: Capability = {
    name: "elevenlabs-tts",
    provides: "text-to-audio",
    interface: "mcp",
    path: "/tmp/fake/elevenlabs-tts",
    status: "available",
    health: "untested",
    enabled: true,          // ← add
  };
```

- [ ] **Step 2: Fix the "falls back to unavailable" test**

The test at line 260 expects `get()` to fall back to unavailable capabilities. S1 changed this — `get()` now only returns `available` AND `enabled`. This test expectation is wrong.

Replace:
```typescript
  it("get(type) falls back to unavailable if no available match", () => {
    registry.load([unavailableCap]);
    const result = registry.get("audio-to-text");
    expect(result).toBeDefined();
    expect(result!.name).toBe("whisper-stt");
    expect(result!.status).toBe("unavailable");
  });
```

With:
```typescript
  it("get(type) returns undefined for unavailable capability", () => {
    registry.load([unavailableCap]);
    const result = registry.get("audio-to-text");
    expect(result).toBeUndefined();
  });
```

- [ ] **Step 3: Fix getContent and getReference tests**

These tests also create inline `Capability` objects without `enabled`. Add `enabled: true` to the `realCap` object at line 298 and the `refCap` object around line 332.

Search for other `Capability` object literals in this file and add `enabled: true` to all of them.

- [ ] **Step 4: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/capabilities/capability-system.test.ts --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/unit/capabilities/capability-system.test.ts
git commit -m "fix(tests): add enabled field to capability test objects (S1 gate change)"
```

---

## Task 3: Fix session-manager-skills.test.ts — update mock

The `@my-agent/core` mock doesn't export `createCapabilityRateLimiter`, `createCapabilityAuditLogger`, or `createScreenshotInterceptor`. Session manager now imports these (added in S3).

3 tests fail with: `No "createCapabilityRateLimiter" export is defined on the "@my-agent/core" mock`.

**Files:**
- Modify: `packages/dashboard/tests/session-manager-skills.test.ts`

- [ ] **Step 1: Add missing exports to the mock**

In `packages/dashboard/tests/session-manager-skills.test.ts`, find the `vi.mock("@my-agent/core", () => ({` block at line 6 and add the missing exports:

```typescript
  createCapabilityRateLimiter: vi.fn().mockReturnValue({
    check: vi.fn().mockReturnValue(true),
  }),
  createCapabilityAuditLogger: vi.fn().mockReturnValue({
    log: vi.fn().mockResolvedValue(undefined),
  }),
  createScreenshotInterceptor: vi.fn().mockReturnValue({
    hasScreenshot: vi.fn().mockReturnValue(false),
    extractImage: vi.fn().mockReturnValue(null),
  }),
```

Add these lines inside the mock object, after the existing exports (e.g., after the `createDelegationEnforcer` block).

Also check if `AuditEntry` type is imported — if so, mock exports may need a type export too. Since `vi.mock` handles value exports only, type imports are erased at runtime and don't need mocking.

- [ ] **Step 2: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/session-manager-skills.test.ts --reporter=verbose
```

Expected: All 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/session-manager-skills.test.ts
git commit -m "fix(tests): add capability middleware exports to @my-agent/core mock"
```

---

## Task 4: Verify all tests green

- [ ] **Step 1: Run full dashboard test suite**

```bash
cd packages/dashboard && npx vitest run 2>&1 | tail -15
```

Expected: 0 failures. If any remain, investigate and fix.

- [ ] **Step 2: Run full core test suite**

```bash
cd packages/core && npx vitest run 2>&1 | tail -15
```

Expected: 0 failures.

- [ ] **Step 3: TypeScript compilation**

```bash
cd packages/core && npx tsc --noEmit && cd ../dashboard && npx tsc --noEmit
```

Expected: Clean compilation for both.

- [ ] **Step 4: Commit if any additional fixes were needed**

---

## Task 5: Auto-create `.enabled` on first capability build

When the capability-builder creates a new capability, it should write the `.enabled` file so the user doesn't have to manually enable it after installation.

**Files:**
- Modify: `packages/core/skills/capability-brainstorming/SKILL.md`

- [ ] **Step 1: Add `.enabled` creation to builder instructions**

In `packages/core/skills/capability-brainstorming/SKILL.md`, find the builder spawn section. Add an instruction that the builder must create the `.enabled` file as the last step:

```markdown
**After all capability files are written:** Write the `.enabled` file to activate the capability:
```bash
echo "$(date -Iseconds)" > .my_agent/capabilities/<name>/.enabled
```
This enables the capability immediately — the user doesn't need to toggle it on manually after installation.
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/skills/capability-brainstorming/SKILL.md
git commit -m "feat(brainstorming): auto-create .enabled file on first capability build"
```

---

## Task 6: Structured tool UX feedback from Nina

Open the dashboard, start a new conversation with Nina, and ask the structured feedback questions. This is a conversation task, not a code task.

- [ ] **Step 1: Open dashboard and start new conversation**

Navigate to the dashboard via Tailscale URL. Click the "New" button for a fresh conversation.

- [ ] **Step 2: Ask Nina the structured questions**

Send this message:

> I'd like your feedback on the desktop control tools you've been using. Please answer each question:
> 1. Which desktop tools did you actually use when I asked you to read the KWrite document?
> 2. Were any of the tools confusing or unnecessary?
> 3. Was anything missing that would have helped?
> 4. Was the coordinate system intuitive when clicking?
> 5. Would any of these optional tools have been useful: OCR, find_element, diff_check, window_screenshot, drag?

- [ ] **Step 3: Log responses in DECISIONS.md**

Create `docs/sprints/m9.5-s5-test-cleanup/DECISIONS.md` and log Nina's responses:

```markdown
# M9.5-S5: Decisions Log

## D1: Nina's tool UX feedback (S4 deferred C4)

**Date:** [date]
**Questions and responses:**

1. Which tools used: [response]
2. Confusing/unnecessary: [response]
3. Missing: [response]
4. Coordinate system: [response]
5. Optional tools: [response]

**Template implications:** [any changes needed based on feedback]
```

- [ ] **Step 4: If feedback suggests template changes, make them**

Only adjust `skills/capability-templates/desktop-control.md` if Nina identifies something actionable (e.g., a missing required tool, a confusing parameter name). Don't change the template for "nice to have" suggestions.

---

## Verification Summary

| Requirement | Task | Verification |
|---|---|---|
| Delete 5 orphaned test files | Task 1 | No import errors for deleted modules |
| Fix capability-system.test.ts (enabled gate) | Task 2 | All tests pass |
| Fix session-manager-skills.test.ts (mock) | Task 3 | All tests pass |
| Zero test failures across both packages | Task 4 | Full suite green |
| `.enabled` auto-creation on build | Task 5 | Instruction in brainstorming skill |
| Structured tool UX feedback | Task 6 | Nina's responses logged in DECISIONS.md |
