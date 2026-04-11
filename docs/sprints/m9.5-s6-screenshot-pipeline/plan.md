# M9.5-S6: Screenshot Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store all MCP tool screenshots in VAS via a generic PostToolUse interceptor, inject URLs back into tool results, and let the brain curate which screenshots to surface to the user.

**Architecture:** A single `storeAndInject()` function in `packages/core` detects base64 images in any PostToolUse result, stores them via an injected callback, and returns `updatedMCPToolOutput` with the VAS URL appended. Wired in both `session-manager.ts` (conversation) and `automation-executor.ts` (jobs). Brain curation instructions tell the agent which screenshots to include in replies/summaries.

**Tech Stack:** TypeScript, Vitest, Claude Agent SDK (PostToolUse hooks, `updatedMCPToolOutput`), VAS (existing), headless App (smoke tests)

**Spec:** `docs/sprints/m9.5-s6-screenshot-pipeline/spec.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/capabilities/mcp-middleware.ts` | Modify | Add `storeAndInject()`, `inferSource()`, `parseImageMetadata()`, dual-format `findImageData()` (internal) |
| `packages/core/src/capabilities/index.ts` | Modify | Export new types and function |
| `packages/core/src/lib.ts` | Modify | Re-export new types and function |
| `packages/core/tests/capabilities/mcp-middleware.test.ts` | Modify | Add tests for `storeAndInject()`, source detection, metadata parsing, dual format |
| `packages/dashboard/src/agent/session-manager.ts` | Modify | Fix `tool_result` → `tool_response`, catch-all matcher, call `storeAndInject()` with VAS closure |
| `packages/dashboard/src/automations/automation-executor.ts` | Modify | Add PostToolUse hook in `buildJobHooks()`, add Playwright MCP server for workers, add curation prompt |
| `.my_agent/capabilities/desktop-x11/CAPABILITY.md` | Modify | Add screenshot curation instructions |

---

## Task 0: Verify `tool_response` Shape (Prerequisite)

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:389-395`

This is a manual verification step. The result determines how `findImageContent()` handles the data.

- [ ] **Step 1: Add temporary logging to PostToolUse hook**

In `packages/dashboard/src/agent/session-manager.ts`, replace the screenshot interception block (lines 389-395):

```typescript
          // Screenshot interception — log shape for S6 Task 0
          if ('tool_response' in input) {
            const result = (input as { tool_response: unknown }).tool_response
            console.log(`[S6-Task0] tool_response shape for ${toolName}:`, JSON.stringify(result, null, 2).slice(0, 500))
          } else if ('tool_result' in input) {
            const result = (input as { tool_result: unknown }).tool_result
            console.log(`[S6-Task0] tool_result shape for ${toolName}:`, JSON.stringify(result, null, 2).slice(0, 500))
          } else {
            console.log(`[S6-Task0] No tool_response or tool_result in input. Keys:`, Object.keys(input))
          }
```

- [ ] **Step 2: Restart dashboard, trigger a desktop screenshot**

```bash
systemctl --user restart nina-dashboard.service
```

Then via dashboard chat, ask the brain to take a screenshot. Read the journal log:

```bash
journalctl --user -u nina-dashboard.service --since "1 min ago" | grep S6-Task0
```

- [ ] **Step 3: Record the shape**

Document the exact shape in `docs/sprints/m9.5-s6-screenshot-pipeline/DECISIONS.md`:

```markdown
# DECISIONS

## D1: `tool_response` shape from SDK PostToolUse hook

**Date:** YYYY-MM-DD
**Context:** Task 0 verification — logged actual shape from live SDK session.

**Finding:** [paste the logged shape here]

**Impact on implementation:**
- `findImageContent()` must handle: [MCP format / Anthropic API format / both]
- Field name to use: [tool_response / tool_result]
```

- [ ] **Step 4: Remove temporary logging**

Revert the changes from Step 1 (restore original lines 389-395). Do NOT commit the temporary logging.

- [ ] **Step 5: Commit DECISIONS.md**

```bash
git add docs/sprints/m9.5-s6-screenshot-pipeline/DECISIONS.md
git commit -m "docs(m9.5-s6): D1 — tool_response shape verified (Task 0)"
```

---

## Task 1: Dual-Format Image Detection + `inferSource()` + `parseImageMetadata()`

**Files:**
- Modify: `packages/core/src/capabilities/mcp-middleware.ts`
- Test: `packages/core/tests/capabilities/mcp-middleware.test.ts`

- [ ] **Step 1: Write failing tests for dual-format image detection**

Add to `packages/core/tests/capabilities/mcp-middleware.test.ts`:

```typescript
import {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  inferSource,
  parseImageMetadata,
} from '../../src/capabilities/mcp-middleware.js'
import type { ScreenshotMetadata } from '../../src/visual/types.js'

// ... keep existing tests ...

