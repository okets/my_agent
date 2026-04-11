# M9.5-S3 Desktop Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract desktop platform code from the framework into a standalone MCP capability at `.my_agent/capabilities/desktop-x11/`, wire it through the capability registry, activate S1-deferred middleware, and delete the old hardcoded desktop code.

**Architecture:** The desktop MCP server becomes a standalone process (no `@my-agent/core` imports) spawned by `McpCapabilitySpawner`. Framework-side middleware (rate limiter, audit logger, screenshot interceptor) applies via PostToolUse hooks in the session manager. The registry's existing `toggle()` / `.enabled` mechanism replaces the old `.desktop-enabled` flag file.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, vitest, Node.js child_process

**Design spec:** `docs/design/capability-framework-v2.md` (S3 section)

---

## File Map

### New files (capability folder — gitignored, lives in `.my_agent/`)

| File | Purpose |
|------|---------|
| `.my_agent/capabilities/desktop-x11/CAPABILITY.md` | Frontmatter: name, provides, interface, entrypoint, requires.system |
| `.my_agent/capabilities/desktop-x11/config.yaml` | Rate limit config (maxPerMinute) |
| `.my_agent/capabilities/desktop-x11/package.json` | Dependencies: `@modelcontextprotocol/sdk`, `zod` |
| `.my_agent/capabilities/desktop-x11/scripts/detect.sh` | Exit 0 if X11 + tools available, exit 1 with JSON diagnostics |
| `.my_agent/capabilities/desktop-x11/scripts/setup.sh` | `apt install xdotool maim wmctrl && npm install` |
| `.my_agent/capabilities/desktop-x11/src/server.ts` | Standalone MCP server — 7 tools (desktop_info, desktop_screenshot, desktop_click, desktop_type, desktop_key, desktop_scroll, desktop_wait) |
| `.my_agent/capabilities/desktop-x11/src/x11-backend.ts` | Copied from `dashboard/src/desktop/x11-backend.ts`, self-contained types |
| `.my_agent/capabilities/desktop-x11/src/scaling.ts` | `computeScaleFactor` + `toScreenCoord` extracted from desktop-action-server |
| `.my_agent/capabilities/desktop-x11/src/types.ts` | Local type definitions (replaces `@my-agent/core` imports) |
| `.my_agent/capabilities/desktop-x11/.enabled` | Migrated from `.my_agent/.desktop-enabled` |
| `.my_agent/capabilities/desktop-x11/DECISIONS.md` | Empty decisions log |

### New files (framework — committed)

| File | Purpose |
|------|---------|
| `packages/core/tests/capabilities/mcp-spawner-crash.test.ts` | Spawner crash event → registry health degraded |
| `packages/core/tests/capabilities/middleware-wiring.test.ts` | Middleware chain PostToolUse hook tests |
| `packages/core/tests/capabilities/desktop-extraction.test.ts` | Integration: registry-based desktop wiring, toggle on/off |
| `packages/core/tests/fixtures/desktop-x11-fixture/` | Test-only copy of the capability folder for CI (since `.my_agent/` is gitignored) |

### Modified files

| File | Change |
|------|--------|
| `packages/dashboard/src/app.ts` | Replace hardcoded desktop block (lines 1657-1728) with registry-based wiring; add spawner crash → registry health listener; wire middleware PostToolUse hooks |
| `packages/dashboard/src/agent/session-manager.ts` | Add PostToolUse hook for capability middleware chain |
| `packages/core/src/capabilities/mcp-middleware.ts` | Make audit logger writer accept `Promise<void>` return (async-compatible) |
| `packages/core/src/capabilities/mcp-spawner.ts` | Add runtime warning log when `_process` is null |

### Deleted files

| File | Reason |
|------|--------|
| `packages/dashboard/src/desktop/x11-backend.ts` | Moved to capability folder |
| `packages/dashboard/src/desktop/desktop-capability-detector.ts` | Moved to capability detect.sh |
| `packages/dashboard/src/desktop/computer-use-service.ts` | Deleted — not MCP-based, not extracted |
| `packages/dashboard/src/mcp/desktop-server.ts` | Replaced by capability server.ts |
| `packages/dashboard/src/mcp/desktop-action-server.ts` | Replaced by capability server.ts |
| `packages/dashboard/src/routes/desktop.ts` | Replaced by generic capability routes (S2) |
| `packages/dashboard/src/hooks/desktop-hooks.ts` | Replaced by framework middleware |

---

## Task 1: Make audit logger writer async-compatible

S1 deferred item. The `createCapabilityAuditLogger` writer callback currently accepts `(entry) => void`. Change to `(entry) => void | Promise<void>` so it can write to JSONL files.

**Files:**
- Modify: `packages/core/src/capabilities/mcp-middleware.ts:50-63`

- [ ] **Step 1: Update writer type signature**

In `packages/core/src/capabilities/mcp-middleware.ts`, change the writer parameter type:

```typescript
// Before
export function createCapabilityAuditLogger(
  writer: (entry: AuditEntry) => void,
): AuditLogger {

// After
export function createCapabilityAuditLogger(
  writer: (entry: AuditEntry) => void | Promise<void>,
): AuditLogger {
```

The `log` method is already async, so it can already await the writer. Add the await:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/capabilities/mcp-middleware.ts
git commit -m "feat(capabilities): make audit logger writer async-compatible (S1 deferred)"
```

---

## Task 2: Add spawner runtime warning for null process reference

S1 deferred item. When `_process` access returns null (SDK internals change), log a warning instead of silently continuing.

**Files:**
- Modify: `packages/core/src/capabilities/mcp-spawner.ts:64-65`

- [ ] **Step 1: Add warning log after process access**

In `packages/core/src/capabilities/mcp-spawner.ts`, after the `_process` access on line 65:

```typescript
    // Get child process reference from transport for lifecycle management
    const childProcess = (transport as unknown as { _process?: ChildProcess })._process ?? null
    if (!childProcess) {
      console.warn(
        `[McpSpawner] Warning: cannot access child process for "${capability.name}" — ` +
        `crash recovery and graceful shutdown unavailable. ` +
        `This may indicate an MCP SDK update changed internal transport structure.`,
      )
    }
    const pid = childProcess?.pid ?? 0
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/capabilities/mcp-spawner.ts
git commit -m "feat(capabilities): warn when spawner can't access child process (S1 deferred)"
```

---

## Task 3: Create desktop-x11 capability folder — types and backend

Extract types and x11-backend to the capability folder as standalone (no framework imports).

**Files:**
- Create: `.my_agent/capabilities/desktop-x11/src/types.ts`
- Create: `.my_agent/capabilities/desktop-x11/src/x11-backend.ts`

- [ ] **Step 1: Create capability directory structure**

```bash
mkdir -p .my_agent/capabilities/desktop-x11/{src,scripts,references}
```

- [ ] **Step 2: Create local types.ts**

The standalone server needs its own type definitions — no `@my-agent/core` imports allowed.

Write `.my_agent/capabilities/desktop-x11/src/types.ts`:

```typescript
/** Local type definitions for desktop-x11 capability (standalone — no framework imports) */

