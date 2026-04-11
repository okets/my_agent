# M9.5-S5: Test Cleanup + Deferred Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 31 failing dashboard tests from the S3 desktop extraction. Close out the `.enabled` auto-creation gap. Apply Nina's tool UX feedback: add `desktop_focus_window` as 8th required tool, include `scaleFactor` in screenshot metadata. All tests green — milestone test debt cleared.

**Design spec:** `docs/design/capability-framework-v2.md` §S5
**Nina's review:** `docs/sprints/m9.5-s5-test-cleanup/ninas-review.md`

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
| Modify | `packages/core/src/capabilities/tool-contracts.ts` | Add `desktop_focus_window` as 8th required tool |
| Modify | `skills/capability-templates/desktop-control.md` | Add `desktop_focus_window`, `scaleFactor` in screenshot metadata |
| Modify | `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts` | Add `desktop_focus_window` tool, `scaleFactor` in screenshot |
| Modify | `packages/core/tests/capabilities/schema-validation.test.ts` | Update contract assertions (8 required tools) |
| Modify | `.my_agent/capabilities/desktop-x11/src/server.ts` | Add `desktop_focus_window` tool, `scaleFactor` in screenshot metadata |

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

## Task 6: Nina's tool UX feedback — summary and action items

Nina's structured review is at `docs/sprints/m9.5-s5-test-cleanup/ninas-review.md`. Key findings:

**What she used:** `desktop_screenshot`, `desktop_info(windows)`, `desktop_click`, `desktop_key` (accidental — was trying to focus a window).

**Biggest gap:** No `desktop_focus_window(windowId)` tool. She had the window ID from `desktop_info` but couldn't use it to raise/focus the window. Had to fumble with taskbar clicks instead. The X11 backend already implements `focusWindow(windowId)` — this is a missing tool registration.

**Coordinate confusion:** The screenshot is scaled down but she doesn't know the scale factor until she clicks wrong. She wants the scale factor included with every screenshot response so she can calculate click coordinates accurately.

**Optional tools she'd reach for regularly:** `window_screenshot`, `find_element`, `OCR`. All stay optional but the first two are high-value.

**Action items from this review:**
- Task 7: Add `desktop_focus_window` as 8th required tool
- Task 8: Include `scaleFactor` in screenshot response metadata

No task needed for this — the review is already captured. Just log the action items in DECISIONS.md.

- [ ] **Step 1: Create DECISIONS.md with review summary**

Create `docs/sprints/m9.5-s5-test-cleanup/DECISIONS.md`:

```markdown
# M9.5-S5: Decisions Log

## D1: Nina's tool UX feedback (S4 deferred C4)

**Date:** 2026-04-11
**Full review:** `ninas-review.md`

**Action items:**
1. Add `desktop_focus_window` as 8th required tool (Task 7) — she had window IDs but couldn't focus them
2. Include `scaleFactor` in screenshot metadata (Task 8) — she couldn't predict coordinate mapping
3. OCR, find_element, window_screenshot stay optional — high value but not minimum-viable
```

---

## Task 7: Add `desktop_focus_window` as required tool

Nina's biggest friction point. The backend already implements `focusWindow(windowId)`. This is a missing tool registration in the contract and template.

**Files:**
- Modify: `packages/core/src/capabilities/tool-contracts.ts`
- Modify: `skills/capability-templates/desktop-control.md`
- Modify: `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`
- Modify: `.my_agent/capabilities/desktop-x11/src/server.ts` (runtime capability)

- [ ] **Step 1: Add to tool-contracts.ts**

In `packages/core/src/capabilities/tool-contracts.ts`, add `desktop_focus_window` to the `required` array in `DESKTOP_CONTROL_CONTRACT`:

```typescript
{ name: 'desktop_focus_window', requiredParams: [{ name: 'windowId', required: true }] },
```

- [ ] **Step 2: Add to desktop-control.md template**

In `skills/capability-templates/desktop-control.md`, add after the `desktop_wait` section in the Required Tools:

```markdown
### desktop_focus_window

Bring a window to the foreground by its ID (from `desktop_info(windows)`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | Yes | Window ID from `desktop_info` windows query |

**Returns:** Screenshot after focusing the window.
```

Update the required tool count from 7 to 8 throughout the template.

- [ ] **Step 3: Add to test fixture**

In `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`, add:

```typescript
server.tool(
  'desktop_focus_window',
  'Focus window by ID (test fixture)',
  { windowId: z.string() },
  async ({ windowId }) => ({
    content: [{ type: 'text', text: JSON.stringify({ focused: windowId, fixture: true }) }],
  }),
)
```

- [ ] **Step 4: Add to real capability server**

In `.my_agent/capabilities/desktop-x11/src/server.ts`, add the tool:

```typescript
server.tool(
  'desktop_focus_window',
  'Bring a window to the foreground by its ID (from desktop_info windows query)',
  { windowId: z.string() },
  async ({ windowId }) => {
    await backend.focusWindow(windowId)
    return screenshotResult(`Focused window ${windowId}`)
  },
)
```

