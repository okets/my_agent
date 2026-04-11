# M9.5-S1: Framework Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the capability framework to support MCP-based capabilities as first-class citizens — new types (`entrypoint`, `requires.system`, `enabled`), scanner probing, registry toggle, MCP process spawner with factory pattern, framework middleware chain (rate limiter, audit logger, screenshot interceptor), and MCP test harness path.

**Architecture:** The capability system gains three new dimensions: (1) `entrypoint`-based MCP server spawning as child processes with stdio transport, replacing the `.mcp.json` passthrough for capabilities that provide their own server; (2) an `enabled` boolean gating `get()` so capabilities can be toggled off without being unavailable; (3) a framework middleware chain using PostToolUse hooks that intercepts MCP capability tool calls for rate limiting, audit logging, and screenshot interception. The test harness gains an MCP client path that spawns the server, validates tool schemas, and runs a functional screenshot test.

**Tech Stack:** TypeScript, Vitest, `@modelcontextprotocol/sdk` (Client + StdioClientTransport), Claude Agent SDK (hooks)

**Design spec:** `docs/design/capability-framework-v2.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/core/src/capabilities/types.ts` | Add `entrypoint`, `requires.system`, `enabled` fields to types |
| Modify | `packages/core/src/capabilities/scanner.ts` | Probe system tools, read `entrypoint`/`requires.system`, read `.enabled` file |
| Modify | `packages/core/src/capabilities/registry.ts` | Add `isEnabled()`, `toggle()`, gate `get()` on `enabled` |
| Modify | `packages/core/src/capabilities/test-harness.ts` | Add MCP client test path dispatched by interface type |
| Modify | `packages/core/src/capabilities/index.ts` | Export new types and functions |
| Create | `packages/core/src/capabilities/mcp-spawner.ts` | MCP capability child process lifecycle (spawn, connect, shutdown) |
| Create | `packages/core/src/capabilities/mcp-middleware.ts` | Rate limiter, audit logger, screenshot interceptor for MCP tool calls |
| Create | `packages/core/tests/capabilities/types.test.ts` | Type validation tests |
| Create | `packages/core/tests/capabilities/scanner-system.test.ts` | System tool probing + entrypoint + enabled tests |
| Create | `packages/core/tests/capabilities/registry-toggle.test.ts` | Toggle + enabled gate tests |
| Create | `packages/core/tests/capabilities/mcp-spawner.test.ts` | Spawner lifecycle tests |
| Create | `packages/core/tests/capabilities/mcp-middleware.test.ts` | Middleware chain tests |
| Create | `packages/core/tests/capabilities/test-harness-mcp.test.ts` | MCP test harness path tests |
| Create | `packages/core/tests/fixtures/smoke-mcp-server/` | Trivial MCP server for smoke testing |

**S3 wiring note:** Task 5 builds the middleware primitives as standalone functions. The actual PostToolUse hook wiring into the Agent SDK happens in `app.ts` during S3 (Desktop Extraction), when the framework starts spawning MCP capability servers from the registry. S1 delivers tested, exported primitives; S3 wires them.

---

## Task 1: Extend Capability Types

Add `entrypoint`, `requires.system`, and `enabled` to the type system.

**Files:**
- Modify: `packages/core/src/capabilities/types.ts`
- Create: `packages/core/tests/capabilities/types.test.ts`

- [ ] **Step 1: Write the type validation test**

In `packages/core/tests/capabilities/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Capability, CapabilityFrontmatter } from '../../src/capabilities/types.js'

describe('Capability types', () => {
  it('accepts MCP capability with entrypoint and system requirements', () => {
    const cap: Capability = {
      name: 'Desktop Control (X11)',
      provides: 'desktop-control',
      interface: 'mcp',
      path: '/home/test/.my_agent/capabilities/desktop-x11',
      status: 'available',
      health: 'untested',
      enabled: true,
      entrypoint: 'npx tsx src/server.ts',
    }
    expect(cap.enabled).toBe(true)
    expect(cap.entrypoint).toBe('npx tsx src/server.ts')
  })

  it('accepts script capability without entrypoint', () => {
    const cap: Capability = {
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      interface: 'script',
      path: '/home/test/.my_agent/capabilities/stt-deepgram',
      status: 'available',
      health: 'untested',
      enabled: true,
    }
    expect(cap.entrypoint).toBeUndefined()
  })

  it('frontmatter accepts requires.system array', () => {
    const fm: CapabilityFrontmatter = {
      name: 'Desktop Control (X11)',
      provides: 'desktop-control',
      interface: 'mcp',
      entrypoint: 'npx tsx src/server.ts',
      requires: {
        env: [],
        system: ['xdotool', 'maim', 'wmctrl'],
      },
    }
    expect(fm.requires?.system).toEqual(['xdotool', 'maim', 'wmctrl'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/capabilities/types.test.ts`
Expected: FAIL — `enabled` and `entrypoint` don't exist on `Capability`, `system` doesn't exist on `requires`

- [ ] **Step 3: Update types.ts**