export interface DesktopCapabilities {
  screenshot: boolean
  mouse: boolean
  keyboard: boolean
  windowManagement: boolean
  accessibility: boolean
}

export interface WindowInfo {
  id: string
  title: string
  appName: string
  geometry: { x: number; y: number; width: number; height: number }
  focused: boolean
}

export interface MonitorInfo {
  name: string
  x: number
  y: number
  width: number
  height: number
  primary: boolean
}

export interface DisplayInfo {
  width: number
  height: number
  scaleFactor: number
  displayNumber?: number
  monitors: MonitorInfo[]
}

export interface ScreenshotOptions {
  region?: { x: number; y: number; width: number; height: number }
  windowId?: string
}

export interface DesktopBackend {
  readonly platform: 'x11' | 'wayland' | 'macos'
  capabilities(): DesktopCapabilities
  screenshot(options?: ScreenshotOptions): Promise<Buffer>
  click(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void>
  doubleClick(x: number, y: number): Promise<void>
  type(text: string): Promise<void>
  keyPress(keys: string): Promise<void>
  mouseMove(x: number, y: number): Promise<void>
  mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void>
  scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void>
  listWindows(): Promise<WindowInfo[]>
  activeWindow(): Promise<WindowInfo | null>
  focusWindow(windowId: string): Promise<void>
  windowScreenshot(windowId: string): Promise<Buffer>
  displayInfo(): Promise<DisplayInfo>
}

export interface X11ToolAvailability {
  hasXdotool: boolean
  hasMaim: boolean
  hasWmctrl: boolean
}
```

- [ ] **Step 3: Create x11-backend.ts (self-contained)**

Copy from `packages/dashboard/src/desktop/x11-backend.ts` but replace the import to use local types:

Write `.my_agent/capabilities/desktop-x11/src/x11-backend.ts`:

```typescript
import { execFileSync } from 'node:child_process'
import type {
  DesktopBackend,
  DesktopCapabilities,
  WindowInfo,
  DisplayInfo,
  ScreenshotOptions,
  X11ToolAvailability,
} from './types.js'

const EXEC_OPTIONS = { timeout: 5000, stdio: 'pipe' as const }

const BUTTON_MAP: Record<'left' | 'right' | 'middle', string> = {
  left: '1',
  middle: '2',
  right: '3',
}

const SCROLL_MAP: Record<'up' | 'down' | 'left' | 'right', string> = {
  up: '4',
  down: '5',
  left: '6',
  right: '7',
}

export class X11Backend implements DesktopBackend {
  readonly platform = 'x11' as const
  private readonly caps: DesktopCapabilities

  constructor(private readonly tools: X11ToolAvailability) {
    this.caps = {
      screenshot: tools.hasMaim,
      mouse: tools.hasXdotool,
      keyboard: tools.hasXdotool,
      windowManagement: tools.hasWmctrl,
      accessibility: false,
    }
  }

  capabilities(): DesktopCapabilities { return { ...this.caps } }

  private requireCapability(cap: keyof DesktopCapabilities): void {
    if (!this.caps[cap]) throw new Error(`Desktop "${cap}" not available. Missing tools.`)
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    this.requireCapability('screenshot')
    const args = ['--format', 'png', '--hidecursor']
    if (options?.windowId) { args.push('--window', options.windowId) }
    else if (options?.region) {
      const { x, y, width, height } = options.region
      args.push('--geometry', `${width}x${height}+${x}+${y}`)
    }
    return execFileSync('maim', args, { ...EXEC_OPTIONS, encoding: 'buffer' })
  }

  async click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    this.requireCapability('mouse')
    execFileSync('xdotool', ['mousemove', '--sync', String(x), String(y)], EXEC_OPTIONS)
    execFileSync('xdotool', ['click', BUTTON_MAP[button]], EXEC_OPTIONS)
  }

  async doubleClick(x: number, y: number): Promise<void> {
    this.requireCapability('mouse')
    execFileSync('xdotool', ['mousemove', '--sync', String(x), String(y)], EXEC_OPTIONS)
    execFileSync('xdotool', ['click', '--repeat', '2', '--delay', '50', BUTTON_MAP.left], EXEC_OPTIONS)
  }

  async type(text: string): Promise<void> {
    this.requireCapability('keyboard')
    execFileSync('xdotool', ['type', '--delay', '12', text], EXEC_OPTIONS)
  }

  async keyPress(keys: string): Promise<void> {
    this.requireCapability('keyboard')
    execFileSync('xdotool', ['key', keys], EXEC_OPTIONS)
  }

  async mouseMove(x: number, y: number): Promise<void> {
    this.requireCapability('mouse')
    execFileSync('xdotool', ['mousemove', '--sync', String(x), String(y)], EXEC_OPTIONS)
  }

  async mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    this.requireCapability('mouse')
    execFileSync('xdotool', ['mousemove', '--sync', String(fromX), String(fromY)], EXEC_OPTIONS)
    execFileSync('xdotool', ['mousedown', BUTTON_MAP.left], EXEC_OPTIONS)
    execFileSync('xdotool', ['mousemove', '--sync', String(toX), String(toY)], EXEC_OPTIONS)
    execFileSync('xdotool', ['mouseup', BUTTON_MAP.left], EXEC_OPTIONS)
  }

  async scroll(x: number, y: number, direction: 'up'|'down'|'left'|'right', amount = 3): Promise<void> {
    this.requireCapability('mouse')
    execFileSync('xdotool', ['mousemove', '--sync', String(x), String(y)], EXEC_OPTIONS)
    for (let i = 0; i < amount; i++) {
      execFileSync('xdotool', ['click', SCROLL_MAP[direction]], EXEC_OPTIONS)
    }
  }

  async listWindows(): Promise<WindowInfo[]> {
    this.requireCapability('windowManagement')
    try {
      const output = execFileSync('wmctrl', ['-l'], { ...EXEC_OPTIONS, encoding: 'utf8' })
      return parseWmctrlOutput(output)
    } catch {
      if (this.tools.hasXdotool) {
        const output = execFileSync('xdotool', ['search', '--name', ''], { ...EXEC_OPTIONS, encoding: 'utf8' })
        return output.trim().split('\n').filter(Boolean).map((id) => ({
          id: id.trim(), title: '', appName: '', geometry: { x: 0, y: 0, width: 0, height: 0 }, focused: false,
        }))
      }
      return []
    }
  }

  async activeWindow(): Promise<WindowInfo | null> {
    this.requireCapability('windowManagement')
    try {
      const idRaw = execFileSync('xdotool', ['getactivewindow'], { ...EXEC_OPTIONS, encoding: 'utf8' }).trim()
      const titleRaw = execFileSync('xdotool', ['getwindowname', idRaw], { ...EXEC_OPTIONS, encoding: 'utf8' }).trim()
      return { id: idRaw, title: titleRaw, appName: '', geometry: { x: 0, y: 0, width: 0, height: 0 }, focused: true }
    } catch { return null }
  }

  async focusWindow(windowId: string): Promise<void> {
    this.requireCapability('windowManagement')
    execFileSync('xdotool', ['windowactivate', '--sync', windowId], EXEC_OPTIONS)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  async windowScreenshot(windowId: string): Promise<Buffer> {
    this.requireCapability('screenshot')
    return execFileSync('maim', ['--format', 'png', '--hidecursor', '--window', windowId], { ...EXEC_OPTIONS, encoding: 'buffer' })
  }

  async displayInfo(): Promise<DisplayInfo> {
    let width = 0, height = 0
    try {
      const xdpyinfo = execFileSync('xdpyinfo', [], { ...EXEC_OPTIONS, encoding: 'utf8' })
      const dimMatch = xdpyinfo.match(/dimensions:\s+(\d+)x(\d+)\s+pixels/)
      if (dimMatch) { width = parseInt(dimMatch[1], 10); height = parseInt(dimMatch[2], 10) }
    } catch {}

    const monitors: DisplayInfo['monitors'] = []
    try {
      const xrandr = execFileSync('xrandr', ['--query'], { ...EXEC_OPTIONS, encoding: 'utf8' })
      for (const line of xrandr.split('\n')) {
        const m = line.match(/^(\S+)\s+connected(?:\s+primary)?\s+(\d+)x(\d+)\+(\d+)\+(\d+)/)
        if (m) {
          monitors.push({ name: m[1], width: parseInt(m[2], 10), height: parseInt(m[3], 10), x: parseInt(m[4], 10), y: parseInt(m[5], 10), primary: line.includes(' primary ') })
        }
      }
    } catch {}

    return { width, height, scaleFactor: 1, displayNumber: 0, monitors }
  }
}