describe('inferSource', () => {
  it('maps desktop_ prefix to desktop', () => {
    expect(inferSource('desktop_click')).toBe('desktop')
    expect(inferSource('desktop_screenshot')).toBe('desktop')
  })

  it('maps browser_ prefix to playwright', () => {
    expect(inferSource('browser_navigate')).toBe('playwright')
    expect(inferSource('browser_take_screenshot')).toBe('playwright')
  })

  it('maps playwright_ prefix to playwright', () => {
    expect(inferSource('playwright_click')).toBe('playwright')
  })

  it('maps unknown tools to generated', () => {
    expect(inferSource('generate_image')).toBe('generated')
    expect(inferSource('some_tool')).toBe('generated')
  })
})

describe('parseImageMetadata', () => {
  it('extracts metadata from text content block JSON', () => {
    const result = {
      content: [
        { type: 'text', text: JSON.stringify({ description: 'Screenshot captured', width: 1920, height: 1080, scaleFactor: 0.5 }) },
        { type: 'image', data: 'iVBORw0KGgo...' },
      ],
    }
    const meta = parseImageMetadata(result, 'desktop_screenshot')
    expect(meta).toEqual({
      description: 'Screenshot captured',
      width: 1920,
      height: 1080,
      source: 'desktop',
    })
  })

  it('falls back to defaults when text block is not JSON', () => {
    const result = {
      content: [
        { type: 'text', text: 'not json' },
        { type: 'image', data: 'iVBORw0KGgo...' },
      ],
    }
    const meta = parseImageMetadata(result, 'desktop_click')
    expect(meta).toEqual({
      description: undefined,
      width: 0,
      height: 0,
      source: 'desktop',
    })
  })

  it('falls back to defaults when no text block exists', () => {
    const result = {
      content: [
        { type: 'image', data: 'iVBORw0KGgo...' },
      ],
    }
    const meta = parseImageMetadata(result, 'browser_screenshot')
    expect(meta).toEqual({
      description: undefined,
      width: 0,
      height: 0,
      source: 'playwright',
    })
  })
})