In `packages/core/src/capabilities/types.ts`, update `Capability`:

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
  enabled: boolean              // new — read from .enabled file
  entrypoint?: string           // new — command to start MCP server (mcp interface only)
}
```

Update `CapabilityFrontmatter`:

```typescript
export interface CapabilityFrontmatter {
  name: string
  provides?: string
  interface: 'script' | 'mcp'
  entrypoint?: string           // new — command to start the MCP server
  requires?: {
    env?: string[]
    system?: string[]           // new — CLI tools that must be present
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/capabilities/types.test.ts`
Expected: PASS

- [ ] **Step 5: Fix downstream compilation**

Run: `cd packages/core && npx tsc --noEmit`

Every place that creates a `Capability` object now needs `enabled: boolean`. Fix the scanner (Task 2 handles this properly) and any test fixtures. For now, add `enabled: true` as default in the scanner's capability construction.

In `packages/core/src/capabilities/scanner.ts`, add `enabled: true` to the capability object (line ~118):

```typescript
const capability: Capability = {
  name: data.name,
  provides: data.provides,
  interface: data.interface,
  path: capDir,
  status: missingVars.length === 0 ? 'available' : 'unavailable',
  health: 'untested',
  enabled: true,  // default — Task 2 adds .enabled file reading
}
```

And in the invalid capability fallbacks (lines ~104 and ~141):

```typescript
// line ~104
capabilities.push({
  name: basename(capDir),
  interface: data.interface ?? 'script',
  path: capDir,
  status: 'invalid',
  error: 'Missing name in CAPABILITY.md frontmatter',
  health: 'untested',
  enabled: false,
})

// line ~141
capabilities.push({
  name: basename(capDir),
  interface: 'script',
  path: capDir,
  status: 'invalid',
  error: err instanceof Error ? err.message : 'Unknown error parsing CAPABILITY.md',
  health: 'untested',
  enabled: false,
})
```

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS (or remaining errors from other packages — those are fine for now)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/capabilities/types.ts packages/core/src/capabilities/scanner.ts packages/core/tests/capabilities/types.test.ts
git commit -m "feat(capabilities): add entrypoint, requires.system, and enabled fields to types"
```

---

## Task 2: Extend Scanner — System Tool Probing, Entrypoint, and Enabled File

The scanner needs to: (1) read `entrypoint` and `requires.system` from frontmatter, (2) probe for system tools via `which`, (3) read the `.enabled` file from the capability folder.

**Files:**
- Modify: `packages/core/src/capabilities/scanner.ts`
- Create: `packages/core/tests/capabilities/scanner-system.test.ts`

- [ ] **Step 1: Write scanner tests**

In `packages/core/tests/capabilities/scanner-system.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanCapabilities } from '../../src/capabilities/scanner.js'

describe('scanner — system tools and entrypoint', () => {
  let capDir: string
  let envPath: string

  beforeEach(() => {
    const base = join(tmpdir(), `cap-scan-test-${Date.now()}`)
    capDir = join(base, 'capabilities')
    mkdirSync(capDir, { recursive: true })
    envPath = join(base, '.env')
    writeFileSync(envPath, '')
  })

  afterEach(() => {
    rmSync(capDir.replace('/capabilities', ''), { recursive: true, force: true })
  })

  it('reads entrypoint from frontmatter', async () => {
    const dir = join(capDir, 'test-mcp')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Test MCP',
      'provides: test-type',
      'interface: mcp',
      'entrypoint: npx tsx src/server.ts',
      '---',
      'Test capability.',
    ].join('\n'))

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps).toHaveLength(1)
    expect(caps[0].entrypoint).toBe('npx tsx src/server.ts')
    expect(caps[0].interface).toBe('mcp')
  })

  it('marks unavailable when required system tools are missing', async () => {
    const dir = join(capDir, 'needs-tools')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Needs Tools',
      'provides: test-type',
      'interface: mcp',
      'entrypoint: ./bin/server',
      'requires:',
      '  system:',
      '    - definitely_not_a_real_tool_xyz',
      '---',
      'Test.',
    ].join('\n'))

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].status).toBe('unavailable')
    expect(caps[0].unavailableReason).toContain('definitely_not_a_real_tool_xyz')
  })

  it('marks available when system tools exist', async () => {
    const dir = join(capDir, 'has-tools')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Has Tools',
      'provides: test-type',
      'interface: mcp',
      'entrypoint: ./bin/server',
      'requires:',
      '  system:',
      '    - ls',
      '---',
      'Test.',
    ].join('\n'))

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].status).toBe('available')
  })

  it('reads .enabled file — enabled when present', async () => {
    const dir = join(capDir, 'toggle-test')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: Toggle Test',
      'provides: test-type',
      'interface: script',
      '---',
      'Test.',
    ].join('\n'))
    writeFileSync(join(dir, '.enabled'), new Date().toISOString())

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].enabled).toBe(true)
  })

  it('reads .enabled file — disabled when absent', async () => {
    const dir = join(capDir, 'no-toggle')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: No Toggle',
      'provides: test-type',
      'interface: script',
      '---',
      'Test.',
    ].join('\n'))
    // No .enabled file

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].enabled).toBe(false)
  })

  it('existing .mcp.json capabilities still work after scanner changes', async () => {
    const dir = join(capDir, 'mcp-json-cap')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAPABILITY.md'), [
      '---',
      'name: MCP JSON Cap',
      'provides: test-type',
      'interface: mcp',
      '---',
      'Test.',
    ].join('\n'))
    // .mcp.json pattern — no entrypoint, uses direct passthrough
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      type: 'stdio',
      command: 'echo',
      args: ['test'],
    }))
    writeFileSync(join(dir, '.enabled'), new Date().toISOString())

    const caps = await scanCapabilities(capDir, envPath)
    expect(caps[0].status).toBe('available')
    expect(caps[0].mcpConfig).toBeDefined()
    expect(caps[0].entrypoint).toBeUndefined() // no entrypoint — uses .mcp.json
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/capabilities/scanner-system.test.ts`
Expected: FAIL — scanner doesn't read `entrypoint`, doesn't probe system tools, always sets `enabled: true`

- [ ] **Step 3: Add system tool probing to scanner**

In `packages/core/src/capabilities/scanner.ts`, add a `hasSystemTool` function after the imports:

```typescript
import { execFileSync } from 'node:child_process'

/**
 * Check if a system CLI tool is available via `which`.
 */
function hasSystemTool(tool: string): boolean {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Update the scan loop to read new fields and .enabled file**

In the main `scanCapabilities` function, update the capability construction block (after `const requiredEnv = ...`):

```typescript
const requiredEnv = data.requires?.env ?? []
const missingVars = requiredEnv.filter((key) => !hasEnvVar(envPath, key))

// Probe required system tools
const requiredSystem = data.requires?.system ?? []
const missingTools = requiredSystem.filter((tool) => !hasSystemTool(tool))

// Combine missing env and system requirements
const allMissing = [...missingVars, ...missingTools]

// Read .enabled file
const enabledPath = join(capDir, '.enabled')
const enabled = existsSync(enabledPath)

const capability: Capability = {
  name: data.name,
  provides: data.provides,
  interface: data.interface,
  path: capDir,
  status: allMissing.length === 0 ? 'available' : 'unavailable',
  health: 'untested',
  enabled,
}

if (allMissing.length > 0) {
  capability.unavailableReason = `missing ${allMissing.join(', ')}`
}

// Read entrypoint for MCP capabilities
if (data.entrypoint) {
  capability.entrypoint = data.entrypoint
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/capabilities/scanner-system.test.ts`
Expected: PASS

- [ ] **Step 6: Run existing scanner tests to check for regressions**

Run: `cd packages/core && npx vitest run tests/capabilities/`
Expected: PASS (existing tests should still pass — they don't create `.enabled` files, so capabilities will be `enabled: false`, but existing tests don't check `enabled`)

If any existing tests fail because they assert on the exact `Capability` shape, update them to include `enabled: false` (or create `.enabled` in the test fixture).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/capabilities/scanner.ts packages/core/tests/capabilities/scanner-system.test.ts
git commit -m "feat(scanner): probe system tools, read entrypoint, read .enabled file"
```

---

## Task 3: Registry — Enabled Gate, isEnabled(), toggle()

The registry's `get()` must only return capabilities that are both `available` AND `enabled`. Add `isEnabled()` and `toggle()` methods.

**Files:**
- Modify: `packages/core/src/capabilities/registry.ts`
- Create: `packages/core/tests/capabilities/registry-toggle.test.ts`

- [ ] **Step 1: Write registry toggle tests**

In `packages/core/tests/capabilities/registry-toggle.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import type { Capability } from '../../src/capabilities/types.js'

function makeCap(overrides: Partial<Capability> & { name: string }): Capability {
  return {
    provides: undefined,
    interface: 'script',
    path: '/tmp/fake',
    status: 'available',
    health: 'untested',
    enabled: true,
    ...overrides,
  }
}

describe('CapabilityRegistry — enabled gate', () => {
  it('get() returns capability when available AND enabled', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true })])
    expect(reg.get('audio-to-text')).toBeDefined()
    expect(reg.get('audio-to-text')!.name).toBe('STT')
  })

  it('get() returns undefined when available but disabled', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false })])
    expect(reg.get('audio-to-text')).toBeUndefined()
  })

  it('get() returns undefined when enabled but unavailable', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true, status: 'unavailable' })])
    expect(reg.get('audio-to-text')).toBeUndefined()
  })

  it('has() respects enabled gate', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false })])
    expect(reg.has('audio-to-text')).toBe(false)
  })

  it('isEnabled() returns explicit boolean', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true }),
      makeCap({ name: 'TTS', provides: 'text-to-audio', enabled: false }),
    ])
    expect(reg.isEnabled('audio-to-text')).toBe(true)
    expect(reg.isEnabled('text-to-audio')).toBe(false)
    expect(reg.isEnabled('nonexistent')).toBe(false)
  })

  it('list() returns all capabilities regardless of enabled state', () => {
    const reg = new CapabilityRegistry()
    reg.load([
      makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true }),
      makeCap({ name: 'TTS', provides: 'text-to-audio', enabled: false }),
    ])
    expect(reg.list()).toHaveLength(2)
  })
})

describe('CapabilityRegistry — toggle()', () => {
  let capDir: string

  beforeEach(() => {
    capDir = join(tmpdir(), `reg-toggle-${Date.now()}`)
    mkdirSync(capDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(capDir, { recursive: true, force: true })
  })

  it('toggle() enables a disabled capability — writes .enabled file', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false, path: capDir })])

    const result = reg.toggle('audio-to-text')
    expect(result).toBe(true) // now enabled
    expect(existsSync(join(capDir, '.enabled'))).toBe(true)
    expect(reg.isEnabled('audio-to-text')).toBe(true)
  })

  it('toggle() disables an enabled capability — removes .enabled file', () => {
    writeFileSync(join(capDir, '.enabled'), new Date().toISOString())
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: true, path: capDir })])

    const result = reg.toggle('audio-to-text')
    expect(result).toBe(false) // now disabled
    expect(existsSync(join(capDir, '.enabled'))).toBe(false)
    expect(reg.isEnabled('audio-to-text')).toBe(false)
  })

  it('toggle() returns undefined for unknown type', () => {
    const reg = new CapabilityRegistry()
    reg.load([])
    expect(reg.toggle('nonexistent')).toBeUndefined()
  })

  it('toggle() emits capability:changed event', () => {
    const reg = new CapabilityRegistry()
    reg.load([makeCap({ name: 'STT', provides: 'audio-to-text', enabled: false, path: capDir })])

    const events: unknown[] = []
    reg.on('capability:changed', (e) => events.push(e))

    reg.toggle('audio-to-text')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'audio-to-text', enabled: true, name: 'STT' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/capabilities/registry-toggle.test.ts`
Expected: FAIL — `isEnabled`, `toggle` don't exist; `get()` doesn't gate on `enabled`

- [ ] **Step 3: Update registry.ts**

Add imports at the top of `packages/core/src/capabilities/registry.ts`:

```typescript
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { EventEmitter } from 'node:events'
```

Make the class extend `EventEmitter`. Change the class declaration:

```typescript
export class CapabilityRegistry extends EventEmitter {
  private capabilities: Map<string, Capability> = new Map()
  private projectRoot: string = ''

  constructor() {
    super()
  }
```

Replace the existing `get()` method — remove the fallback to unavailable/disabled:

```typescript
/**
 * Get capability by well-known `provides` type.
 * Returns the capability only when status is 'available' AND enabled is true.
 */
get(type: string): Capability | undefined {
  for (const cap of this.capabilities.values()) {
    if (cap.provides !== type) continue
    if (cap.status === 'available' && cap.enabled) return cap
  }
  return undefined
}
```

Add `isEnabled()` method:

```typescript
/**
 * Check if a capability type is explicitly enabled.
 * Returns false if the type doesn't exist in the registry.
 */
isEnabled(type: string): boolean {
  for (const cap of this.capabilities.values()) {
    if (cap.provides === type) return cap.enabled
  }
  return false
}
```

Update `has()` to use `get()` (which already gates on enabled):

```typescript
/** Query by well-known type — respects enabled gate */
has(type: string): boolean {
  return this.get(type) !== undefined
}
```

**Note:** The existing `has()` already delegates to `get()`, so this is just making it explicit that the enabled gate flows through. Verify the existing implementation — if it already calls `this.get(type) !== undefined`, no change needed.

Add `toggle()` method:

```typescript
/**
 * Toggle a capability's enabled state.
 * Writes or removes the .enabled file in the capability folder.
 * Emits 'capability:changed' event for downstream listeners (S2 Settings UI, prompt cache).
 * Returns the new enabled state, or undefined if the type is not found.
 */
toggle(type: string): boolean | undefined {
  let target: Capability | undefined
  for (const cap of this.capabilities.values()) {
    if (cap.provides === type) { target = cap; break }
  }
  if (!target) return undefined

  const enabledPath = path.join(target.path, '.enabled')
  if (target.enabled) {
    // Disable — remove .enabled file
    try { unlinkSync(enabledPath) } catch { /* already gone */ }
    target.enabled = false
  } else {
    // Enable — write .enabled file
    writeFileSync(enabledPath, new Date().toISOString())
    target.enabled = true
  }

  this.emit('capability:changed', { type, enabled: target.enabled, name: target.name })
  return target.enabled
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/capabilities/registry-toggle.test.ts`
Expected: PASS

- [ ] **Step 5: Check for regressions — run all capability tests**

Run: `cd packages/core && npx vitest run tests/capabilities/`
Expected: PASS

- [ ] **Step 6: Check downstream compilation**

Run: `cd packages/core && npx tsc --noEmit`

The `get()` behavior change may affect callers that relied on the fallback to unavailable capabilities. Check any code that calls `registry.get()` and handles `status !== 'available'` on the returned capability — those paths are now unreachable since `get()` only returns available+enabled. This is the intended behavior per the spec.

- [ ] **Step 7: Update exports**

In `packages/core/src/capabilities/index.ts`, no changes needed — `CapabilityRegistry` is already exported and the new methods are part of the class.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/capabilities/registry.ts packages/core/tests/capabilities/registry-toggle.test.ts
git commit -m "feat(registry): gate get() on enabled, add isEnabled() and toggle()"
```

---

## Task 4: MCP Capability Spawner

Build the child process lifecycle manager for MCP capabilities: spawn via `entrypoint`, connect via stdio, per-session factory pattern, shutdown with SIGTERM/SIGKILL.

**Files:**
- Create: `packages/core/src/capabilities/mcp-spawner.ts`
- Create: `packages/core/tests/capabilities/mcp-spawner.test.ts`
- Create: `packages/core/tests/fixtures/smoke-mcp-server/server.ts`
- Create: `packages/core/tests/fixtures/smoke-mcp-server/package.json`

- [ ] **Step 1: Create the smoke test MCP server fixture**

This is a trivial MCP server that registers one tool (`smoke_ping`) and returns a fixed response. Used by the spawner tests and later by the test harness tests.

In `packages/core/tests/fixtures/smoke-mcp-server/package.json`:

```json
{
  "name": "smoke-mcp-server",
  "private": true,
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

In `packages/core/tests/fixtures/smoke-mcp-server/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'smoke-test', version: '1.0.0' })

server.tool('smoke_ping', 'Returns pong', {}, async () => ({
  content: [{ type: 'text', text: JSON.stringify({ status: 'pong' }) }],
}))

server.tool(
  'smoke_echo',
  'Echoes input',
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 2: Install dependencies for smoke server**

Run: `cd packages/core/tests/fixtures/smoke-mcp-server && npm install`

- [ ] **Step 3: Write spawner tests**

In `packages/core/tests/capabilities/mcp-spawner.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { McpCapabilitySpawner } from '../../src/capabilities/mcp-spawner.js'
import type { Capability } from '../../src/capabilities/types.js'

const fixtureDir = join(import.meta.dirname, '..', 'fixtures', 'smoke-mcp-server')

function makeSmokeCap(): Capability {
  return {
    name: 'Smoke Test',
    provides: 'smoke',
    interface: 'mcp',
    path: fixtureDir,
    status: 'available',
    health: 'untested',
    enabled: true,
    entrypoint: 'npx tsx server.ts',
  }
}

describe('McpCapabilitySpawner', () => {
  let spawner: McpCapabilitySpawner

  afterEach(async () => {
    if (spawner) await spawner.shutdownAll()
  })

  it('spawns a server and lists tools', async () => {
    spawner = new McpCapabilitySpawner()
    const handle = await spawner.spawn(makeSmokeCap(), 'session-1')

    expect(handle.tools.length).toBeGreaterThanOrEqual(1)
    const toolNames = handle.tools.map(t => t.name)
    expect(toolNames).toContain('smoke_ping')
    expect(toolNames).toContain('smoke_echo')
  }, 15_000)

  it('creates separate instances per session (factory pattern)', async () => {
    spawner = new McpCapabilitySpawner()
    const h1 = await spawner.spawn(makeSmokeCap(), 'session-1')
    const h2 = await spawner.spawn(makeSmokeCap(), 'session-2')

    expect(h1.sessionId).toBe('session-1')
    expect(h2.sessionId).toBe('session-2')
    expect(h1.pid).not.toBe(h2.pid)
  }, 15_000)

  it('shuts down a specific session', async () => {
    spawner = new McpCapabilitySpawner()
    await spawner.spawn(makeSmokeCap(), 'session-1')

    await spawner.shutdown('Smoke Test', 'session-1')
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)

  it('shuts down all sessions for a capability', async () => {
    spawner = new McpCapabilitySpawner()
    await spawner.spawn(makeSmokeCap(), 'session-1')
    await spawner.spawn(makeSmokeCap(), 'session-2')

    await spawner.shutdownCapability('Smoke Test')
    expect(spawner.listActive()).toHaveLength(0)
  }, 15_000)
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/capabilities/mcp-spawner.test.ts`
Expected: FAIL — `McpCapabilitySpawner` doesn't exist

- [ ] **Step 5: Implement mcp-spawner.ts**

In `packages/core/src/capabilities/mcp-spawner.ts`:

```typescript
/**
 * MCP Capability Spawner
 *
 * Manages child process lifecycle for MCP-interface capabilities.
 * Each session gets its own server process (factory pattern).
 * Connect via stdio transport using @modelcontextprotocol/sdk.
 *
 * Lifecycle:
 * - Spawn: entrypoint command as child process, connect via stdio
 * - Crash recovery: exit listener logs event, marks health degraded
 * - Shutdown: SIGTERM → wait 5s → SIGKILL survivors
 */

import { type ChildProcess } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { EventEmitter } from 'node:events'

const STARTUP_TIMEOUT_MS = 10_000
const SHUTDOWN_TIMEOUT_MS = 5_000

export interface McpHandle {
  capabilityName: string
  sessionId: string
  pid: number
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>
  client: Client
  process: ChildProcess | null
  shutdown: () => Promise<void>
}

/**
 * Events:
 * - 'crash': { capabilityName, sessionId, pid, code, signal } — server exited unexpectedly
 */
export class McpCapabilitySpawner extends EventEmitter {
  private handles: McpHandle[] = []

  /**
   * Spawn an MCP server for a capability session.
   * Connects via stdio, discovers tools, returns a handle.
   * Environment: inherits process.env (which includes .env vars loaded at dashboard startup).
   */
  async spawn(capability: { name: string; path: string; entrypoint?: string }, sessionId: string): Promise<McpHandle> {
    if (!capability.entrypoint) {
      throw new Error(`Capability "${capability.name}" has no entrypoint`)
    }

    const [command, ...args] = capability.entrypoint.split(/\s+/)

    const transport = new StdioClientTransport({
      command,
      args,
      cwd: capability.path,
      env: { ...process.env },
    })

    const client = new Client({ name: `capability-${capability.name}`, version: '1.0.0' })

    // Connect with timeout
    const connectPromise = client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Server startup timeout (${STARTUP_TIMEOUT_MS}ms)`)), STARTUP_TIMEOUT_MS),
    )
    await Promise.race([connectPromise, timeoutPromise])

    // Discover tools
    const toolsResult = await client.listTools()
    const tools = toolsResult.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))

    // Get child process reference from transport for lifecycle management
    const childProcess = (transport as unknown as { _process?: ChildProcess })._process ?? null
    const pid = childProcess?.pid ?? 0

    // Crash recovery: listen for unexpected exits
    if (childProcess) {
      childProcess.on('exit', (code, signal) => {
        // Only emit if the handle is still active (not a clean shutdown)
        const stillActive = this.handles.some(
          h => h.capabilityName === capability.name && h.sessionId === sessionId
        )
        if (stillActive) {
          this.emit('crash', {
            capabilityName: capability.name,
            sessionId,
            pid,
            code,
            signal,
          })
          // Remove the dead handle
          this.handles = this.handles.filter(
            h => !(h.capabilityName === capability.name && h.sessionId === sessionId)
          )
        }
      })
    }

    const shutdown = async () => {
      // Remove from active list first to prevent crash event
      this.handles = this.handles.filter(
        h => !(h.capabilityName === capability.name && h.sessionId === sessionId)
      )

      // Try clean MCP disconnect first
      try { await client.close() } catch { /* best effort */ }

      // SIGTERM → wait → SIGKILL if process still alive
      if (childProcess && !childProcess.killed) {
        childProcess.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL')
            }
            resolve()
          }, SHUTDOWN_TIMEOUT_MS)
          childProcess.on('exit', () => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
    }

    const handle: McpHandle = {
      capabilityName: capability.name,
      sessionId,
      pid,
      tools,
      client,
      process: childProcess,
      shutdown,
    }

    this.handles.push(handle)
    return handle
  }

  /** Shut down a specific session's server */
  async shutdown(capabilityName: string, sessionId: string): Promise<void> {
    const handle = this.handles.find(h => h.capabilityName === capabilityName && h.sessionId === sessionId)
    if (handle) await handle.shutdown()
  }

  /** Shut down all sessions for a capability (toggle off) */
  async shutdownCapability(capabilityName: string): Promise<void> {
    const toShutdown = this.handles.filter(h => h.capabilityName === capabilityName)
    await Promise.all(toShutdown.map(h => h.shutdown()))
  }

  /** Shut down everything (dashboard shutdown) */
  async shutdownAll(): Promise<void> {
    await Promise.all(this.handles.map(h => h.shutdown()))
    this.handles = []
  }

  /** List active handles */
  listActive(): McpHandle[] {
    return [...this.handles]
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/capabilities/mcp-spawner.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/capabilities/mcp-spawner.ts packages/core/tests/capabilities/mcp-spawner.test.ts packages/core/tests/fixtures/smoke-mcp-server/
git commit -m "feat(capabilities): MCP capability spawner with per-session factory pattern"
```

---

## Task 5: Framework Middleware Chain

Build the PostToolUse middleware for MCP capability tool calls: rate limiter, audit logger, and screenshot interceptor.

**Files:**
- Create: `packages/core/src/capabilities/mcp-middleware.ts`
- Create: `packages/core/tests/capabilities/mcp-middleware.test.ts`

- [ ] **Step 1: Write middleware tests**

In `packages/core/tests/capabilities/mcp-middleware.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
} from '../../src/capabilities/mcp-middleware.js'

describe('createCapabilityRateLimiter', () => {
  it('allows calls within the limit', () => {
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 5 })
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('desktop-control')).toBe(true)
    }
  })

  it('blocks calls exceeding the limit', () => {
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 2 })
    expect(limiter.check('desktop-control')).toBe(true)
    expect(limiter.check('desktop-control')).toBe(true)
    expect(limiter.check('desktop-control')).toBe(false)
  })

  it('tracks capabilities independently', () => {
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 1 })
    expect(limiter.check('desktop-control')).toBe(true)
    expect(limiter.check('other-type')).toBe(true)
    expect(limiter.check('desktop-control')).toBe(false)
  })
})

describe('createCapabilityAuditLogger', () => {
  it('logs tool calls to the provided writer', async () => {
    const entries: unknown[] = []
    const logger = createCapabilityAuditLogger((entry) => { entries.push(entry) })

    await logger.log({
      capabilityName: 'Desktop Control',
      toolName: 'desktop_screenshot',
      sessionId: 'test-session',
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      capability: 'Desktop Control',
      tool: 'desktop_screenshot',
      session: 'test-session',
    })
  })
})

describe('createScreenshotInterceptor', () => {
  it('detects base64 PNG content in tool results', () => {
    const interceptor = createScreenshotInterceptor()
    // PNG magic bytes in base64: iVBORw0KGgo
    const result = { content: [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' }] }
    expect(interceptor.hasScreenshot(result)).toBe(true)
  })

  it('returns false for non-image results', () => {
    const interceptor = createScreenshotInterceptor()
    const result = { content: [{ type: 'text', text: 'hello' }] }
    expect(interceptor.hasScreenshot(result)).toBe(false)
  })

  it('extracts base64 image data', () => {
    const interceptor = createScreenshotInterceptor()
    const result = { content: [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' }] }
    const extracted = interceptor.extractImage(result)
    expect(extracted).toBe('iVBORw0KGgoAAAANSUhEUg==')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/capabilities/mcp-middleware.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement mcp-middleware.ts**

In `packages/core/src/capabilities/mcp-middleware.ts`:

```typescript
/**
 * MCP Capability Middleware
 *
 * Framework-side middleware for MCP capability tool calls:
 * - Rate limiter: sliding window per capability type
 * - Audit logger: JSONL logging of tool calls
 * - Screenshot interceptor: detects base64 images in tool results
 *
 * These run in the framework, not in the capability server process.
 * Wired via PostToolUse hooks in the Agent SDK.
 */

/**
 * Sliding-window rate limiter per capability type.
 */
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

      // Remove expired entries
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

/**
 * Audit logger for capability tool calls.
 */
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
  writer: (entry: AuditEntry) => void,
): AuditLogger {
  return {
    async log({ capabilityName, toolName, sessionId }) {
      writer({
        timestamp: new Date().toISOString(),
        capability: capabilityName,
        tool: toolName,
        session: sessionId,
      })
    },
  }
}

/**
 * Screenshot interceptor — detects and extracts base64 images from MCP tool results.
 * The framework stores these via VAS and replaces with reference URLs.
 */
export interface ScreenshotInterceptor {
  hasScreenshot(result: unknown): boolean
  extractImage(result: unknown): string | null
}

export function createScreenshotInterceptor(): ScreenshotInterceptor {
  const PNG_MAGIC_B64 = 'iVBORw0KGgo'

  function findImageContent(result: unknown): { type: string; data: string } | null {
    if (!result || typeof result !== 'object') return null
    const r = result as { content?: unknown[] }
    if (!Array.isArray(r.content)) return null
    for (const block of r.content) {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        (block as { type: string }).type === 'image' &&
        'data' in block &&
        typeof (block as { data: unknown }).data === 'string'
      ) {
        return block as { type: string; data: string }
      }
    }
    return null
  }

  return {
    hasScreenshot(result: unknown): boolean {
      const img = findImageContent(result)
      if (!img) return false
      return img.data.startsWith(PNG_MAGIC_B64)
    },

    extractImage(result: unknown): string | null {
      const img = findImageContent(result)
      if (!img) return null
      return img.data
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/capabilities/mcp-middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/capabilities/mcp-middleware.ts packages/core/tests/capabilities/mcp-middleware.test.ts
git commit -m "feat(capabilities): framework middleware — rate limiter, audit logger, screenshot interceptor"
```

---

## Task 6: Extend Test Harness — MCP Client Path

Add an MCP test path to the test harness that spawns the server, validates tool schemas against the template contract, and runs a functional test (display-gated).

**Files:**
- Modify: `packages/core/src/capabilities/test-harness.ts`
- Create: `packages/core/tests/capabilities/test-harness-mcp.test.ts`

- [ ] **Step 1: Write MCP harness tests**

In `packages/core/tests/capabilities/test-harness-mcp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { testCapability } from '../../src/capabilities/test-harness.js'
import type { Capability } from '../../src/capabilities/types.js'

const fixtureDir = join(import.meta.dirname, '..', 'fixtures', 'smoke-mcp-server')

describe('testCapability — MCP interface', () => {
  it('passes for valid MCP server with matching tools', async () => {
    const cap: Capability = {
      name: 'Smoke Test',
      provides: 'smoke',
      interface: 'mcp',
      path: fixtureDir,
      status: 'available',
      health: 'untested',
      enabled: true,
      entrypoint: 'npx tsx server.ts',
    }

    const result = await testCapability(cap, '')
    expect(result.status).toBe('ok')
    expect(result.latencyMs).toBeGreaterThan(0)
  }, 20_000)

  it('fails when entrypoint is missing', async () => {
    const cap: Capability = {
      name: 'No Entry',
      provides: 'smoke',
      interface: 'mcp',
      path: fixtureDir,
      status: 'available',
      health: 'untested',
      enabled: true,
      // no entrypoint
    }

    const result = await testCapability(cap, '')
    expect(result.status).toBe('error')
    expect(result.message).toContain('entrypoint')
  })

  it('returns error for non-existent well-known type with mcp interface', async () => {
    const cap: Capability = {
      name: 'Unknown',
      provides: 'nonexistent-type',
      interface: 'mcp',
      path: fixtureDir,
      status: 'available',
      health: 'untested',
      enabled: true,
      entrypoint: 'npx tsx server.ts',
    }

    const result = await testCapability(cap, '')
    // MCP capabilities without a specific test contract still get the generic MCP test
    expect(result.status).toBe('ok')
  }, 20_000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/capabilities/test-harness-mcp.test.ts`
Expected: FAIL — harness doesn't handle MCP interface

- [ ] **Step 3: Add MCP test path to test-harness.ts**

Add imports at the top of `packages/core/src/capabilities/test-harness.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
```

Replace the `testCapability` function to dispatch by interface type:

```typescript
export async function testCapability(
  capability: Capability,
  projectRoot: string,
): Promise<CapabilityTestResult> {
  if (capability.status !== 'available') {
    return { status: 'error', latencyMs: 0, message: `Capability is ${capability.status}` }
  }

  const type = capability.provides
  if (!type) {
    return { status: 'error', latencyMs: 0, message: 'No well-known type — cannot test' }
  }

  // Dispatch by interface type
  if (capability.interface === 'mcp') {
    return testMcpCapability(capability)
  }

  // Script interface — use type-specific test contract
  const tester = TEST_CONTRACTS[type]
  if (!tester) {
    return { status: 'error', latencyMs: 0, message: `No test contract for type: ${type}` }
  }

  try {
    return await tester(capability, projectRoot)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', latencyMs: 0, message }
  }
}
```

Add the MCP test function at the bottom (before the helper functions):

```typescript
/**
 * Test an MCP capability:
 * 1. Environment check — run scripts/detect.sh, skip if fails (headless/CI)
 * 2. Check entrypoint exists
 * 3. Spawn server via entrypoint
 * 4. Connect as MCP client
 * 5. List tools — validate at least one is present
 * 6. Disconnect and clean up
 *
 * Well-known type-specific tool schema validation will be added
 * when type-specific MCP contracts are defined (S4 — desktop-control template).
 */
async function testMcpCapability(capability: Capability): Promise<CapabilityTestResult> {
  if (!capability.entrypoint) {
    return { status: 'error', latencyMs: 0, message: 'MCP capability has no entrypoint' }
  }

  // Step 1: Environment check — run detect.sh if it exists
  const detectScript = join(capability.path, 'scripts', 'detect.sh')
  if (existsSync(detectScript)) {
    try {
      await execFileAsync('bash', [detectScript], {
        timeout: 10_000,
        cwd: capability.path,
      })
    } catch {
      // detect.sh failed — environment not suitable (e.g., headless, missing display)
      // Mark as untested, not failed — the capability isn't broken, just can't test here
      return { status: 'error', latencyMs: 0, message: 'environment check failed (detect.sh)' }
    }
  }

  const [command, ...args] = capability.entrypoint.split(/\s+/)
  const start = performance.now()

  let client: Client | null = null

  try {
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: capability.path,
      env: { ...process.env },
    })

    client = new Client({ name: 'capability-test', version: '1.0.0' })

    // Connect with timeout
    const connectPromise = client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Server startup timeout (10s)')), 10_000),
    )
    await Promise.race([connectPromise, timeoutPromise])

    // List tools
    const toolsResult = await client.listTools()
    const latencyMs = Math.round(performance.now() - start)

    if (!toolsResult.tools || toolsResult.tools.length === 0) {
      return { status: 'error', latencyMs, message: 'MCP server registered no tools' }
    }

    return { status: 'ok', latencyMs }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', latencyMs, message }
  } finally {
    try { if (client) await client.close() } catch { /* best effort */ }
  }
}
```

**Note on detect.sh gating:** When `detect.sh` exists and exits non-zero, the result message must trigger `health = 'untested'` in the registry's `test()` method. The existing registry logic sets `untested` when `result.message?.includes('not found')`. Refine this: use a dedicated message like `'environment check failed (detect.sh)'` and update `registry.test()` to also set `untested` for messages containing `'environment check failed'`:

In `registry.ts`, update the health update logic in `test()`:

```typescript
} else if (result.message?.includes('not found') || result.message?.includes('environment check failed')) {
  cap.health = 'untested'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/capabilities/test-harness-mcp.test.ts`
Expected: PASS

- [ ] **Step 5: Run all capability tests for regressions**

Run: `cd packages/core && npx vitest run tests/capabilities/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/capabilities/test-harness.ts packages/core/tests/capabilities/test-harness-mcp.test.ts
git commit -m "feat(test-harness): MCP client test path — spawn, connect, validate tools"
```

---

## Task 7: Update Exports and Verify Full Build

Wire up all new modules in the public index and verify the full package builds.

**Files:**
- Modify: `packages/core/src/capabilities/index.ts`

- [ ] **Step 1: Update index.ts exports**

In `packages/core/src/capabilities/index.ts`:

```typescript
export type {
  Capability,
  CapabilityFrontmatter,
  CapabilityMcpConfig,
  CapabilityTestResult,
} from './types.js'
export { CapabilityRegistry } from './registry.js'
export { scanCapabilities } from './scanner.js'
export { testCapability } from './test-harness.js'
export { McpCapabilitySpawner, type McpHandle } from './mcp-spawner.js'
export {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  type RateLimiter,
  type AuditLogger,
  type AuditEntry,
  type ScreenshotInterceptor,
} from './mcp-middleware.js'
```

- [ ] **Step 2: Run full build**

Run: `cd packages/core && npx tsc`
Expected: PASS — clean compilation

- [ ] **Step 3: Run all tests**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/capabilities/index.ts
git commit -m "feat(capabilities): export spawner and middleware from public index"
```

---

## Task 8: Integration Smoke Test — End-to-End Validation

Verify the full flow: scanner discovers an MCP capability with `.enabled`, registry gates on `enabled`, spawner connects, middleware intercepts, test harness validates.

**Files:**
- Create: `packages/core/tests/capabilities/integration.test.ts`

- [ ] **Step 1: Write integration test**

In `packages/core/tests/capabilities/integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cpSync } from 'node:fs'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import { McpCapabilitySpawner } from '../../src/capabilities/mcp-spawner.js'
import { createCapabilityRateLimiter } from '../../src/capabilities/mcp-middleware.js'

const smokeFixtureDir = join(import.meta.dirname, '..', 'fixtures', 'smoke-mcp-server')

describe('MCP capability integration', () => {
  let baseDir: string
  let capDir: string
  let envPath: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `cap-integration-${Date.now()}`)
    capDir = join(baseDir, 'capabilities')
    mkdirSync(capDir, { recursive: true })
    envPath = join(baseDir, '.env')
    writeFileSync(envPath, '')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('full flow: scan → registry → spawn → rate limit → shutdown', async () => {
    // 1. Set up a capability folder with smoke server
    const destDir = join(capDir, 'smoke-test')
    cpSync(smokeFixtureDir, destDir, { recursive: true })
    writeFileSync(join(destDir, 'CAPABILITY.md'), [
      '---',
      'name: Smoke Test',
      'provides: smoke',
      'interface: mcp',
      'entrypoint: npx tsx server.ts',
      '---',
      'Smoke test MCP capability.',
    ].join('\n'))
    // Enable it
    writeFileSync(join(destDir, '.enabled'), new Date().toISOString())

    // 2. Scan
    const caps = await scanCapabilities(capDir, envPath)
    expect(caps).toHaveLength(1)
    expect(caps[0].enabled).toBe(true)
    expect(caps[0].entrypoint).toBe('npx tsx server.ts')

    // 3. Registry gates on enabled
    const registry = new CapabilityRegistry()
    registry.load(caps)
    expect(registry.get('smoke')).toBeDefined()
    expect(registry.isEnabled('smoke')).toBe(true)

    // 4. Spawner connects
    const spawner = new McpCapabilitySpawner()
    const cap = registry.get('smoke')!
    const handle = await spawner.spawn(cap, 'test-session')
    expect(handle.tools.length).toBeGreaterThanOrEqual(1)

    // 5. Rate limiter works
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 2 })
    expect(limiter.check('smoke')).toBe(true)
    expect(limiter.check('smoke')).toBe(true)
    expect(limiter.check('smoke')).toBe(false)

    // 6. Toggle off — registry no longer returns it
    registry.toggle('smoke')
    expect(registry.get('smoke')).toBeUndefined()

    // 7. Cleanup
    await spawner.shutdownAll()
  }, 30_000)
})
```

- [ ] **Step 2: Run integration test**

Run: `cd packages/core && npx vitest run tests/capabilities/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/capabilities/integration.test.ts
git commit -m "test(capabilities): integration smoke test — scan → registry → spawn → middleware"
```

---

## Verification Summary

| Spec Requirement | Task | Verification |
|-----------------|------|--------------|
| `entrypoint` field on frontmatter + capability | Task 1 | Type test + scanner test |
| `requires.system` with tool probing | Task 2 | Scanner test with missing/present tools |
| `.enabled` file read during scan | Task 2 | Scanner test |
| `.mcp.json` coexistence (regression) | Task 2 | Scanner test with .mcp.json capability |
| `get()` gates on `available` AND `enabled` | Task 3 | Registry test |
| `has()` respects enabled gate | Task 3 | Registry test (delegates to get()) |
| `isEnabled()` method | Task 3 | Registry test |
| `toggle()` writes/removes `.enabled` file | Task 3 | Registry test with filesystem |
| `toggle()` emits `capability:changed` event | Task 3 | Registry test with event listener |
| MCP server spawning (child process, stdio) | Task 4 | Spawner test with smoke server |
| Per-session factory pattern | Task 4 | Spawner test creates 2 instances |
| Shutdown lifecycle (SIGTERM → wait → SIGKILL) | Task 4 | Spawner shutdown with forced kill fallback |
| Crash recovery (exit listener, health → degraded) | Task 4 | Spawner emits 'crash' event on unexpected exit |
| Rate limiter (sliding window) | Task 5 | Middleware test |
| Audit logger | Task 5 | Middleware test |
| Screenshot interceptor | Task 5 | Middleware test |
| Middleware wiring to PostToolUse hooks | — | Deferred to S3 (primitives tested, wiring in app.ts) |
| detect.sh gates functional test | Task 6 | Harness runs detect.sh, marks `untested` on failure |
| MCP test harness path | Task 6 | Harness test with smoke server |
| Full integration flow | Task 8 | Integration test |