function parseWmctrlOutput(output: string): WindowInfo[] {
  return output.trim().split('\n').filter(Boolean).map((line) => {
    const parts = line.split(/\s+/)
    const id = parts[0] ?? ''
    const title = parts.slice(3).join(' ')
    return { id, title, appName: '', geometry: { x: 0, y: 0, width: 0, height: 0 }, focused: false }
  })
}
```

- [ ] **Step 4: Commit**

```bash
git add .my_agent/capabilities/desktop-x11/src/types.ts .my_agent/capabilities/desktop-x11/src/x11-backend.ts
git commit -m "feat(desktop-x11): extract types and x11-backend to standalone capability"
```

**Note:** `.my_agent/` is gitignored. This commit will be empty unless the gitignore is temporarily adjusted. The capability folder is created for runtime use. For CI testing, Task 9 creates a committed test fixture.

---

## Task 4: Create desktop-x11 capability — scaling, server, and metadata

Create the standalone MCP server that replaces both `desktop-server.ts` and `desktop-action-server.ts`. Also create CAPABILITY.md, config.yaml, package.json, scripts, and DECISIONS.md.

**Files:**
- Create: `.my_agent/capabilities/desktop-x11/src/scaling.ts`
- Create: `.my_agent/capabilities/desktop-x11/src/server.ts`
- Create: `.my_agent/capabilities/desktop-x11/CAPABILITY.md`
- Create: `.my_agent/capabilities/desktop-x11/config.yaml`
- Create: `.my_agent/capabilities/desktop-x11/package.json`
- Create: `.my_agent/capabilities/desktop-x11/scripts/detect.sh`
- Create: `.my_agent/capabilities/desktop-x11/scripts/setup.sh`
- Create: `.my_agent/capabilities/desktop-x11/DECISIONS.md`

- [ ] **Step 1: Create scaling.ts**

Write `.my_agent/capabilities/desktop-x11/src/scaling.ts`:

```typescript
/** Coordinate scaling for API ↔ screen coordinate translation */

const MAX_LONG_EDGE = 1568
const MAX_MEGAPIXELS = 1.15

/**
 * Compute a scale factor to fit display dimensions within API limits.
 * Returns a value between 0 and 1 (1 = no scaling needed).
 */
export function computeScaleFactor(width: number, height: number): number {
  const longEdge = Math.max(width, height)
  const edgeFactor = MAX_LONG_EDGE / longEdge
  const megapixels = (width * height) / 1_000_000
  const mpFactor = Math.sqrt(MAX_MEGAPIXELS / megapixels)
  return Math.min(1, edgeFactor, mpFactor)
}

/**
 * Convert an API coordinate to a screen coordinate using the scale factor.
 */
export function toScreenCoord(apiCoord: number, scaleFactor: number): number {
  return Math.round(apiCoord / scaleFactor)
}
```

- [ ] **Step 2: Create server.ts — standalone MCP server**

This is the main entrypoint. It merges the tools from both `desktop-server.ts` (desktop_info) and `desktop-action-server.ts` (desktop_screenshot, desktop_click, desktop_type, desktop_key, desktop_scroll, desktop_wait) into a single MCP server.

**Critical constraint:** No imports from `@my-agent/core` or any framework package.

Write `.my_agent/capabilities/desktop-x11/src/server.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * Desktop X11 Capability — Standalone MCP Server
 *
 * Provides desktop control tools via X11 (xdotool, maim, wmctrl).
 * Runs as a child process spawned by McpCapabilitySpawner.
 * No framework imports — all middleware (rate limiting, audit, screenshot
 * interception) is applied by the framework via PostToolUse hooks.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { X11Backend } from './x11-backend.js'
import { computeScaleFactor, toScreenCoord } from './scaling.js'
import type { DesktopBackend } from './types.js'

// ── Detect tools ──

import { execFileSync } from 'node:child_process'

function hasCmd(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' })
    return true
  } catch { return false }
}

const tools = {
  hasXdotool: hasCmd('xdotool'),
  hasMaim: hasCmd('maim'),
  hasWmctrl: hasCmd('wmctrl'),
}

const backend: DesktopBackend = new X11Backend(tools)

// ── Compute scale factor once at startup ──

const display = await backend.displayInfo()
const scaleFactor = computeScaleFactor(display.width, display.height)

// ── Helper: take screenshot and return as base64 image content ──

async function screenshotResult(description: string): Promise<{
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
}> {
  const buf = await backend.screenshot()
  const base64 = buf.toString('base64')
  return {
    content: [
      { type: 'text', text: description },
      { type: 'image', data: base64, mimeType: 'image/png' },
    ],
  }
}

// ── MCP Server ──

const server = new McpServer({ name: 'desktop-x11', version: '1.0.0' })

// Tool 1: desktop_info — query desktop environment
server.tool(
  'desktop_info',
  'Query desktop environment information (windows, display, capabilities)',
  { query: z.enum(['windows', 'display', 'capabilities']) },
  async ({ query }) => {
    switch (query) {
      case 'capabilities':
        return {
          content: [{ type: 'text', text: JSON.stringify({
            capabilities: backend.capabilities(),
            platform: backend.platform,
            available: true,
          }) }],
        }
      case 'windows': {
        const windows = await backend.listWindows()
        return { content: [{ type: 'text', text: JSON.stringify({ windows }) }] }
      }
      case 'display': {
        const info = await backend.displayInfo()
        return { content: [{ type: 'text', text: JSON.stringify(info) }] }
      }
    }
  },
)