describe('screenshot interceptor — dual format', () => {
  it('detects Anthropic API format images', () => {
    const interceptor = createScreenshotInterceptor()
    const result = {
      content: [{
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' },
      }],
    }
    expect(interceptor.hasScreenshot(result)).toBe(true)
    expect(interceptor.extractImage(result)).toBe('iVBORw0KGgoAAAANSUhEUg==')
  })

  it('still detects MCP format images', () => {
    const interceptor = createScreenshotInterceptor()
    const result = {
      content: [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' }],
    }
    expect(interceptor.hasScreenshot(result)).toBe(true)
  })

  it('rejects non-PNG base64 data', () => {
    const interceptor = createScreenshotInterceptor()
    const result = {
      content: [{ type: 'image', data: 'SGVsbG8gV29ybGQ=' }],
    }
    expect(interceptor.hasScreenshot(result)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core && npx vitest run tests/capabilities/mcp-middleware.test.ts
```

Expected: FAIL — `inferSource` and `parseImageMetadata` not exported, Anthropic format not handled.

- [ ] **Step 3: Implement `inferSource()`, `parseImageMetadata()`, and update `findImageContent()`**

Replace the full content of `packages/core/src/capabilities/mcp-middleware.ts`:

```typescript
/**
 * MCP Capability Middleware
 *
 * Framework-side middleware for MCP capability tool calls:
 * - Rate limiter: sliding window per capability type
 * - Audit logger: JSONL logging of tool calls
 * - Screenshot interceptor: detects and extracts base64 images in tool results
 * - storeAndInject: stores screenshots in VAS and injects URLs into tool output
 *
 * These run in the framework, not in the capability server process.
 * Wired via PostToolUse hooks in the Agent SDK.
 */

import type { ScreenshotSource, ScreenshotMetadata } from '../visual/types.js'

export interface RateLimiter {
  check(capabilityType: string): boolean
}

export function createCapabilityRateLimiter(options: { maxPerMinute: number }): RateLimiter {
  const windows: Map<string, number[]> = new Map()

  return {
    check(capabilityType: string): boolean {
      const now = Date.now()
      const windowMs = 60_000
      const timestamps = windows.get(capabilityType) ?? []
      const valid = timestamps.filter(t => now - t < windowMs)

      if (valid.length >= options.maxPerMinute) {
        windows.set(capabilityType, valid)
        return false
      }

      valid.push(now)
      windows.set(capabilityType, valid)
      return true
    },
  }
}

export interface AuditEntry {
  timestamp: string
  capability: string
  tool: string
  session: string
}

export interface AuditLogger {
  log(params: { capabilityName: string; toolName: string; sessionId: string }): Promise<void>
}

export function createCapabilityAuditLogger(
  writer: (entry: AuditEntry) => void | Promise<void>,
): AuditLogger {
  return {
    async log({ capabilityName, toolName, sessionId }) {
      await writer({
        timestamp: new Date().toISOString(),
        capability: capabilityName,
        tool: toolName,
        session: sessionId,
      })
    },
  }
}

/** Map tool name prefix to ScreenshotSource */
export function inferSource(toolName: string): ScreenshotSource {
  if (toolName.startsWith('desktop_')) return 'desktop'
  if (toolName.startsWith('browser_') || toolName.startsWith('playwright_')) return 'playwright'
  return 'generated'
}

/** Parse screenshot metadata from the text content block in a tool result */
export function parseImageMetadata(result: unknown, toolName: string): ScreenshotMetadata {
  const fallback: ScreenshotMetadata = {
    description: undefined,
    width: 0,
    height: 0,
    source: inferSource(toolName),
  }

  if (!result || typeof result !== 'object') return fallback
  const r = result as { content?: unknown[] }
  if (!Array.isArray(r.content)) return fallback

  for (const block of r.content) {
    if (
      block &&
      typeof block === 'object' &&
      'type' in block &&
      (block as { type: string }).type === 'text' &&
      'text' in block &&
      typeof (block as { text: unknown }).text === 'string'
    ) {
      try {
        const parsed = JSON.parse((block as { text: string }).text)
        if (parsed && typeof parsed === 'object') {
          return {
            description: typeof parsed.description === 'string' ? parsed.description : undefined,
            width: typeof parsed.width === 'number' ? parsed.width : 0,
            height: typeof parsed.height === 'number' ? parsed.height : 0,
            source: inferSource(toolName),
          }
        }
      } catch {
        // Not JSON, try next text block
      }
    }
  }

  return fallback
}

export interface ScreenshotInterceptor {
  hasScreenshot(result: unknown): boolean
  extractImage(result: unknown): string | null
}

export function createScreenshotInterceptor(): ScreenshotInterceptor {
  const PNG_MAGIC_B64 = 'iVBORw0KGgo'

  function findImageData(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null
    const r = result as { content?: unknown[] }
    if (!Array.isArray(r.content)) return null
    for (const block of r.content) {
      if (!block || typeof block !== 'object' || !('type' in block)) continue
      const b = block as Record<string, unknown>
      if (b.type !== 'image') continue

      // MCP format: { type: 'image', data: string, mimeType: string }
      if (typeof b.data === 'string') return b.data

      // Anthropic API format: { type: 'image', source: { type: 'base64', data: string } }
      if (b.source && typeof b.source === 'object') {
        const src = b.source as Record<string, unknown>
        if (typeof src.data === 'string') return src.data
      }
    }
    return null
  }

  return {
    hasScreenshot(result: unknown): boolean {
      const data = findImageData(result)
      if (!data) return false
      return data.startsWith(PNG_MAGIC_B64)
    },

    extractImage(result: unknown): string | null {
      const data = findImageData(result)
      if (!data) return null
      return data
    },
  }
}
```

- [ ] **Step 4: Export new functions from `packages/core/src/capabilities/index.ts`**

Add to the existing exports in `packages/core/src/capabilities/index.ts`:

```typescript
export {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  inferSource,
  parseImageMetadata,
  type RateLimiter,
  type AuditLogger,
  type AuditEntry,
  type ScreenshotInterceptor,
} from './mcp-middleware.js'
```

- [ ] **Step 5: Re-export from `packages/core/src/lib.ts`**

Update the existing export block (around line 242-247) to include the new functions:

```typescript
export {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  inferSource,
  parseImageMetadata,
} from './capabilities/index.js'
export type { RateLimiter, AuditLogger, AuditEntry, ScreenshotInterceptor } from './capabilities/index.js'
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/core && npx vitest run tests/capabilities/mcp-middleware.test.ts
```

Expected: ALL PASS

- [ ] **Step 7: TypeScript check**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: Clean

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/capabilities/mcp-middleware.ts packages/core/src/capabilities/index.ts packages/core/src/lib.ts packages/core/tests/capabilities/mcp-middleware.test.ts
git commit -m "feat(core): dual-format image detection, inferSource, parseImageMetadata"
```

---

## Task 2: Add `storeAndInject()` Function

**Files:**
- Modify: `packages/core/src/capabilities/mcp-middleware.ts`
- Modify: `packages/core/src/capabilities/index.ts`
- Modify: `packages/core/src/lib.ts`
- Test: `packages/core/tests/capabilities/mcp-middleware.test.ts`

- [ ] **Step 1: Write failing tests for `storeAndInject()`**

Add to `packages/core/tests/capabilities/mcp-middleware.test.ts`:

```typescript
import {
  // ... existing imports ...
  storeAndInject,
  type StoreCallback,
} from '../../src/capabilities/mcp-middleware.js'

// ... existing tests ...

describe('storeAndInject', () => {
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  function makeMcpResult(blocks: unknown[]) {
    return { content: blocks }
  }

  it('stores image and returns updatedMCPToolOutput with URL appended', () => {
    const stored: { image: Buffer; metadata: ScreenshotMetadata }[] = []
    const store: StoreCallback = (image, metadata) => {
      stored.push({ image, metadata })
      return { id: 'ss-test-id', filename: 'ss-test-id.png' }
    }

    const result = makeMcpResult([
      { type: 'text', text: JSON.stringify({ description: 'Click result', width: 1920, height: 1080 }) },
      { type: 'image', data: PNG_B64 },
    ])

    const output = storeAndInject(result, 'desktop_click', store)

    // Store was called
    expect(stored).toHaveLength(1)
    expect(stored[0].metadata.source).toBe('desktop')
    expect(stored[0].metadata.width).toBe(1920)
    expect(stored[0].image).toBeInstanceOf(Buffer)

    // Output has updatedMCPToolOutput
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput!.hookEventName).toBe('PostToolUse')
    const updated = output.hookSpecificOutput!.updatedMCPToolOutput as { content: unknown[] }
    // Original 2 blocks + 1 URL block = 3
    expect(updated.content).toHaveLength(3)
    const urlBlock = updated.content[2] as { type: string; text: string }
    expect(urlBlock.type).toBe('text')
    expect(urlBlock.text).toContain('/api/assets/screenshots/ss-test-id.png')
  })

  it('returns empty object when no image in result', () => {
    const store: StoreCallback = () => { throw new Error('should not be called') }
    const result = makeMcpResult([{ type: 'text', text: 'hello' }])
    const output = storeAndInject(result, 'desktop_info', store)
    expect(output).toEqual({})
  })

  it('returns empty object when result is not an MCP content object', () => {
    const store: StoreCallback = () => { throw new Error('should not be called') }
    const output = storeAndInject({ success: true }, 'Bash', store)
    expect(output).toEqual({})
  })

  it('returns empty object for non-PNG image data', () => {
    const store: StoreCallback = () => { throw new Error('should not be called') }
    const result = makeMcpResult([{ type: 'image', data: 'SGVsbG8gV29ybGQ=' }])
    const output = storeAndInject(result, 'desktop_screenshot', store)
    expect(output).toEqual({})
  })

  it('handles Anthropic API format images', () => {
    const stored: { image: Buffer; metadata: ScreenshotMetadata }[] = []
    const store: StoreCallback = (image, metadata) => {
      stored.push({ image, metadata })
      return { id: 'ss-api-id', filename: 'ss-api-id.png' }
    }

    const result = makeMcpResult([{
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_B64 },
    }])

    const output = storeAndInject(result, 'browser_take_screenshot', store)

    expect(stored).toHaveLength(1)
    expect(stored[0].metadata.source).toBe('playwright')
    expect(output.hookSpecificOutput).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core && npx vitest run tests/capabilities/mcp-middleware.test.ts
```

Expected: FAIL — `storeAndInject` not exported.

- [ ] **Step 3: Implement `storeAndInject()`**

Add to end of `packages/core/src/capabilities/mcp-middleware.ts` (before closing):

```typescript
export type StoreCallback = (image: Buffer, metadata: ScreenshotMetadata) => { id: string; filename: string }

export interface StoreAndInjectResult {
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse'
    updatedMCPToolOutput: {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string; source?: unknown }>
    }
  }
}

export function storeAndInject(
  toolResponse: unknown,
  toolName: string,
  store: StoreCallback,
): StoreAndInjectResult {
  const interceptor = createScreenshotInterceptor()
  if (!interceptor.hasScreenshot(toolResponse)) return {}

  const base64 = interceptor.extractImage(toolResponse)
  if (!base64) return {}

  const image = Buffer.from(base64, 'base64')
  const metadata = parseImageMetadata(toolResponse, toolName)
  const screenshot = store(image, metadata)

  // Rebuild content array with URL appended
  const r = toolResponse as { content?: unknown[] }
  const originalContent = Array.isArray(r.content) ? r.content : []

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedMCPToolOutput: {
        content: [
          ...originalContent,
          { type: 'text', text: `Screenshot URL: /api/assets/screenshots/${screenshot.filename}` },
        ],
      },
    },
  }
}
```

- [ ] **Step 4: Export from `packages/core/src/capabilities/index.ts`**

Add `storeAndInject` and `StoreCallback` to the exports:

```typescript
export {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  inferSource,
  parseImageMetadata,
  storeAndInject,
  type RateLimiter,
  type AuditLogger,
  type AuditEntry,
  type ScreenshotInterceptor,
  type StoreCallback,
  type StoreAndInjectResult,
} from './mcp-middleware.js'
```

- [ ] **Step 5: Re-export from `packages/core/src/lib.ts`**

Update the export block:

```typescript
export {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  inferSource,
  parseImageMetadata,
  storeAndInject,
} from './capabilities/index.js'
export type { RateLimiter, AuditLogger, AuditEntry, ScreenshotInterceptor, StoreCallback, StoreAndInjectResult } from './capabilities/index.js'
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/core && npx vitest run tests/capabilities/mcp-middleware.test.ts
```

Expected: ALL PASS

- [ ] **Step 7: Run full core test suite**

```bash
cd packages/core && npx vitest run
```

Expected: All existing tests still pass.

- [ ] **Step 8: TypeScript check**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: Clean

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/capabilities/mcp-middleware.ts packages/core/src/capabilities/index.ts packages/core/src/lib.ts packages/core/tests/capabilities/mcp-middleware.test.ts
git commit -m "feat(core): add storeAndInject() — stores screenshots in VAS, injects URLs into tool output"
```

---

## Task 3: Wire Interceptor in `session-manager.ts` (Conversation Path)

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:376-400`

- [ ] **Step 1: Update the import**

At the top of `packages/dashboard/src/agent/session-manager.ts`, find the import from `@my-agent/core` and add `storeAndInject`:

```typescript
import {
  // ... existing imports ...
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  storeAndInject,
  type AuditEntry,
  type StoreCallback,
} from "@my-agent/core";
```

Note: `createScreenshotInterceptor` is no longer called directly here, but keep the import if other code still uses it. If only `storeAndInject` is needed, you can remove `createScreenshotInterceptor` from the import.

- [ ] **Step 2: Replace the PostToolUse hook block**

Replace lines 376-400 in `session-manager.ts` (the PostToolUse block):

```typescript
    // Capability audit logger + screenshot pipeline — PostToolUse
    const auditLogPath = join(agentDir, 'logs', 'capability-audit.jsonl')
    const capAuditLogger = createCapabilityAuditLogger(async (entry: AuditEntry) => {
      try {
        await mkdir(dirname(auditLogPath), { recursive: true })
        await appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8')
      } catch {
        // Audit logging is best-effort
      }
    })

    // VAS store callback for screenshot interceptor
    const vasStore: StoreCallback = (image, metadata) => {
      const ss = this.config.app.visualActionService.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    if (!this.hooks!.PostToolUse) this.hooks!.PostToolUse = []
    this.hooks!.PostToolUse.push({
      hooks: [
        async (input) => {
          const toolName = input.tool_name ?? 'unknown'

          // Audit logging for capability tools
          if (toolName.startsWith('desktop_')) {
            await capAuditLogger.log({
              capabilityName: 'desktop-x11',
              toolName,
              sessionId: input.session_id,
            })
          }

          // Screenshot pipeline — store and inject URL for any image-producing tool
          const toolResponse = input.tool_response
          return storeAndInject(toolResponse, toolName, vasStore)
        },
      ],
    })
```

Key changes:
- Removed `matcher: 'desktop_.*'` — now runs on all PostToolUse
- Uses `input.tool_response` (not `tool_result`)
- Uses `input.tool_name` directly (typed by SDK)
- Calls `storeAndInject()` with VAS closure
- Audit logging still scoped to `desktop_*` tools (by if-check, not matcher)

- [ ] **Step 3: Verify VAS is accessible via `this.config.app`**

Check that the SessionManager config has access to the App instance (and thus `visualActionService`). If `this.config.app` doesn't exist, the VAS closure needs to reference it differently. Grep for how `visualService` or `visualActionService` is passed to SessionManager:

```bash
cd packages/dashboard && grep -n 'visualService\|visualActionService' src/agent/session-manager.ts | head -20
```

Adjust the `vasStore` closure to use whatever path gives access to VAS (e.g., `this.config.visualService` or a passed-in parameter).

- [ ] **Step 4: Build and TypeScript check**

```bash
cd packages/core && npx tsc
cd packages/dashboard && npx tsc --noEmit
```

Expected: Clean

- [ ] **Step 5: Run dashboard test suite**

```bash
cd packages/dashboard && npx vitest run
```

Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/agent/session-manager.ts
git commit -m "feat(dashboard): wire storeAndInject in session-manager PostToolUse (conversation path)"
```

---

## Task 4: Wire Interceptor in `automation-executor.ts` (Automation Path)

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:8-15,94-109,285-293`

- [ ] **Step 1: Add imports**

Add to the imports at top of `automation-executor.ts`:

```typescript
import {
  createBrainQuery,
  loadConfig,
  filterSkillsByTools,
  cleanupSkillFilters,
  parseFrontmatterContent,
  createStopReminder,
  createCapabilityAuditLogger,
  storeAndInject,
  type AuditEntry,
  type StoreCallback,
} from "@my-agent/core";
```

- [ ] **Step 2: Add Playwright MCP server to worker servers**

In the `workerMcpServers` block (after the `image-fetch-tools` block around line 293), add:

```typescript
      // Playwright browser MCP server — enables workers to take web screenshots
      // Uses stdio transport, same as brain's session-manager registration
      workerMcpServers["playwright"] = {
        type: "stdio" as const,
        command: "npx",
        args: ["@playwright/mcp"],
      };
```

- [ ] **Step 3: Update `buildJobHooks()` to include PostToolUse**

Replace the `buildJobHooks` method (lines 94-109):

```typescript
  /** Merge per-job hooks into static config hooks */
  private buildJobHooks(
    todoPath: string | null,
    vasStore?: StoreCallback,
  ): typeof this.config.hooks {
    const hooks = {
      ...(this.config.hooks ?? {}),
    };

    // Stop hook — remind worker to update todos
    if (todoPath) {
      hooks.Stop = [
        ...(this.config.hooks?.Stop ?? []),
        {
          hooks: [createStopReminder(todoPath)],
        },
      ];
    }

    // PostToolUse hook — screenshot pipeline
    if (vasStore) {
      const auditLogPath = path.join(this.config.agentDir, 'logs', 'capability-audit.jsonl');
      const capAuditLogger = createCapabilityAuditLogger(async (entry: AuditEntry) => {
        try {
          await fs.promises.mkdir(path.dirname(auditLogPath), { recursive: true });
          await fs.promises.appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8');
        } catch {
          // Best-effort
        }
      });

      hooks.PostToolUse = [
        ...(this.config.hooks?.PostToolUse ?? []),
        {
          hooks: [
            async (input: { tool_name?: string; tool_response?: unknown; session_id: string }) => {
              const toolName = input.tool_name ?? 'unknown';

              if (toolName.startsWith('desktop_')) {
                await capAuditLogger.log({
                  capabilityName: 'desktop-x11',
                  toolName,
                  sessionId: input.session_id,
                });
              }

              const toolResponse = input.tool_response;
              return storeAndInject(toolResponse, toolName, vasStore);
            },
          ],
        },
      ];
    }

    return hooks;
  }
```

- [ ] **Step 4: Update all `buildJobHooks()` call sites to pass VAS store**

Find every call to `buildJobHooks` and pass the VAS store callback. There are 2 call sites:

**Call site 1** (around line 325, initial job execution):

```typescript
      // Build VAS store callback for screenshot pipeline
      const vasStore: StoreCallback | undefined = this.config.visualService
        ? (image, metadata) => {
            const ss = this.config.visualService!.store(image, metadata)
            return { id: ss.id, filename: ss.filename }
          }
        : undefined;

      const query = createBrainQuery(userMessage, {
        // ... existing options ...
        hooks: this.buildJobHooks(todoPath, vasStore),
        // ...
      });
```

**Call site 2** (around line 614, resume path):

```typescript
            hooks: this.buildJobHooks(
              job.run_dir ? path.join(job.run_dir, "todos.json") : null,
              vasStore,  // pass same vasStore
            ),
```

For call site 2, `vasStore` needs to be computed before the resume block. Add the `vasStore` computation at the start of the `resumeJob` method.

- [ ] **Step 5: Build and TypeScript check**

```bash
cd packages/core && npx tsc
cd packages/dashboard && npx tsc --noEmit
```

Expected: Clean

- [ ] **Step 6: Run dashboard test suite**

```bash
cd packages/dashboard && npx vitest run
```

Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts
git commit -m "feat(dashboard): wire screenshot pipeline + Playwright MCP in automation workers"
```

---

## Task 5: Add Brain Curation Instructions

**Files:**
- Modify: `.my_agent/capabilities/desktop-x11/CAPABILITY.md`
- Modify: `packages/dashboard/src/automations/working-nina-prompt.ts` (or wherever the worker system prompt is built)

- [ ] **Step 1: Read the current CAPABILITY.md**

```bash
cat .my_agent/capabilities/desktop-x11/CAPABILITY.md
```

- [ ] **Step 2: Add screenshot curation instruction to CAPABILITY.md**

Append to the instructions section of `.my_agent/capabilities/desktop-x11/CAPABILITY.md`:

```markdown

## Screenshot Display

After completing a visual task, include the most relevant screenshot URL(s) as markdown images in your reply. The framework stores every screenshot and provides you with URLs in the format `Screenshot URL: /api/assets/screenshots/ss-xxx.png`. Don't include every intermediate screenshot — pick the ones that show the result or key moments. Use standard markdown: `![description](url)`
```

- [ ] **Step 3: Read the worker prompt builder**

```bash
head -60 packages/dashboard/src/automations/working-nina-prompt.ts
```

- [ ] **Step 4: Add curation instruction to worker prompt**

Find where the worker system prompt is assembled and add:

```typescript
// Screenshot curation — tell worker to include visual results in summary
const screenshotGuidance = `
When your task involves visual output (screenshots, images), include the most relevant screenshot URL(s) as markdown images in your summary. The framework provides URLs in the format "Screenshot URL: /api/assets/screenshots/ss-xxx.png". Pick the result, not the journey. Use standard markdown: ![description](url)`;
```

Append `screenshotGuidance` to the system prompt string.

- [ ] **Step 5: Commit**

```bash
git add .my_agent/capabilities/desktop-x11/CAPABILITY.md packages/dashboard/src/automations/working-nina-prompt.ts
git commit -m "feat: add screenshot curation instructions for brain and automation workers"
```

---

## Task 6: Integration Test — Full PostToolUse Chain

**Files:**
- Create: `packages/dashboard/tests/integration/screenshot-pipeline.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VisualActionService } from '../../src/visual/visual-action-service.js'
import { storeAndInject, type StoreCallback } from '@my-agent/core'

describe('Screenshot pipeline integration', () => {
  let tempDir: string
  let vas: VisualActionService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vas-test-'))
    vas = new VisualActionService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Minimal 1x1 red PNG as base64
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='

  it('stores screenshot in VAS and injects URL into tool output', () => {
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [
        { type: 'text', text: JSON.stringify({ description: 'Screenshot captured', width: 1920, height: 1080 }) },
        { type: 'image', data: PNG_B64 },
      ],
    }

    const result = storeAndInject(toolResponse, 'desktop_screenshot', store)

    // VAS has the screenshot on disk
    const screenshots = vas.list()
    expect(screenshots).toHaveLength(1)
    expect(screenshots[0].source).toBe('desktop')
    expect(screenshots[0].width).toBe(1920)

    // Output has URL injected
    expect(result.hookSpecificOutput).toBeDefined()
    const updated = result.hookSpecificOutput!.updatedMCPToolOutput as { content: unknown[] }
    expect(updated.content).toHaveLength(3)
    const urlBlock = updated.content[2] as { type: string; text: string }
    expect(urlBlock.text).toContain(screenshots[0].filename)
  })

  it('does not store non-image tool results', () => {
    const store: StoreCallback = () => { throw new Error('should not be called') }
    const toolResponse = { content: [{ type: 'text', text: 'hello' }] }

    const result = storeAndInject(toolResponse, 'desktop_info', store)

    expect(result).toEqual({})
    expect(vas.list()).toHaveLength(0)
  })

  it('handles Playwright source detection', () => {
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [
        { type: 'image', data: PNG_B64 },
      ],
    }

    storeAndInject(toolResponse, 'browser_take_screenshot', store)

    const screenshots = vas.list()
    expect(screenshots).toHaveLength(1)
    expect(screenshots[0].source).toBe('playwright')
  })

  it('ref scanner picks up screenshot URLs from conversation turn content', () => {
    // Store a screenshot first
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [
        { type: 'image', data: PNG_B64 },
      ],
    }

    const result = storeAndInject(toolResponse, 'desktop_screenshot', store)
    const screenshots = vas.list()
    const ssFilename = screenshots[0].filename

    // Simulate a conversation turn containing the screenshot URL
    const turnContent = `Here is what I see: ![screenshot](/api/assets/screenshots/${ssFilename})`
    const urlPattern = /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+\.png)/g
    const matches = [...turnContent.matchAll(urlPattern)]

    // Add refs like the real onTurnAppended handler does
    const batch = matches.map(m => ({ id: m[1].replace('.png', ''), ref: 'conv/test-conversation' }))
    // Note: VAS.addRefs takes { id, ref }[] — id is the screenshot ID without extension
    vas.addRefs(batch)

    // Verify ref was added
    const updated = vas.list()
    expect(updated[0].refs).toContain('conv/test-conversation')
  })

  it('automation job summary can reference stored screenshots', () => {
    // Simulate a worker tool call producing a screenshot
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [
        { type: 'text', text: JSON.stringify({ description: 'Page loaded', width: 1280, height: 720 }) },
        { type: 'image', data: PNG_B64 },
      ],
    }

    storeAndInject(toolResponse, 'browser_take_screenshot', store)
    const screenshots = vas.list()
    const ssFilename = screenshots[0].filename

    // Simulate worker composing a job summary with the screenshot URL
    const jobSummary = `Homepage captured: ![cnn](/api/assets/screenshots/${ssFilename})`

    // Verify the URL is present and resolvable
    const urlPattern = /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+\.png)/g
    const matches = [...jobSummary.matchAll(urlPattern)]
    expect(matches).toHaveLength(1)
    expect(matches[0][1]).toBe(ssFilename)

    // Add refs like the real job:completed handler does
    const batch = matches.map(m => ({ id: m[1].replace('.png', ''), ref: 'job/auto-1/job-1' }))
    vas.addRefs(batch)

    const updated = vas.list()
    expect(updated[0].refs).toContain('job/auto-1/job-1')
  })
})
```

- [ ] **Step 2: Run the integration test**

```bash
cd packages/dashboard && npx vitest run tests/integration/screenshot-pipeline.test.ts
```

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/integration/screenshot-pipeline.test.ts
git commit -m "test(dashboard): integration test for screenshot pipeline (VAS + storeAndInject)"
```