- [ ] **Step 5: Update schema-validation tests**

In `packages/core/tests/capabilities/schema-validation.test.ts`, update the test that checks required tool count:

```typescript
expect(DESKTOP_CONTROL_CONTRACT.required).toHaveLength(8)
```

Add `'desktop_focus_window'` to the expected tool names array. Add the tool to the simulated tool lists in the validation tests.

- [ ] **Step 6: Run tests**

```bash
cd packages/core && npx vitest run tests/capabilities/ --reporter=verbose
```

Expected: All tests pass with the updated contract (8 required tools).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/capabilities/tool-contracts.ts skills/capability-templates/desktop-control.md packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts packages/core/tests/capabilities/schema-validation.test.ts
git commit -m "feat(desktop-control): add desktop_focus_window as 8th required tool

Nina's UX feedback: she had window IDs from desktop_info but couldn't
focus them. Had to fumble with taskbar clicks. The X11 backend already
implements focusWindow() — this registers it as an MCP tool."
```

---

## Task 8: Include `scaleFactor` in screenshot response metadata

Every screenshot response should include the scale factor so the brain can calculate accurate click coordinates without a separate `desktop_info(display)` call.

**Files:**
- Modify: `skills/capability-templates/desktop-control.md`
- Modify: `.my_agent/capabilities/desktop-x11/src/server.ts` (runtime capability)
- Modify: `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`

- [ ] **Step 1: Update template — screenshot returns scaleFactor**

In `skills/capability-templates/desktop-control.md`, update the `desktop_screenshot` returns description:

```markdown
**Returns:** Image content (base64 PNG) + metadata JSON with `width`, `height`, and `scaleFactor`.
```

Update the code example:

```typescript
return {
  content: [
    { type: 'image', data: screenshot.base64, mimeType: 'image/png' },
    { type: 'text', text: JSON.stringify({ width: screenshot.width, height: screenshot.height, scaleFactor }) },
  ],
}
```

Add a note: "The `scaleFactor` tells the brain the ratio between screenshot coordinates and screen coordinates. Click coordinates from the screenshot must be divided by this factor to get actual screen positions. The capability handles this scaling internally — the brain sends screenshot-space coordinates and the capability converts them."

- [ ] **Step 2: Update real capability server**

In `.my_agent/capabilities/desktop-x11/src/server.ts`, update the `screenshotResult` helper to include `scaleFactor`:

```typescript
async function screenshotResult(description: string) {
  const buf = await backend.screenshot()
  const base64 = buf.toString('base64')
  return {
    content: [
      { type: 'text', text: JSON.stringify({ description, scaleFactor, width: display.width, height: display.height }) },
      { type: 'image', data: base64, mimeType: 'image/png' },
    ],
  }
}
```

Also update the `desktop_screenshot` tool to include scaleFactor in its metadata.

- [ ] **Step 3: Update test fixture**

In `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`, update the `desktop_screenshot` response to include `scaleFactor`:

```typescript
{ type: 'text', text: JSON.stringify({ width: 1920, height: 1080, scaleFactor: 1.0, fixture: true }) }
```

- [ ] **Step 4: Update the template guidance**

Add to the "Coordinate Scaling" section of the template:

```markdown
**Every screenshot response includes `scaleFactor` in its metadata.** This tells the brain the ratio between the screenshot's coordinate space and the actual screen coordinates. The brain sends coordinates in screenshot space — the capability's `toScreenCoord()` function handles the conversion internally. The brain does NOT need to scale coordinates itself, but the scaleFactor helps it understand the mapping.
```

- [ ] **Step 5: Run tests**

```bash
cd packages/core && npx vitest run tests/capabilities/ --reporter=verbose
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add skills/capability-templates/desktop-control.md packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts
git commit -m "feat(desktop-control): include scaleFactor in screenshot metadata

Nina's UX feedback: coordinate confusion — she couldn't predict the
mapping between screenshot coordinates and click coordinates. Now every
screenshot response includes scaleFactor so the brain knows the ratio."
```

---

## Verification Summary

| Requirement | Task | Verification |
|---|---|---|
| Delete 5 orphaned test files | Task 1 | No import errors for deleted modules |
| Fix capability-system.test.ts (enabled gate) | Task 2 | All tests pass |
| Fix session-manager-skills.test.ts (mock) | Task 3 | All tests pass |
| Zero test failures across both packages | Task 4 | Full suite green |
| `.enabled` auto-creation on build | Task 5 | Instruction in brainstorming skill |
| Nina's tool UX feedback logged | Task 6 | Review summary + action items in DECISIONS.md |
| `desktop_focus_window` as 8th required tool | Task 7 | Contract, template, fixture, real server updated |
| `scaleFactor` in screenshot metadata | Task 8 | Template, fixture, real server updated |