// Tool 2: desktop_screenshot — capture screen or region
server.tool(
  'desktop_screenshot',
  'Take a screenshot of the entire screen or a specific region',
  {
    region: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).optional(),
  },
  async ({ region }) => {
    const buf = await backend.screenshot(region ? { region } : undefined)
    const base64 = buf.toString('base64')
    return {
      content: [
        { type: 'text', text: 'Screenshot captured' },
        { type: 'image', data: base64, mimeType: 'image/png' },
      ],
    }
  },
)

// Tool 3: desktop_click — click at coordinates
server.tool(
  'desktop_click',
  'Click at screen coordinates (coordinates are auto-scaled)',
  {
    x: z.number(),
    y: z.number(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    double: z.boolean().optional(),
  },
  async ({ x, y, button, double }) => {
    const sx = toScreenCoord(x, scaleFactor)
    const sy = toScreenCoord(y, scaleFactor)
    if (double) {
      await backend.doubleClick(sx, sy)
    } else {
      await backend.click(sx, sy, button ?? 'left')
    }
    return screenshotResult(`Clicked at (${sx}, ${sy})`)
  },
)

// Tool 4: desktop_type — type text
server.tool(
  'desktop_type',
  'Type text using the keyboard',
  { text: z.string() },
  async ({ text }) => {
    await backend.type(text)
    return screenshotResult(`Typed: ${text.slice(0, 50)}`)
  },
)

// Tool 5: desktop_key — press key combination
server.tool(
  'desktop_key',
  'Press a key or key combination (e.g. "Return", "ctrl+c", "alt+Tab")',
  { key: z.string() },
  async ({ key }) => {
    await backend.keyPress(key)
    return screenshotResult(`Pressed: ${key}`)
  },
)

// Tool 6: desktop_scroll — scroll at coordinates
server.tool(
  'desktop_scroll',
  'Scroll at screen coordinates',
  {
    x: z.number(),
    y: z.number(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().min(1).max(20).optional(),
  },
  async ({ x, y, direction, amount }) => {
    const sx = toScreenCoord(x, scaleFactor)
    const sy = toScreenCoord(y, scaleFactor)
    await backend.scroll(sx, sy, direction, amount ?? 3)
    return screenshotResult(`Scrolled ${direction} at (${sx}, ${sy})`)
  },
)

// Tool 7: desktop_wait — pause before next action
server.tool(
  'desktop_wait',
  'Wait for a specified number of seconds (useful for animations or loading)',
  { seconds: z.number().min(0.1).max(10) },
  async ({ seconds }) => {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    return screenshotResult(`Waited ${seconds}s`)
  },
)

// ── Start ──

const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 3: Create CAPABILITY.md**

Write `.my_agent/capabilities/desktop-x11/CAPABILITY.md`:

```markdown
---
name: Desktop X11
provides: desktop-control
interface: mcp
entrypoint: npx tsx src/server.ts
requires:
  system:
    - xdotool
    - maim
---

# Desktop X11

X11 desktop control via xdotool, maim, and wmctrl.

## Tools

| Tool | Description |
|------|-------------|
| `desktop_info` | Query windows, display, or capabilities |
| `desktop_screenshot` | Capture screen or region |
| `desktop_click` | Click at coordinates (auto-scaled) |
| `desktop_type` | Type text |
| `desktop_key` | Press key combination |
| `desktop_scroll` | Scroll at coordinates |
| `desktop_wait` | Pause between actions |

## Configuration

See `config.yaml` for rate limit settings (applied by framework middleware).
```

- [ ] **Step 4: Create config.yaml**

Write `.my_agent/capabilities/desktop-x11/config.yaml`:

```yaml
# Rate limit applied by framework middleware (not by this server)
maxPerMinute: 30
```

- [ ] **Step 5: Create package.json**

Write `.my_agent/capabilities/desktop-x11/package.json`:

```json
{
  "name": "desktop-x11",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.25.23"
  }
}
```

- [ ] **Step 6: Create scripts/detect.sh**

Write `.my_agent/capabilities/desktop-x11/scripts/detect.sh`:

```bash
#!/usr/bin/env bash
# Detect X11 desktop environment availability
set -e

MISSING=""

# Check DISPLAY is set
if [ -z "$DISPLAY" ]; then
  echo '{"error": "No DISPLAY environment variable set"}' >&2
  exit 1
fi

# Check required tools
for tool in xdotool maim; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING="$MISSING $tool"
  fi
done

if [ -n "$MISSING" ]; then
  echo "{\"error\": \"Missing required tools:$MISSING\"}" >&2
  exit 1
fi

# Optional tools (wmctrl)
OPTIONAL_MISSING=""
if ! command -v wmctrl &>/dev/null; then
  OPTIONAL_MISSING="wmctrl"
fi

if [ -n "$OPTIONAL_MISSING" ]; then
  echo "{\"warning\": \"Optional tools missing: $OPTIONAL_MISSING (window management unavailable)\"}"
fi

exit 0
```

- [ ] **Step 7: Create scripts/setup.sh**

Write `.my_agent/capabilities/desktop-x11/scripts/setup.sh`:

```bash
#!/usr/bin/env bash
# Install desktop-x11 capability dependencies
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="$(dirname "$SCRIPT_DIR")"

# System tools
TOOLS="xdotool maim wmctrl"
MISSING=""

for tool in $TOOLS; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING="$MISSING $tool"
  else
    echo "✓ $tool already installed"
  fi
done

if [ -n "$MISSING" ]; then
  echo "Installing:$MISSING"
  if command -v apt &>/dev/null; then
    sudo apt install -y $MISSING
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y $MISSING
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm $MISSING
  else
    echo "ERROR: No supported package manager found (apt, dnf, pacman)"
    exit 1
  fi
fi

# Node dependencies
cd "$CAP_DIR"
npm install

echo "Desktop X11 capability ready."
```

- [ ] **Step 8: Create empty DECISIONS.md**

Write `.my_agent/capabilities/desktop-x11/DECISIONS.md`:

```markdown
# Decisions
```

- [ ] **Step 9: Make scripts executable and install dependencies**

```bash
chmod +x .my_agent/capabilities/desktop-x11/scripts/detect.sh
chmod +x .my_agent/capabilities/desktop-x11/scripts/setup.sh
cd .my_agent/capabilities/desktop-x11 && npm install
```

- [ ] **Step 10: Commit**

Since `.my_agent/` is gitignored, this doesn't produce a git commit. The capability exists at runtime only. Framework-side test fixtures (Task 9) handle CI.

---

## Task 5: Migrate `.desktop-enabled` to capability `.enabled`

Move the existing `.my_agent/.desktop-enabled` flag file to `.my_agent/capabilities/desktop-x11/.enabled`.

**Files:**
- Move: `.my_agent/.desktop-enabled` → `.my_agent/capabilities/desktop-x11/.enabled`

- [ ] **Step 1: Migrate the flag file**

```bash
if [ -f .my_agent/.desktop-enabled ]; then
  cp .my_agent/.desktop-enabled .my_agent/capabilities/desktop-x11/.enabled
  rm .my_agent/.desktop-enabled
  echo "Migrated .desktop-enabled → capabilities/desktop-x11/.enabled"
else
  echo "No .desktop-enabled flag found — skipping migration"
fi
```

- [ ] **Step 2: Verify registry reads the .enabled file**

The scanner (`packages/core/src/capabilities/scanner.ts:140-141`) already reads `.enabled` from the capability folder:
```typescript
const enabledPath = join(capDir, '.enabled')
const enabled = existsSync(enabledPath)
```

No code changes needed — the scanner already handles this.

---

## Task 6: Wire registry-based desktop in app.ts (dual-path)

Add registry-based desktop wiring in `app.ts` alongside the existing hardcoded path. This is step 2 of the spec-mandated migration sequence.

**Files:**
- Modify: `packages/dashboard/src/app.ts:1657-1728`

- [ ] **Step 1: Add registry-based MCP spawner wiring alongside existing code**

In `packages/dashboard/src/app.ts`, find the desktop control block (starts at line 1657 with `// ── Desktop control (M8-S2) ──`). Add a registry-based path **before** the existing hardcoded block. The existing block stays as fallback during dual-path verification.

Replace the entire `// ── Desktop control (M8-S2) ──` block (lines 1657-1728) with:

```typescript
    // ── Desktop control (M9.5-S3: registry-based) ──
    {
      // Registry path: if desktop-x11 capability is installed, use spawner
      const desktopCap = app.capabilityRegistry?.list().find(
        (c) => c.provides === 'desktop-control' && c.interface === 'mcp' && c.entrypoint,
      )

      if (desktopCap && desktopCap.status === 'available') {
        // The SDK spawns the MCP server process via the stdio config returned by the factory.
        // We don't use McpCapabilitySpawner here — the SDK manages the child process lifecycle.
        // Instead, we use a standalone spawner instance solely for crash monitoring:
        // after the SDK spawns the process, we attach a crash listener that updates registry health.
        const spawner = new McpCapabilitySpawner()

        // Wire crash event → registry health degraded (S1 deferred)
        spawner.on('crash', (event: { capabilityName: string; pid: number; code: number | null; signal: string | null }) => {
          const cap = app.capabilityRegistry?.list().find(c => c.name === event.capabilityName)
          if (cap) {
            cap.health = 'degraded'
            cap.degradedReason = `Process crashed (pid=${event.pid}, code=${event.code}, signal=${event.signal})`
            app.emit('capability:changed', app.capabilityRegistry!.list())
            console.warn(`[Desktop] Capability "${event.capabilityName}" crashed — health set to degraded`)
          }
        })

        // Factory: return stdio config so the SDK spawns the process itself.
        // No spawner.spawn() here — the SDK handles spawn + transport + client.
        const entrypointParts = desktopCap.entrypoint!.split(/\s+/)
        addMcpServerFactory('desktop-x11', async () => ({
          command: entrypointParts[0],
          args: entrypointParts.slice(1),
          cwd: desktopCap.path,
          env: { ...process.env },
        }))

        console.log(`[Desktop] Registry-based desktop-x11 wired (${desktopCap.entrypoint})`)

        // Detect environment for status logging (no backend instance needed in framework)
        const { detectDesktopEnvironment } = await import('./desktop/desktop-capability-detector.js')
        const desktopEnv = detectDesktopEnvironment()
        app.desktopEnv = desktopEnv

        if (desktopEnv.hasDisplay) {
          console.log(
            `[Desktop] ${desktopEnv.displayServer} detected, capabilities managed by desktop-x11 capability`,
          )
        }
      } else {
        // Fallback: legacy hardcoded path (will be removed after verification)
        const { detectDesktopEnvironment } = await import('./desktop/desktop-capability-detector.js')
        const desktopEnv = detectDesktopEnvironment()
        app.desktopEnv = desktopEnv

        let backend: DesktopBackend | null = null
        if (desktopEnv.backend === 'x11') {
          const { X11Backend } = await import('./desktop/x11-backend.js')
          backend = new X11Backend({
            hasXdotool: desktopEnv.tools.xdotool,
            hasMaim: desktopEnv.tools.maim,
            hasWmctrl: desktopEnv.tools.wmctrl,
          })
          app.desktopBackend = backend
        }

        app.desktopRateLimiter = createDesktopRateLimiter({ maxPerMinute: 30 })
        app.desktopAuditLogger = createDesktopAuditLogger((entry) => {
          console.log(
            `[Desktop] audit: ${entry.tool} at ${entry.timestamp}${entry.instruction ? ` — ${entry.instruction.slice(0, 80)}` : ''}`,
          )
        })

        const enabledFlagPath = join(agentDir, '.desktop-enabled')
        const desktopServer = createDesktopServer({
          backend,
          visualService: app.visualActionService,
          rateLimiter: app.desktopRateLimiter ?? undefined,
          auditLogger: app.desktopAuditLogger ?? undefined,
          isEnabled: () => existsSync(enabledFlagPath),
        })
        addMcpServer('desktop-tools', desktopServer)

        if (backend) {
          const desktopBackend = backend
          const desktopVas = app.visualActionService
          const isDesktopEnabled = () => existsSync(enabledFlagPath)
          addMcpServerFactory('desktop-actions', () =>
            createDesktopActionServer({
              backend: desktopBackend,
              vas: desktopVas,
              isEnabled: isDesktopEnabled,
            }),
          )
        }

        if (desktopEnv.hasDisplay) {
          console.log(
            `[Desktop] Legacy path: ${desktopEnv.displayServer} detected, backend: ${desktopEnv.backend ?? 'none'}`,
          )
        } else {
          console.log('[Desktop] No display detected — desktop tools will return helpful errors')
        }
      }
    }
```

- [ ] **Step 2: Add McpCapabilitySpawner import**

At the top of `app.ts`, add the spawner import alongside the existing capability imports:

```typescript
import { McpCapabilitySpawner } from '@my-agent/core'
```

Verify this is already exported from `packages/core/src/capabilities/index.ts` (it is — line 10).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/core && npx tsc --noEmit && cd ../dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Test dual-path manually**

Start the dashboard and verify that:
1. The registry path is taken (look for log: `[Desktop] Registry-based desktop-x11 wired`)
2. Desktop tools appear in the MCP server list

```bash
systemctl --user restart nina-dashboard.service
journalctl --user -u nina-dashboard.service -f --no-pager | head -50
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(desktop): add registry-based wiring alongside legacy path (dual-path migration)"
```

---

## Task 7: Wire middleware hooks in session manager

S1 deferred item. Wire the capability middleware as SDK hooks:
- **Rate limiter** → PreToolUse (blocks tool call before execution via `permissionDecision: 'deny'`)
- **Audit logger + screenshot interceptor** → PostToolUse (runs after tool execution)

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:302-306`

- [ ] **Step 1: Add middleware imports**

At the top of `session-manager.ts`, add:

```typescript
import {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  type AuditEntry,
} from '@my-agent/core'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { appendFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
```

- [ ] **Step 2: Add PreToolUse hook for rate limiter**

In `SessionManager.init()`, after the existing PreToolUse hooks (around line 334, after the delegation enforcer), add:

```typescript
    // Capability rate limiter — PreToolUse: block tool call when limit exceeded (S1 deferred, wired in S3)
    const capRateLimiter = createCapabilityRateLimiter({ maxPerMinute: 30 })

    this.hooks!.PreToolUse!.push({
      matcher: 'desktop_.*',
      hooks: [
        async (input) => {
          const preInput = input as PreToolUseHookInput
          const allowed = capRateLimiter.check('desktop-control')
          if (!allowed) {
            return {
              systemMessage: `Rate limit exceeded for desktop-control (30/min). Wait before retrying.`,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'deny' as const,
                permissionDecisionReason: 'Capability rate limit exceeded (30 calls per minute)',
              },
            }
          }
          return {}
        },
      ],
    })
```

- [ ] **Step 3: Add PostToolUse hooks for audit logger and screenshot interceptor**

```typescript
    // Capability audit logger + screenshot interceptor — PostToolUse (S1 deferred, wired in S3)
    const auditLogPath = join(agentDir, 'logs', 'capability-audit.jsonl')
    const capAuditLogger = createCapabilityAuditLogger(async (entry: AuditEntry) => {
      try {
        await mkdir(dirname(auditLogPath), { recursive: true })
        await appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8')
      } catch {
        // Audit logging is best-effort
      }
    })
    const screenshotInterceptor = createScreenshotInterceptor()

    if (!this.hooks!.PostToolUse) this.hooks!.PostToolUse = []
    this.hooks!.PostToolUse.push({
      matcher: 'desktop_.*',
      hooks: [
        async (input) => {
          // Audit logging
          const toolName = 'tool_name' in input ? (input as { tool_name: string }).tool_name : 'unknown'
          await capAuditLogger.log({
            capabilityName: 'desktop-x11',
            toolName,
            sessionId: input.session_id,
          })

          // Screenshot interception — log when screenshots are returned
          if ('tool_result' in input) {
            const result = (input as { tool_result: unknown }).tool_result
            if (screenshotInterceptor.hasScreenshot(result)) {
              console.log(`[Capability Middleware] Screenshot captured by ${toolName}`)
            }
          }

          return {}
        },
      ],
    })
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/agent/session-manager.ts
git commit -m "feat(capabilities): wire rate limiter (PreToolUse) + audit/screenshot (PostToolUse)"
```

---

## Task 8: Verify registry path works — remove legacy code

After verifying the registry path works (Task 6 step 4), remove the legacy fallback and all deleted files.

**Files:**
- Modify: `packages/dashboard/src/app.ts` (remove legacy fallback branch)
- Delete: `packages/dashboard/src/desktop/x11-backend.ts`
- Delete: `packages/dashboard/src/desktop/desktop-capability-detector.ts`
- Delete: `packages/dashboard/src/desktop/computer-use-service.ts`
- Delete: `packages/dashboard/src/mcp/desktop-server.ts`
- Delete: `packages/dashboard/src/mcp/desktop-action-server.ts`
- Delete: `packages/dashboard/src/routes/desktop.ts`
- Delete: `packages/dashboard/src/hooks/desktop-hooks.ts`
- Modify: `packages/dashboard/src/app.ts` (remove dead imports)

- [ ] **Step 1: Remove legacy fallback from app.ts desktop block**

In `app.ts`, replace the entire desktop control block with the registry-only version. Remove the `else` branch (legacy fallback). Keep the `desktop-capability-detector.ts` import for `desktopEnv` — wait, that also moves. For the registry path, the capability server handles detection internally. The `desktopEnv` on the App class was used for the status route — but that route is now replaced by generic capability routes (S2). Check if `desktopEnv` is still referenced elsewhere.

Search for `desktopEnv` usage in app.ts and routes:

```bash
grep -n 'desktopEnv\|desktopBackend\|desktopRateLimiter\|desktopAuditLogger' packages/dashboard/src/app.ts packages/dashboard/src/routes/*.ts
```

If `desktopEnv` is only used by the deleted `routes/desktop.ts`, remove the field from the App class too. If other code references it, keep a minimal detection for logging.

- [ ] **Step 2: Remove the legacy fallback branch**

In `app.ts`, simplify the desktop block to registry-only:

```typescript
    // ── Desktop control (M9.5-S3: registry-based) ──
    {
      const desktopCap = app.capabilityRegistry?.list().find(
        (c) => c.provides === 'desktop-control' && c.interface === 'mcp' && c.entrypoint,
      )

      if (desktopCap && desktopCap.status === 'available') {
        // Crash monitoring via spawner (doesn't spawn — just monitors)
        const spawner = new McpCapabilitySpawner()
        spawner.on('crash', (event: { capabilityName: string; pid: number; code: number | null; signal: string | null }) => {
          const cap = app.capabilityRegistry?.list().find(c => c.name === event.capabilityName)
          if (cap) {
            cap.health = 'degraded'
            cap.degradedReason = `Process crashed (pid=${event.pid}, code=${event.code}, signal=${event.signal})`
            app.emit('capability:changed', app.capabilityRegistry!.list())
            console.warn(`[Desktop] Capability "${event.capabilityName}" crashed — health set to degraded`)
          }
        })

        // SDK spawns the MCP server process via stdio config
        const entrypointParts = desktopCap.entrypoint!.split(/\s+/)
        addMcpServerFactory('desktop-x11', async () => ({
          command: entrypointParts[0],
          args: entrypointParts.slice(1),
          cwd: desktopCap.path,
          env: { ...process.env },
        }))

        console.log(`[Desktop] desktop-x11 capability wired via registry`)
      } else {
        console.log('[Desktop] No desktop-control capability installed — desktop tools unavailable')
      }
    }
```

- [ ] **Step 3: Remove dead imports from app.ts**

Remove these imports from the top of `app.ts`:

```typescript
// DELETE these lines:
import { detectDesktopEnvironment } from "./desktop/desktop-capability-detector.js";
import { X11Backend } from "./desktop/x11-backend.js";
import { createDesktopServer } from "./mcp/desktop-server.js";
import { createDesktopActionServer } from "./mcp/desktop-action-server.js";
import { createDesktopRateLimiter, createDesktopAuditLogger } from "./hooks/desktop-hooks.js";
```

Keep the type import if still needed:
```typescript
import type { DesktopEnvironment, DesktopBackend } from "@my-agent/core";
```

Remove this too if `desktopEnv` and `desktopBackend` fields are removed from the App class.

- [ ] **Step 4: Remove App class desktop fields (if unused)**

If `desktopEnv`, `desktopBackend`, `desktopRateLimiter`, `desktopAuditLogger` are only used by deleted code, remove them from the App class definition.

- [ ] **Step 5: Delete framework desktop files**

```bash
rm packages/dashboard/src/desktop/x11-backend.ts
rm packages/dashboard/src/desktop/desktop-capability-detector.ts
rm packages/dashboard/src/desktop/computer-use-service.ts
rm packages/dashboard/src/mcp/desktop-server.ts
rm packages/dashboard/src/mcp/desktop-action-server.ts
rm packages/dashboard/src/routes/desktop.ts
rm packages/dashboard/src/hooks/desktop-hooks.ts
```

Check if the `desktop/` directory is now empty and remove it:

```bash
rmdir packages/dashboard/src/desktop/ 2>/dev/null || echo "Directory not empty — check for remaining files"
```

- [ ] **Step 6: Remove desktop route registration from server.ts**

In `packages/dashboard/src/server.ts` (or wherever routes are registered), remove the `registerDesktopRoutes` import and call. The generic capability routes from S2 (`registerCapabilityRoutes`) already handle the settings UI.

```bash
grep -n 'desktop' packages/dashboard/src/server.ts
```

Remove any line importing or calling `registerDesktopRoutes`.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd packages/core && npx tsc --noEmit && cd ../dashboard && npx tsc --noEmit`
Expected: No errors. If there are errors, they indicate remaining references to deleted code — fix them.

- [ ] **Step 8: Restart and verify**

```bash
systemctl --user restart nina-dashboard.service
journalctl --user -u nina-dashboard.service -f --no-pager | head -30
```

Verify:
- Log shows: `[Desktop] desktop-x11 capability wired via registry`
- No import errors or missing module warnings
- Settings UI still shows Desktop Control capability card

- [ ] **Step 9: Commit with explicit file staging**

```bash
git add packages/dashboard/src/app.ts packages/dashboard/src/server.ts
git add -u packages/dashboard/src/desktop/ packages/dashboard/src/mcp/desktop-server.ts packages/dashboard/src/mcp/desktop-action-server.ts packages/dashboard/src/routes/desktop.ts packages/dashboard/src/hooks/desktop-hooks.ts
git commit -m "feat(desktop): remove legacy desktop code — fully registry-driven

Deleted:
- dashboard/src/desktop/ (x11-backend, detector, computer-use-service)
- dashboard/src/mcp/desktop-server.ts, desktop-action-server.ts
- dashboard/src/routes/desktop.ts
- dashboard/src/hooks/desktop-hooks.ts

Desktop control now runs as standalone MCP capability via
.my_agent/capabilities/desktop-x11/"
```

---

## Task 9: Create test fixture and tests

Create a committed test fixture (since `.my_agent/` is gitignored) and write tests for the S3 deliverables.

**Files:**
- Create: `packages/core/tests/fixtures/desktop-x11-fixture/CAPABILITY.md`
- Create: `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`
- Create: `packages/core/tests/fixtures/desktop-x11-fixture/package.json`
- Create: `packages/core/tests/capabilities/mcp-spawner-crash.test.ts`
- Create: `packages/core/tests/capabilities/middleware-wiring.test.ts`
- Create: `packages/core/tests/capabilities/desktop-extraction.test.ts`

- [ ] **Step 1: Create test fixture CAPABILITY.md**

Write `packages/core/tests/fixtures/desktop-x11-fixture/CAPABILITY.md`:

```markdown
---
name: Desktop X11 Test
provides: desktop-control
interface: mcp
entrypoint: npx tsx src/server.ts
requires:
  system: []
---

Test fixture for desktop-x11 capability integration tests.
```

- [ ] **Step 2: Create test fixture server.ts**

A minimal MCP server that mimics the desktop-x11 tool names without needing actual X11 tools.

Write `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'desktop-x11-test', version: '1.0.0' })

server.tool(
  'desktop_info',
  'Query desktop info (test fixture)',
  { query: z.enum(['windows', 'display', 'capabilities']) },
  async ({ query }) => ({
    content: [{ type: 'text', text: JSON.stringify({ query, fixture: true }) }],
  }),
)

server.tool(
  'desktop_screenshot',
  'Take screenshot (test fixture)',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ fixture: true, screenshot: 'mock' }) }],
  }),
)

server.tool(
  'desktop_click',
  'Click (test fixture)',
  { x: z.number(), y: z.number() },
  async ({ x, y }) => ({
    content: [{ type: 'text', text: JSON.stringify({ clicked: { x, y } }) }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 3: Create test fixture package.json**

Write `packages/core/tests/fixtures/desktop-x11-fixture/package.json`:

```json
{
  "name": "desktop-x11-fixture",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.25.23"
  }
}
```

- [ ] **Step 4: Install fixture dependencies**

```bash
cd packages/core/tests/fixtures/desktop-x11-fixture && npm install
```

- [ ] **Step 5: Create spawner crash test**

Write `packages/core/tests/capabilities/mcp-spawner-crash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { McpCapabilitySpawner } from '../../src/capabilities/mcp-spawner.js'
import { join } from 'node:path'

const FIXTURE_PATH = join(import.meta.dirname, '..', 'fixtures', 'desktop-x11-fixture')

describe('McpCapabilitySpawner crash recovery', () => {
  it('emits crash event when child process is killed', async () => {
    const spawner = new McpCapabilitySpawner()

    const handle = await spawner.spawn(
      { name: 'desktop-x11-test', path: FIXTURE_PATH, entrypoint: 'npx tsx src/server.ts' },
      'test-session-1',
    )

    expect(handle.tools.length).toBeGreaterThan(0)
    expect(handle.pid).toBeGreaterThan(0)
    expect(spawner.listActive()).toHaveLength(1)

    // Kill the child process — should trigger crash event
    const crashPromise = new Promise<{ capabilityName: string; pid: number }>((resolve) => {
      spawner.on('crash', resolve)
    })

    handle.process?.kill('SIGKILL')

    const crashEvent = await crashPromise
    expect(crashEvent.capabilityName).toBe('desktop-x11-test')
    expect(crashEvent.pid).toBe(handle.pid)

    // Handle should be removed from active list
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)

  it('lists tools from the MCP server', async () => {
    const spawner = new McpCapabilitySpawner()

    const handle = await spawner.spawn(
      { name: 'desktop-x11-test', path: FIXTURE_PATH, entrypoint: 'npx tsx src/server.ts' },
      'test-session-2',
    )

    const toolNames = handle.tools.map(t => t.name)
    expect(toolNames).toContain('desktop_info')
    expect(toolNames).toContain('desktop_screenshot')
    expect(toolNames).toContain('desktop_click')

    await handle.shutdown()
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)
})
```

- [ ] **Step 6: Create middleware wiring test**

Write `packages/core/tests/capabilities/middleware-wiring.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
} from '../../src/capabilities/mcp-middleware.js'

describe('Capability middleware', () => {
  describe('rate limiter', () => {
    it('allows requests under limit', () => {
      const limiter = createCapabilityRateLimiter({ maxPerMinute: 3 })
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(true)
    })

    it('blocks requests over limit', () => {
      const limiter = createCapabilityRateLimiter({ maxPerMinute: 2 })
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(false)
    })

    it('tracks types independently', () => {
      const limiter = createCapabilityRateLimiter({ maxPerMinute: 1 })
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('audio-to-text')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(false)
    })
  })

  describe('audit logger', () => {
    it('calls writer with enriched entry', async () => {
      const writer = vi.fn()
      const logger = createCapabilityAuditLogger(writer)

      await logger.log({ capabilityName: 'desktop-x11', toolName: 'desktop_click', sessionId: 's1' })

      expect(writer).toHaveBeenCalledOnce()
      const entry = writer.mock.calls[0][0]
      expect(entry.capability).toBe('desktop-x11')
      expect(entry.tool).toBe('desktop_click')
      expect(entry.session).toBe('s1')
      expect(entry.timestamp).toBeDefined()
    })

    it('supports async writer', async () => {
      const writer = vi.fn().mockResolvedValue(undefined)
      const logger = createCapabilityAuditLogger(writer)

      await logger.log({ capabilityName: 'test', toolName: 'tool', sessionId: 's1' })

      expect(writer).toHaveBeenCalledOnce()
    })
  })

  describe('screenshot interceptor', () => {
    it('detects PNG image in tool result', () => {
      const interceptor = createScreenshotInterceptor()
      const result = {
        content: [
          { type: 'text', text: 'Screenshot captured' },
          { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', mimeType: 'image/png' },
        ],
      }
      expect(interceptor.hasScreenshot(result)).toBe(true)
      expect(interceptor.extractImage(result)).toBeTruthy()
    })

    it('returns false for non-image results', () => {
      const interceptor = createScreenshotInterceptor()
      const result = {
        content: [{ type: 'text', text: 'Hello' }],
      }
      expect(interceptor.hasScreenshot(result)).toBe(false)
      expect(interceptor.extractImage(result)).toBeNull()
    })
  })
})
```

- [ ] **Step 7: Create desktop extraction integration test**

Write `packages/core/tests/capabilities/desktop-extraction.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import { join, dirname } from 'node:path'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')

describe('Desktop extraction integration', () => {
  it('scanner discovers desktop-x11-fixture as mcp capability with entrypoint', async () => {
    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const desktop = caps.find(c => c.provides === 'desktop-control')

    expect(desktop).toBeDefined()
    expect(desktop!.interface).toBe('mcp')
    expect(desktop!.entrypoint).toBe('npx tsx src/server.ts')
    expect(desktop!.status).toBe('available')
  })

  it('registry toggle writes/removes .enabled file in capability folder', async () => {
    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const registry = new CapabilityRegistry()
    registry.load(caps)

    const enabledPath = join(FIXTURES_DIR, 'desktop-x11-fixture', '.enabled')

    // Clean up any previous state
    try { unlinkSync(enabledPath) } catch {}

    // Should not be enabled initially
    expect(registry.isEnabled('desktop-control')).toBe(false)

    // Toggle on
    const result = registry.toggle('desktop-control')
    expect(result).toBe(true)
    expect(existsSync(enabledPath)).toBe(true)

    // Toggle off
    const result2 = registry.toggle('desktop-control')
    expect(result2).toBe(false)
    expect(existsSync(enabledPath)).toBe(false)
  })

  it('test harness validates desktop-x11-fixture MCP server', async () => {
    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const registry = new CapabilityRegistry()
    registry.setProjectRoot(join(FIXTURES_DIR, '..', '..'))
    registry.load(caps)

    // Enable so get() returns it
    const enabledPath = join(FIXTURES_DIR, 'desktop-x11-fixture', '.enabled')
    writeFileSync(enabledPath, new Date().toISOString())

    // Re-load to pick up enabled state
    const caps2 = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    registry.load(caps2)

    const testResult = await registry.test('desktop-control')
    expect(testResult.status).toBe('ok')
    expect(testResult.latencyMs).toBeGreaterThan(0)

    // Clean up
    try { unlinkSync(enabledPath) } catch {}
  }, 30_000)
})
```

- [ ] **Step 8: Run tests**

```bash
cd packages/core && npx vitest run tests/capabilities/
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/tests/capabilities/ packages/core/tests/fixtures/desktop-x11-fixture/
git commit -m "test(capabilities): spawner crash, middleware wiring, desktop extraction integration"
```

---

## Task 10: Final verification and cleanup

End-to-end verification that the extraction is complete and nothing is broken.

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
cd packages/core && npx vitest run
```

Expected: All tests pass, including pre-existing ones (no regressions).

- [ ] **Step 2: TypeScript clean compilation**

```bash
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
```

Expected: No errors in either package.

- [ ] **Step 3: Verify no remaining references to deleted files**

```bash
grep -rn 'desktop-server\|desktop-action-server\|desktop-capability-detector\|computer-use-service\|desktop-hooks' packages/dashboard/src/ --include='*.ts' | grep -v node_modules
```

Expected: No matches (all imports to deleted files are removed).

- [ ] **Step 4: Verify no framework imports in capability server**

```bash
grep -rn '@my-agent/core' .my_agent/capabilities/desktop-x11/src/ 2>/dev/null
```

Expected: No matches (standalone constraint enforced).

- [ ] **Step 5: Restart dashboard and verify runtime**

```bash
systemctl --user restart nina-dashboard.service
sleep 3
journalctl --user -u nina-dashboard.service --since "3 seconds ago" --no-pager
```

Expected output should include:
- `[Capabilities] Discovered N capabilities: ... Desktop X11 [available] ...`
- `[Desktop] desktop-x11 capability wired via registry`
- No import errors or warnings

- [ ] **Step 6: Verify settings UI shows desktop capability**

```bash
curl -s http://localhost:4321/api/settings/capabilities | jq '.capabilities[] | select(.type == "desktop-control")'
```

Expected: Shows `desktop-control` with `state: "healthy"` or `"disabled"` (depending on `.enabled` state), `canToggle: true`.

- [ ] **Step 7: Test toggle on/off via API**

```bash
# Toggle
curl -s -X POST http://localhost:4321/api/settings/capabilities/desktop-control/toggle | jq
# Should return { "enabled": true/false, "effective": "next_session" }
```

- [ ] **Step 8: Delete stray screenshots**

```bash
find . -maxdepth 1 -name '*.png' -delete 2>/dev/null
```

- [ ] **Step 9: Final commit if any cleanup was needed**

```bash
git status
# If clean, skip. If changes exist:
git add -A
git commit -m "chore(desktop): final cleanup after extraction verification"
```

---

## Summary

| Task | Description | Estimated Steps |
|------|-------------|----------------|
| 1 | Audit logger async-compatible | 3 |
| 2 | Spawner process warning | 3 |
| 3 | Capability folder: types + backend | 4 |
| 4 | Capability folder: server + metadata | 10 |
| 5 | Migrate .desktop-enabled → .enabled | 2 |
| 6 | Dual-path registry wiring in app.ts | 5 |
| 7 | Middleware hooks (PreToolUse + PostToolUse) | 5 |
| 8 | Remove legacy code | 9 |
| 9 | Test fixture and tests | 9 |
| 10 | Final verification | 9 |
| **Total** | | **59 steps** |

**Dependencies:**
- Tasks 1-2: Independent (S1 deferred items)
- Tasks 3-4: Sequential (types before server)
- Task 5: After Task 3 (capability folder must exist)
- Task 6: After Tasks 3-5 (capability must be installed)
- Task 7: Independent of Task 6 (hooks wire separately)
- Task 8: After Task 6 verified working
- Task 9: After Task 8 (tests validate final state)
- Task 10: After all tasks