---

## Task 7: Smoke Test — KWrite Desktop Read (Conversation Path)

**Files:**
- Create: `packages/dashboard/tests/smoke/screenshot-desktop.test.ts`

This test uses the headless App with a real brain session. It requires a running desktop with KWrite open and minimized with some text.

- [ ] **Step 1: Write the smoke test**

```typescript
import { describe, it, expect } from 'vitest'
import { AppHarness } from '../../src/testing/app-harness.js'

describe('Smoke: desktop screenshot pipeline', { timeout: 120_000 }, () => {
  it('brain takes desktop screenshots, curates one into reply', async () => {
    const app = await AppHarness.create()

    try {
      // Send the prompt — brain should use desktop tools to read KWrite
      const reply = await app.chat.sendMessage(
        'Read the text from my unsaved work on KWrite, it is minimized.',
      )

      // Brain's reply should contain at least one screenshot URL
      const urlPattern = /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+\.png)/g
      const matches = [...reply.content.matchAll(urlPattern)]
      expect(matches.length).toBeGreaterThanOrEqual(1)

      // VAS should have multiple screenshots (intermediate + final)
      const allScreenshots = app.visualActionService.list()
      expect(allScreenshots.length).toBeGreaterThanOrEqual(2)

      // Brain curated: reply has fewer URLs than total screenshots
      expect(matches.length).toBeLessThan(allScreenshots.length)

      // The referenced screenshot should exist on disk
      for (const match of matches) {
        const filename = match[1]
        const screenshot = allScreenshots.find(s => s.filename === filename)
        expect(screenshot).toBeDefined()
        expect(screenshot!.source).toBe('desktop')
      }
    } finally {
      await app.shutdown()
    }
  })
})
```

- [ ] **Step 2: Run the smoke test**

Prerequisite: KWrite must be open (minimized) with some text in it.

```bash
cd packages/dashboard && npx vitest run tests/smoke/screenshot-desktop.test.ts
```

Expected: PASS — brain uses desktop tools, screenshots stored in VAS, reply contains curated screenshot URL.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/smoke/screenshot-desktop.test.ts
git commit -m "test(smoke): KWrite desktop screenshot pipeline — brain curates inline images"
```

---

## Task 8: Smoke Test — CNN Scheduled Automation (Automation Path)

**Files:**
- Create: `packages/dashboard/tests/smoke/screenshot-automation.test.ts`

This test uses the headless App to schedule a one-time automation, then verifies the worker's job summary contains a curated screenshot.

- [ ] **Step 1: Write the smoke test**

```typescript
import { describe, it, expect } from 'vitest'
import { AppHarness } from '../../src/testing/app-harness.js'

describe('Smoke: automation screenshot pipeline', { timeout: 300_000 }, () => {
  it('scheduled automation takes web screenshot, curates into job summary', async () => {
    const app = await AppHarness.create()

    try {
      // Ask brain to schedule a one-time automation
      const reply = await app.chat.sendMessage(
        'Schedule a one-time automation to run in 15 minutes: take a screenshot of cnn.com and show me the homepage.',
      )

      // Brain should acknowledge scheduling
      expect(reply.content.toLowerCase()).toMatch(/schedul|automat|set up/)

      // Wait for the automation to execute
      // The brain should create the automation — find it
      const automations = await app.automations.list()
      const cnnAutomation = automations.find(a =>
        a.instructions?.toLowerCase().includes('cnn') ||
        a.name?.toLowerCase().includes('cnn'),
      )
      expect(cnnAutomation).toBeDefined()

      // Fast-forward: trigger the automation immediately for testing
      const job = await app.automations.triggerNow(cnnAutomation!.id)
      expect(job).toBeDefined()

      // Wait for job to complete
      await app.automations.waitForJob(job!.id, { timeoutMs: 180_000 })

      // Check the job result
      const completedJob = await app.automations.getJob(job!.id)
      expect(completedJob.status).toBe('completed')

      // Job summary should contain screenshot URL(s)
      const urlPattern = /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+\.png)/g
      const summaryMatches = [...(completedJob.summary ?? '').matchAll(urlPattern)]
      expect(summaryMatches.length).toBeGreaterThanOrEqual(1)

      // VAS should have multiple screenshots stored
      const allScreenshots = app.visualActionService.list()
      const jobScreenshots = allScreenshots.filter(s =>
        s.refs.some(r => r.includes(completedJob.id)),
      )
      // The ref scanner indexes on job:completed, so refs should be set
      // (allow for eventual consistency — check after a brief delay if needed)

      // The summary screenshot should exist on disk
      for (const match of summaryMatches) {
        const filename = match[1]
        const screenshot = allScreenshots.find(s => s.filename === filename)
        expect(screenshot).toBeDefined()
      }
    } finally {
      await app.shutdown()
    }
  })
})
```

- [ ] **Step 2: Run the smoke test**

```bash
cd packages/dashboard && npx vitest run tests/smoke/screenshot-automation.test.ts
```

Expected: PASS — automation worker navigates CNN, stores screenshots, curates one into job summary.

Note: If CNN is unreliable, change the URL to `example.com` in the prompt. The test validates the pipeline, not the website.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/smoke/screenshot-automation.test.ts
git commit -m "test(smoke): CNN automation screenshot pipeline — worker curates into job summary"
```

---

## Task 9: Full Test Suite + TypeScript Verification

**Files:** None (verification only)

- [ ] **Step 1: Build core**

```bash
cd packages/core && npx tsc
```

Expected: Clean

- [ ] **Step 2: Run core tests**

```bash
cd packages/core && npx vitest run
```

Expected: All pass (existing + new)

- [ ] **Step 3: Build dashboard**

```bash
cd packages/dashboard && npx tsc --noEmit
```

Expected: Clean

- [ ] **Step 4: Run dashboard tests (excluding smoke)**

```bash
cd packages/dashboard && npx vitest run --exclude='tests/smoke/**'
```

Expected: All pass

- [ ] **Step 5: Run both smoke tests**

Prerequisites:
- KWrite open and minimized with text
- Internet access for CNN

```bash
cd packages/dashboard && npx vitest run tests/smoke/screenshot-desktop.test.ts
cd packages/dashboard && npx vitest run tests/smoke/screenshot-automation.test.ts
```

Expected: Both PASS

- [ ] **Step 6: Update ROADMAP**

In `docs/ROADMAP.md`, update S6 status from "Planned" to "Done". Also fix S5 status if still "Planned" (noted in S5 review as a gap).

- [ ] **Step 7: Final commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): mark M9.5-S6 as Done"
```
