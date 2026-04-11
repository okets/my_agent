# M9.5-S4: Template & Agent Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the capability framework is self-building — write a desktop-control template, fix S3 deferred issues, enhance the test harness, then delete the capability and have an agent rebuild it from the template until the harness passes.

**Architecture:** The template (`skills/capability-templates/desktop-control.md`) defines the MCP tool contract (required/optional/custom tiers). The test harness (`packages/core/src/capabilities/test-harness.ts`) validates capabilities against templates by checking tool schemas and running a functional screenshot test. A cleanup script deletes the capability folder for rebuild testing.

**Tech Stack:** TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), Vitest, zod

---

### Task 1: Fix dead crash monitoring code in app.ts

**Files:**
- Modify: `packages/dashboard/src/app.ts:1643-1684`

The `McpCapabilitySpawner` is instantiated at line 1655 but `spawn()` is never called — the SDK manages the child process. The crash listener on lines 1657-1666 never fires. Remove the dead spawner instance and crash listener. The factory pattern (lines 1670-1678) is correct and stays.

- [ ] **Step 1: Remove dead crash monitoring code**

Replace lines 1643-1684 in `packages/dashboard/src/app.ts`. Remove the `McpCapabilitySpawner` instantiation and its crash listener. Keep the capability lookup and factory registration:

```typescript
    // ── Desktop control (M9.5-S3: registry-based) ──
    {
      // Registry path: if desktop-x11 capability is installed and enabled, wire factory
      const desktopCap = app.capabilityRegistry?.list().find(
        (c) => c.provides === 'desktop-control' && c.interface === 'mcp' && c.entrypoint && c.enabled,
      )

      if (desktopCap && desktopCap.status === 'available') {
        // Factory: return stdio config so the SDK spawns the process itself.
        const entrypointParts = desktopCap.entrypoint!.split(/\s+/)
        addMcpServerFactory('desktop-x11', async () => ({
          command: entrypointParts[0],
          args: entrypointParts.slice(1),
          cwd: desktopCap.path,
          env: Object.fromEntries(
            Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
          ),
        }))

        console.log(`[Desktop] desktop-x11 capability wired via registry`)
      } else {
        console.log('[Desktop] No desktop-control capability installed — desktop tools unavailable')
      }
    }
```

This simultaneously fixes both S3 deferred items:
- Removes dead crash monitoring code (S3 I1)
- Adds `c.enabled` check to the `.find()` predicate (S3 I2)

- [ ] **Step 2: Remove unused McpCapabilitySpawner import**

Check if `McpCapabilitySpawner` is used elsewhere in `app.ts`. If this was the only usage, remove its import statement.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean compilation, no errors.

- [ ] **Step 4: Run existing tests**

Run: `cd packages/core && npx vitest run tests/capabilities/ --reporter=verbose`
Expected: All existing capability tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "fix(m9.5-s4): remove dead crash monitoring, add enabled-gate to desktop factory

S3 deferred I1: McpCapabilitySpawner was instantiated but spawn() never called —
the SDK manages the child process, so the crash listener never fired. Removed.

S3 deferred I2: factory registration now checks c.enabled, preventing disabled
capabilities from being wired."
```

---

### Task 2: Expand test fixture to all 7 required tools

**Files:**
- Modify: `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`

The fixture currently has 3 tools: `desktop_info`, `desktop_screenshot`, `desktop_click`. Add the 4 missing required tools: `desktop_type`, `desktop_key`, `desktop_scroll`, `desktop_wait`. All return mock data — this is a test fixture, not a real implementation.

- [ ] **Step 1: Add missing tools to fixture server**

Replace the full contents of `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'desktop-x11-test', version: '1.0.0' })

// Required tools (7)

server.tool(
  'desktop_screenshot',
  'Take screenshot (test fixture)',
  { region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ fixture: true, width: 1920, height: 1080 }) }],
  }),
)

server.tool(
  'desktop_click',
  'Click at coordinates (test fixture)',
  { x: z.number(), y: z.number(), button: z.string().optional(), double: z.boolean().optional() },
  async ({ x, y }) => ({
    content: [{ type: 'text', text: JSON.stringify({ clicked: { x, y }, fixture: true }) }],
  }),
)

server.tool(
  'desktop_type',
  'Type text (test fixture)',
  { text: z.string() },
  async ({ text }) => ({
    content: [{ type: 'text', text: JSON.stringify({ typed: text, fixture: true }) }],
  }),
)

server.tool(
  'desktop_key',
  'Press key combo (test fixture)',
  { key: z.string() },
  async ({ key }) => ({
    content: [{ type: 'text', text: JSON.stringify({ pressed: key, fixture: true }) }],
  }),
)

server.tool(
  'desktop_scroll',
  'Scroll at position (test fixture)',
  { x: z.number(), y: z.number(), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().optional() },
  async ({ x, y, direction }) => ({
    content: [{ type: 'text', text: JSON.stringify({ scrolled: { x, y, direction }, fixture: true }) }],
  }),
)

server.tool(
  'desktop_info',
  'Query desktop info (test fixture)',
  { query: z.enum(['windows', 'display', 'capabilities']) },
  async ({ query }) => ({
    content: [{ type: 'text', text: JSON.stringify({ query, fixture: true }) }],
  }),
)

server.tool(
  'desktop_wait',
  'Wait for UI settling (test fixture)',
  { seconds: z.number() },
  async ({ seconds }) => ({
    content: [{ type: 'text', text: JSON.stringify({ waited: seconds, fixture: true }) }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 2: Run fixture test to verify server starts**

Run: `cd packages/core && npx vitest run tests/capabilities/desktop-extraction.test.ts --reporter=verbose`
Expected: All 3 existing tests pass (scanner, toggle, harness validation).

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts
git commit -m "feat(m9.5-s4): expand desktop test fixture to all 7 required tools

Adds desktop_type, desktop_key, desktop_scroll, desktop_wait to the test
fixture MCP server. All tools return mock data with correct input schemas
matching the design spec's tool contract."
```

---

### Task 3: Add tool schema validation to test harness

**Files:**
- Modify: `packages/core/src/capabilities/test-harness.ts`
- Create: `packages/core/src/capabilities/tool-contracts.ts`
- Create: `packages/core/tests/capabilities/schema-validation.test.ts`

The test harness currently only checks that MCP tools exist (line 104-106). Extend it to validate required tools are present with correct input schemas, and optional tools (if present) have correct schemas. Tool contracts are defined in a separate file so templates and harness share the same source of truth.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/capabilities/schema-validation.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import { join } from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')
const FIXTURE_ENABLED_PATH = join(FIXTURES_DIR, 'desktop-x11-fixture', '.enabled')

afterEach(() => {
  try { unlinkSync(FIXTURE_ENABLED_PATH) } catch { /* already gone */ }
})

describe('MCP tool schema validation', () => {
  it('validates all 7 required desktop-control tools are present', async () => {
    writeFileSync(FIXTURE_ENABLED_PATH, new Date().toISOString())

    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const registry = new CapabilityRegistry()
    registry.setProjectRoot(join(FIXTURES_DIR, '..', '..'))
    registry.load(caps)

    const result = await registry.test('desktop-control')
    expect(result.status).toBe('ok')
    // The test harness now validates schemas — if any required tool
    // is missing or has wrong schema, status would be 'error'
  }, 30_000)

  it('reports error when required tool is missing', async () => {
    // This test uses the fixture as-is — we'll verify that if a tool
    // were missing, the harness would catch it. Since our fixture has
    // all 7 tools, we test the validation logic via a unit test of
    // the contract checker directly.
    const { DESKTOP_CONTROL_CONTRACT } = await import('../../src/capabilities/tool-contracts.js')
    expect(DESKTOP_CONTROL_CONTRACT.required).toHaveLength(7)
    expect(DESKTOP_CONTROL_CONTRACT.required.map(t => t.name)).toEqual([
      'desktop_screenshot',
      'desktop_click',
      'desktop_type',
      'desktop_key',
      'desktop_scroll',
      'desktop_info',
      'desktop_wait',
    ])
  })

  it('validates required tool input parameters', async () => {
    const { validateToolContract } = await import('../../src/capabilities/tool-contracts.js')

    // Simulate a tool list with correct schemas
    const tools = [
      { name: 'desktop_screenshot', inputSchema: { type: 'object', properties: { region: { type: 'object' } } } },
      { name: 'desktop_click', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
      { name: 'desktop_type', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'desktop_key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
      { name: 'desktop_scroll', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, direction: {} }, required: ['x', 'y', 'direction'] } },
      { name: 'desktop_info', inputSchema: { type: 'object', properties: { query: {} }, required: ['query'] } },
      { name: 'desktop_wait', inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
    ]

    const result = validateToolContract('desktop-control', tools)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('detects missing required tool', async () => {
    const { validateToolContract } = await import('../../src/capabilities/tool-contracts.js')

    // Missing desktop_wait
    const tools = [
      { name: 'desktop_screenshot', inputSchema: { type: 'object', properties: {} } },
      { name: 'desktop_click', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
      { name: 'desktop_type', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'desktop_key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
      { name: 'desktop_scroll', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, direction: {} }, required: ['x', 'y', 'direction'] } },
      { name: 'desktop_info', inputSchema: { type: 'object', properties: { query: {} }, required: ['query'] } },
    ]

    const result = validateToolContract('desktop-control', tools)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('desktop_wait'))
  })

  it('detects missing required parameter', async () => {
    const { validateToolContract } = await import('../../src/capabilities/tool-contracts.js')

    // desktop_click missing required 'x' param
    const tools = [
      { name: 'desktop_screenshot', inputSchema: { type: 'object', properties: {} } },
      { name: 'desktop_click', inputSchema: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] } },
      { name: 'desktop_type', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'desktop_key', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
      { name: 'desktop_scroll', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, direction: {} }, required: ['x', 'y', 'direction'] } },
      { name: 'desktop_info', inputSchema: { type: 'object', properties: { query: {} }, required: ['query'] } },
      { name: 'desktop_wait', inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
    ]

    const result = validateToolContract('desktop-control', tools)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('desktop_click'))
    expect(result.errors).toContainEqual(expect.stringContaining('x'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/capabilities/schema-validation.test.ts --reporter=verbose`
Expected: FAIL — `tool-contracts.js` doesn't exist yet.

- [ ] **Step 3: Create tool contracts module**

Create `packages/core/src/capabilities/tool-contracts.ts`:

```typescript
/**
 * Tool contracts for MCP capability validation.
 *
 * Each well-known MCP type defines required and optional tools with
 * their expected input parameters. The test harness uses these to
 * validate that a capability implementation meets the contract.
 */

export interface ToolParam {
  name: string
  required: boolean
}

export interface ToolSpec {
  name: string
  requiredParams: ToolParam[]
}

export interface ToolContract {
  type: string
  required: ToolSpec[]
  optional: ToolSpec[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export const DESKTOP_CONTROL_CONTRACT: ToolContract = {
  type: 'desktop-control',
  required: [
    { name: 'desktop_screenshot', requiredParams: [] },
    { name: 'desktop_click', requiredParams: [{ name: 'x', required: true }, { name: 'y', required: true }] },
    { name: 'desktop_type', requiredParams: [{ name: 'text', required: true }] },
    { name: 'desktop_key', requiredParams: [{ name: 'key', required: true }] },
    { name: 'desktop_scroll', requiredParams: [{ name: 'x', required: true }, { name: 'y', required: true }, { name: 'direction', required: true }] },
    { name: 'desktop_info', requiredParams: [{ name: 'query', required: true }] },
    { name: 'desktop_wait', requiredParams: [{ name: 'seconds', required: true }] },
  ],
  optional: [
    { name: 'desktop_diff_check', requiredParams: [] },
    { name: 'desktop_find_element', requiredParams: [{ name: 'query', required: true }] },
    { name: 'desktop_ocr', requiredParams: [] },
    { name: 'desktop_window_screenshot', requiredParams: [{ name: 'windowId', required: true }] },
    { name: 'desktop_drag', requiredParams: [{ name: 'fromX', required: true }, { name: 'fromY', required: true }, { name: 'toX', required: true }, { name: 'toY', required: true }] },
  ],
}

const CONTRACTS: Record<string, ToolContract> = {
  'desktop-control': DESKTOP_CONTROL_CONTRACT,
}

export function getToolContract(type: string): ToolContract | undefined {
  return CONTRACTS[type]
}

/**
 * Validate a set of MCP tools against a well-known type contract.
 *
 * - All required tools must be present with correct required params
 * - Optional tools, if present, must have correct required params
 * - Custom tools (not in contract) are ignored
 */
export function validateToolContract(
  type: string,
  tools: Array<{ name: string; inputSchema: unknown }>,
): ValidationResult {
  const contract = CONTRACTS[type]
  if (!contract) {
    return { valid: true, errors: [] } // No contract = no validation
  }

  const errors: string[] = []
  const toolMap = new Map(tools.map(t => [t.name, t]))

  // Check required tools
  for (const spec of contract.required) {
    const tool = toolMap.get(spec.name)
    if (!tool) {
      errors.push(`Missing required tool: ${spec.name}`)
      continue
    }
    validateParams(spec, tool.inputSchema, errors)
  }

  // Check optional tools (only if present)
  for (const spec of contract.optional) {
    const tool = toolMap.get(spec.name)
    if (!tool) continue // Optional — absence is fine
    validateParams(spec, tool.inputSchema, errors)
  }

  return { valid: errors.length === 0, errors }
}

function validateParams(
  spec: ToolSpec,
  inputSchema: unknown,
  errors: string[],
): void {
  if (!inputSchema || typeof inputSchema !== 'object') return

  const schema = inputSchema as { properties?: Record<string, unknown>; required?: string[] }
  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  for (const param of spec.requiredParams) {
    if (!(param.name in properties)) {
      errors.push(`Tool "${spec.name}" missing required parameter: ${param.name}`)
    } else if (param.required && !required.includes(param.name)) {
      errors.push(`Tool "${spec.name}" parameter "${param.name}" should be required`)
    }
  }
}
```

- [ ] **Step 4: Export from index**

Add to `packages/core/src/capabilities/index.ts`:

```typescript
export {
  validateToolContract,
  getToolContract,
  DESKTOP_CONTROL_CONTRACT,
  type ToolContract,
  type ToolSpec,
  type ValidationResult,
} from './tool-contracts.js'
```

- [ ] **Step 5: Wire schema validation into test harness**

In `packages/core/src/capabilities/test-harness.ts`, update the `testMcpCapability` function to call `validateToolContract` after listing tools. Add the import at the top and replace the tool validation section (lines 101-108):

Add import:
```typescript
import { validateToolContract } from './tool-contracts.js'
```

Replace the validation block in `testMcpCapability` (after `const { tools } = await client.listTools()`):

```typescript
    const { tools } = await client.listTools()
    const latencyMs = Math.round(performance.now() - start)

    if (!tools || tools.length === 0) {
      return { status: 'error', latencyMs, message: 'MCP server registered no tools' }
    }

    // Schema validation against well-known type contract
    if (capability.provides) {
      const validation = validateToolContract(capability.provides, tools)
      if (!validation.valid) {
        return { status: 'error', latencyMs, message: `Contract violations: ${validation.errors.join('; ')}` }
      }
    }

    return { status: 'ok', latencyMs }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/capabilities/schema-validation.test.ts tests/capabilities/desktop-extraction.test.ts --reporter=verbose`
Expected: All tests pass.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd packages/core && npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/capabilities/tool-contracts.ts packages/core/src/capabilities/test-harness.ts packages/core/src/capabilities/index.ts packages/core/tests/capabilities/schema-validation.test.ts
git commit -m "feat(m9.5-s4): add tool schema validation to MCP test harness

Introduces tool-contracts.ts with the desktop-control contract (7 required,
5 optional tools). testMcpCapability now validates required tools are present
with correct input schemas. Optional tools validated if present, custom tools
ignored. 4 new tests covering contract validation logic."
```

---

### Task 4: Add functional screenshot test to harness

**Files:**
- Modify: `packages/core/src/capabilities/test-harness.ts`
- Create: `packages/core/tests/capabilities/functional-screenshot.test.ts`

After schema validation passes, the harness calls `desktop_screenshot` and validates the response. For the real capability, this returns a PNG. For the test fixture, we make the fixture return a minimal valid PNG so the test exercises the full path.

- [ ] **Step 1: Update fixture to return a real PNG header**

In `packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts`, update the `desktop_screenshot` tool to return a base64-encoded minimal PNG (1x1 red pixel, 68 bytes). Replace the `desktop_screenshot` tool definition:

```typescript
// Minimal valid 1x1 red PNG (68 bytes)
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
  '2e00000000c4944415478016360f8cf00000001010000187227a00000000' +
  '049454e44ae426082',
  'hex',
).toString('base64')

server.tool(
  'desktop_screenshot',
  'Take screenshot (test fixture)',
  { region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() },
  async () => ({
    content: [
      { type: 'image', data: TINY_PNG, mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify({ width: 1920, height: 1080, fixture: true }) },
    ],
  }),
)
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/tests/capabilities/functional-screenshot.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { scanCapabilities } from '../../src/capabilities/scanner.js'
import { CapabilityRegistry } from '../../src/capabilities/registry.js'
import { testMcpScreenshot } from '../../src/capabilities/test-harness.js'
import { join } from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')
const FIXTURE_ENABLED_PATH = join(FIXTURES_DIR, 'desktop-x11-fixture', '.enabled')

afterEach(() => {
  try { unlinkSync(FIXTURE_ENABLED_PATH) } catch { /* already gone */ }
})

describe('Functional screenshot test', () => {
  it('desktop_screenshot returns valid image content', async () => {
    writeFileSync(FIXTURE_ENABLED_PATH, new Date().toISOString())

    const caps = await scanCapabilities(FIXTURES_DIR, '/dev/null')
    const desktop = caps.find(c => c.provides === 'desktop-control')
    expect(desktop).toBeDefined()

    const result = await testMcpScreenshot(desktop!)
    expect(result.status).toBe('ok')
  }, 30_000)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/capabilities/functional-screenshot.test.ts --reporter=verbose`
Expected: FAIL — `testMcpScreenshot` is not exported yet.

- [ ] **Step 4: Add functional screenshot test to harness**

In `packages/core/src/capabilities/test-harness.ts`, add and export a `testMcpScreenshot` function. Add it after the `testMcpCapability` function:

```typescript
/**
 * Functional screenshot test: call desktop_screenshot and validate
 * the response contains valid image content (PNG header check).
 */
export async function testMcpScreenshot(capability: Capability): Promise<CapabilityTestResult> {
  if (!capability.entrypoint) {
    return { status: 'error', latencyMs: 0, message: 'MCP capability missing entrypoint' }
  }

  const parts = capability.entrypoint.split(/\s+/)
  const transport = new StdioClientTransport({
    command: parts[0],
    args: parts.slice(1),
    cwd: capability.path,
    env: { ...process.env } as Record<string, string>,
  })

  const client = new Client({ name: 'screenshot-test', version: '1.0.0' })
  const start = performance.now()

  try {
    await client.connect(transport)

    const result = await client.callTool({ name: 'desktop_screenshot', arguments: {} })
    const latencyMs = Math.round(performance.now() - start)

    // Look for image content in the response
    const contents = result.content as Array<{ type: string; data?: string; mimeType?: string }>
    const imageContent = contents.find(c => c.type === 'image' && c.data)

    if (!imageContent) {
      return { status: 'error', latencyMs, message: 'desktop_screenshot did not return image content' }
    }

    // Decode base64 and check PNG header (first 4 bytes: 0x89 P N G)
    const buffer = Buffer.from(imageContent.data!, 'base64')
    if (buffer.length < 8) {
      return { status: 'error', latencyMs, message: `Screenshot too small: ${buffer.length} bytes` }
    }

    const pngHeader = buffer.subarray(0, 4)
    if (pngHeader[0] !== 0x89 || pngHeader[1] !== 0x50 || pngHeader[2] !== 0x4e || pngHeader[3] !== 0x47) {
      return { status: 'error', latencyMs, message: 'Screenshot is not a valid PNG (bad header)' }
    }

    return { status: 'ok', latencyMs }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', latencyMs, message }
  } finally {
    try { await client.close() } catch { /* ignore */ }
  }
}
```

- [ ] **Step 5: Wire screenshot test into the main testMcpCapability flow**

In `testMcpCapability`, after the schema validation passes, add the functional screenshot test for `desktop-control` capabilities. Before the final `return { status: 'ok', latencyMs }`:

```typescript
    // Functional screenshot test for desktop-control
    if (capability.provides === 'desktop-control') {
      // Run in same connection — call desktop_screenshot directly
      try {
        const ssResult = await client.callTool({ name: 'desktop_screenshot', arguments: {} })
        const contents = ssResult.content as Array<{ type: string; data?: string }>
        const imageContent = contents.find(c => c.type === 'image' && c.data)

        if (!imageContent) {
          return { status: 'error', latencyMs, message: 'desktop_screenshot did not return image content' }
        }

        const buffer = Buffer.from(imageContent.data!, 'base64')
        if (buffer.length < 8) {
          return { status: 'error', latencyMs, message: `Screenshot too small: ${buffer.length} bytes` }
        }

        const pngHeader = buffer.subarray(0, 4)
        if (pngHeader[0] !== 0x89 || pngHeader[1] !== 0x50 || pngHeader[2] !== 0x4e || pngHeader[3] !== 0x47) {
          return { status: 'error', latencyMs, message: 'Screenshot is not a valid PNG (bad header)' }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { status: 'error', latencyMs, message: `Screenshot test failed: ${message}` }
      }
    }

    return { status: 'ok', latencyMs }
```

- [ ] **Step 6: Export testMcpScreenshot from index**

Add to `packages/core/src/capabilities/index.ts`:

```typescript
export { testCapability, testMcpScreenshot } from './test-harness.js'
```

(Replace the existing `export { testCapability }` line.)

- [ ] **Step 7: Run all capability tests**

Run: `cd packages/core && npx vitest run tests/capabilities/ --reporter=verbose`
Expected: All tests pass including the new functional screenshot test.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/capabilities/test-harness.ts packages/core/src/capabilities/index.ts packages/core/tests/capabilities/functional-screenshot.test.ts packages/core/tests/fixtures/desktop-x11-fixture/src/server.ts
git commit -m "feat(m9.5-s4): add functional screenshot test to MCP test harness

desktop_screenshot tool call validates response contains image content with
valid PNG header bytes. Test fixture updated to return minimal PNG.
Standalone testMcpScreenshot() exported for direct use. Also wired into
the main testMcpCapability flow for desktop-control capabilities."
```

---

### Task 5: Write desktop-control capability template

**Files:**
- Create: `skills/capability-templates/desktop-control.md`

This is the main deliverable — a comprehensive template that an agent can follow to build a desktop-control capability from scratch. Follows the structure of existing templates (audio-to-text.md) but adapted for MCP interface.

- [ ] **Step 1: Write the template**

Create `skills/capability-templates/desktop-control.md`:

```markdown
---
template_version: 1
type: desktop-control
provides: desktop-control
interface: mcp
---

# Desktop Control Capability Template

Framework-authored contract for desktop control MCP capabilities.

## Overview

Desktop control capabilities provide screen interaction via MCP tools. The framework spawns the capability as a child process, connects via stdio transport, and wraps it with middleware (rate limiting, audit logging, screenshot interception).

The capability is **platform-specific** — each platform (X11, Wayland, macOS) gets its own implementation folder. The framework is platform-ignorant; all platform knowledge lives in the capability.

## Interface: MCP

Unlike script capabilities (called by the framework), MCP capabilities are called by the brain directly. The brain discovers tools via MCP protocol and decides when and how to use them.

**Execution model:** Stateful server, persistent connection per session.

## CAPABILITY.md Frontmatter

```yaml
---
name: Desktop Control (X11)          # Human-readable, platform in parens
provides: desktop-control             # Well-known type — must be exactly this
interface: mcp                        # MCP socket shape
entrypoint: npx tsx src/server.ts     # Command to start the MCP server
requires:
  env: []                             # API keys (if cloud-based)
  system:                             # CLI tools that must be present
    - xdotool                         # X11: mouse/keyboard
    - maim                            # X11: screenshots
    - wmctrl                          # X11: window management
---
```

Adjust `requires.system` for your platform. The `scripts/detect.sh` script validates these.

## Required Tools (7)

Every desktop-control capability MUST expose these tools. The test harness validates their presence and input schemas.

**Every action tool (click, type, key, scroll, wait) MUST return a screenshot in its response.** This eliminates a round trip — the brain sees the result of every action without asking separately.

### desktop_screenshot

Capture the screen or a region.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `region` | object `{ x, y, width, height }` | No | Region to capture. All fields are numbers. Omit for full screen. |

**Returns:** Image content (base64 PNG) + metadata JSON with `width` and `height`.

```typescript
server.tool(
  'desktop_screenshot',
  'Capture the screen or a region',
  { region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() },
  async ({ region }) => {
    const screenshot = await takeScreenshot(region) // Platform-specific
    return {
      content: [
        { type: 'image', data: screenshot.base64, mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify({ width: screenshot.width, height: screenshot.height }) },
      ],
    }
  },
)
```

### desktop_click

Click at coordinates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | number | Yes | X coordinate |
| `y` | number | Yes | Y coordinate |
| `button` | string | No | Mouse button: "left" (default), "right", "middle" |
| `double` | boolean | No | Double-click if true |

**Returns:** Screenshot after action.

### desktop_type

Type text at current cursor position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Text to type |

**Returns:** Screenshot after action.

### desktop_key

Press a key or key combo.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | Key name or combo (e.g., "Return", "ctrl+s", "alt+F4") |

**Returns:** Screenshot after action.

### desktop_scroll

Scroll at a position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | number | Yes | X coordinate to scroll at |
| `y` | number | Yes | Y coordinate to scroll at |
| `direction` | string | Yes | One of: "up", "down", "left", "right" |
| `amount` | number | No | Scroll amount in clicks (default: 3) |

**Returns:** Screenshot after action.

### desktop_info

Query display and window state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | One of: "windows" (list windows), "display" (resolution, scaling), "capabilities" (available features) |

**Returns:** JSON with query results.

### desktop_wait

Pause execution for UI settling.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `seconds` | number | Yes | Seconds to wait (max 10) |

**Returns:** Screenshot after waiting.

## Optional Tools (5)

These enhance the capability but are not required. The test harness validates their schemas if present.

### desktop_diff_check

Cheap text-only change detection. Returns whether the screen changed since last screenshot — saves tokens when the brain wants to check if an action had visible effect.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | | | |

**Returns:** JSON `{ "changed": boolean, "description": "..." }`.

### desktop_find_element

Query the accessibility tree for elements matching a description.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Element description (e.g., "Save button", "text field") |

**Returns:** JSON array of elements with `{ name, role, bounds: { x, y, width, height } }`.

### desktop_ocr

OCR the screen or a region, returning text with bounding boxes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `region` | object `{ x, y, width, height }` | No | Region to OCR (same format as desktop_screenshot) |

**Returns:** JSON array of `{ text, bounds: { x, y, width, height }, confidence }`.

### desktop_window_screenshot

Capture a specific window by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | Yes | Window ID (from desktop_info "windows" query) |

**Returns:** Image content + metadata (same format as desktop_screenshot).

### desktop_drag

Drag from one position to another.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromX` | number | Yes | Start X |
| `fromY` | number | Yes | Start Y |
| `toX` | number | Yes | End X |
| `toY` | number | Yes | End Y |

**Returns:** Screenshot after action.

## Required Scripts

### scripts/detect.sh

Environment detection. Exit 0 if the platform is compatible, exit 1 with JSON error if not.

```bash
#!/usr/bin/env bash
set -euo pipefail

MISSING=()

# Check display server
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  MISSING+=("display server (no \$DISPLAY or \$WAYLAND_DISPLAY)")
fi

# Check required CLI tools
for tool in xdotool maim wmctrl; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING+=("$tool")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  printf '{"missing": %s, "message": "Missing dependencies"}' \
    "$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s .)"
  exit 1
fi

exit 0
```

### scripts/setup.sh

Install missing dependencies (idempotent). Runs npm install for the MCP server and installs system packages if needed.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Install npm dependencies
npm install

# Check system deps (Ubuntu/Debian)
MISSING=()
for tool in xdotool maim wmctrl; do
  command -v "$tool" &>/dev/null || MISSING+=("$tool")
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Installing: ${MISSING[*]}"
  sudo apt-get install -y "${MISSING[@]}"
fi
```

## File Structure

```
.my_agent/capabilities/desktop-x11/
  CAPABILITY.md           # Frontmatter + description
  config.yaml             # Non-secret settings (rate limit, display index)
  package.json            # Node.js dependencies (@modelcontextprotocol/sdk, zod)
  src/
    server.ts             # MCP server entry point — tool definitions
    x11-backend.ts        # Platform-specific implementation (xdotool, maim, wmctrl)
    types.ts              # Shared types
    scaling.ts            # Coordinate scaling logic
  scripts/
    detect.sh             # Environment detection
    setup.sh              # Dependency installation
```

## config.yaml

```yaml
rate_limit: 30          # Actions per minute (framework middleware enforces this)
display: ':0'           # X11 display (usually :0)
screenshot_quality: 80  # PNG compression level
```

## package.json

```json
{
  "name": "desktop-x11",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  }
}
```

## Coordinate Scaling

The capability handles coordinate scaling internally. The brain works in the screenshot's coordinate space. If the display uses HiDPI scaling, the capability maps coordinates before passing to system tools. The framework does not handle scaling.

## Server Entry Point Pattern

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'desktop-x11', version: '1.0.0' })

// Define tools here (see Required Tools and Optional Tools above)

const transport = new StdioServerTransport()
await server.connect(transport)
```

The server MUST NOT import from `@my-agent/core` or any framework package. It is a standalone process that communicates only via MCP protocol.

## Test Contract

The test harness validates this capability in 3 stages:

1. **Environment check** — `scripts/detect.sh` exits 0
2. **Schema validation** — all 7 required tools present with correct input schemas (validated against `packages/core/src/capabilities/tool-contracts.ts`)
3. **Functional test** — `desktop_screenshot` returns valid PNG (header bytes `\x89PNG`, minimum 1KB for real screenshots)

A capability is not done until the harness passes all 3 stages.

## Security

- Never log screenshots to disk (the framework handles storage via VAS)
- Sanitize key combos — reject dangerous sequences if appropriate
- The rate limiter is framework-enforced (PreToolUse hook), not capability-enforced
- The audit logger is framework-enforced (PostToolUse hook), not capability-enforced

## Known Platforms

| Platform | System Tools | Status |
|----------|-------------|--------|
| X11 (Linux) | xdotool, maim, wmctrl | Reference implementation |
| Wayland (Linux) | ydotool, grim, wlr-randr | Future |
| macOS | cliclick, screencapture, osascript | Future |

Each platform is a separate capability folder (e.g., `desktop-wayland`, `desktop-macos`). The framework discovers whichever is installed. Only one `desktop-control` provider should be active at a time.
```

- [ ] **Step 2: Verify template consistency with tool-contracts.ts**

Read `packages/core/src/capabilities/tool-contracts.ts` and verify that the 7 required tools and 5 optional tools listed in the template match the contract exactly (names and required parameters).

- [ ] **Step 3: Update _bundles.md if needed**

Check `skills/capability-templates/_bundles.md` — desktop-control is not a composite bundle, so no changes needed.

- [ ] **Step 4: Commit**

```bash
git add skills/capability-templates/desktop-control.md
git commit -m "feat(m9.5-s4): write desktop-control capability template

Three-tier tool contract (7 required, 5 optional, custom ignored).
MCP server entry point pattern, file structure, scripts, config.yaml,
coordinate scaling, security notes, and platform matrix.
Aligned with tool-contracts.ts for harness validation."
```

---

### Task 6: Build cleanup/reset script

**Files:**
- Create: `scripts/reset-capability.sh`

Deletes a capability folder for rebuild testing. Used in the build-from-scratch loop.

- [ ] **Step 1: Write the script**

Create `scripts/reset-capability.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: reset-capability.sh <capability-folder-name>
# Deletes the capability from .my_agent/capabilities/ for rebuild testing.

if [ $# -lt 1 ]; then
  echo "Usage: $0 <capability-name>"
  echo "Example: $0 desktop-x11"
  exit 1
fi

CAP_NAME="$1"
CAP_DIR=".my_agent/capabilities/${CAP_NAME}"

if [ ! -d "$CAP_DIR" ]; then
  echo "Capability folder not found: $CAP_DIR"
  exit 1
fi

echo "Removing capability: $CAP_DIR"
rm -rf "$CAP_DIR"
echo "Done. Capability '$CAP_NAME' removed."
echo "To rebuild, ask the agent: 'I want desktop control'"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/reset-capability.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/reset-capability.sh
git commit -m "feat(m9.5-s4): add capability reset script for rebuild testing

scripts/reset-capability.sh removes a capability folder from
.my_agent/capabilities/ so the agent can rebuild from template."
```

---

### Task 6.5: Update brainstorming skill with MCP guidance

**Files:**
- Modify: `packages/core/skills/capability-brainstorming/SKILL.md`
- Modify: `packages/core/skills/capability-brainstorming/references/capability-template.md`
- Modify: `packages/core/skills/capability-brainstorming/references/well-known-types.md`

The brainstorming skill currently only knows about `script` interface capabilities. Before the build-from-scratch loop can work, the skill needs MCP awareness so it can guide the builder agent correctly.

- [ ] **Step 1: Add MCP interface section to SKILL.md**

After the "Check existing capabilities" step, add guidance for MCP capabilities:
- When the requested well-known type is `desktop-control`, use `interface: mcp` (not `script`)
- Reference `skills/capability-templates/desktop-control.md` for the full MCP contract
- Builder instructions for MCP: write package.json, standalone MCP server (no framework imports), entrypoint in CAPABILITY.md frontmatter

- [ ] **Step 2: Update capability-template.md reference**

Add an MCP CAPABILITY.md template alongside the existing script template:

```yaml
---
name: <Human-readable name>
provides: <well-known type>
interface: mcp
entrypoint: npx tsx src/server.ts
requires:
  env: []
  system:
    - <required-cli-tool>
---
```

- [ ] **Step 3: Update well-known-types.md**

Add `desktop-control` to the well-known types table:

| Type | What It Does | Dashboard Reaction | Channel Reaction |
|------|-------------|-------------------|-----------------|
| desktop-control | Screen interaction via MCP tools | Settings toggle, rate limiting | N/A — brain-only |

- [ ] **Step 4: Commit**

```bash
git add packages/core/skills/capability-brainstorming/
git commit -m "feat(m9.5-s4): add MCP guidance to capability brainstorming skill

Brainstorming skill now knows about interface: mcp capabilities.
Adds desktop-control to well-known types, MCP CAPABILITY.md template,
and builder guidance for standalone MCP servers."
```

---

### Task 7: Build-from-scratch loop — agent builds capability from template

**Files:**
- No new files — this task uses the reset script, brainstorming skill, and test harness

This is the core S4 verification: prove an agent can build the desktop-control capability from scratch using only the template. This is inherently iterative — the plan describes the loop structure, not a fixed recipe.

**Pre-requisite:** Back up the current working capability before starting.

- [ ] **Step 1: Backup the current capability**

```bash
cp -r .my_agent/capabilities/desktop-x11 /tmp/desktop-x11-backup
```

- [ ] **Step 2: Delete the capability**

```bash
bash scripts/reset-capability.sh desktop-x11
```

- [ ] **Step 3: Verify scanner reports no desktop-control**

Confirm the capability is gone from the registry.

- [ ] **Step 4: Start a brain session and request desktop control**

Open the dashboard (or use headless App) and send the message: "I want desktop control"

This triggers the brainstorming skill flow:
1. Skill checks templates → finds `desktop-control.md`
2. Asks 1-2 questions (platform, constraints)
3. Spawns builder agent with the template reference
4. Builder creates the capability folder, installs deps, writes server

Wait for the builder to complete.

- [ ] **Step 5: Run test harness against the agent-built capability**

```bash
cd packages/core && npx vitest run tests/capabilities/ --reporter=verbose
```

The harness validates all 3 stages:
1. Environment check (detect.sh exits 0)
2. Schema validation (7 required tools present with correct schemas)
3. Functional screenshot (desktop_screenshot returns valid PNG)

- [ ] **Step 6: If harness fails — iterate**

Examine what went wrong:
- Missing tool? → Template needs clearer instructions
- Wrong schema? → Template's tool spec is ambiguous
- Server won't start? → Template's entrypoint/package.json guidance is insufficient
- detect.sh fails? → Template's script examples need adjustment

Fix the template (Task 5), delete the capability again, repeat from Step 2. The goal is **single-shot reliable build** — the agent should produce a passing capability on the first try.

- [ ] **Step 7: If harness passes — verify real screenshot**

Call `desktop_screenshot` against the agent-built capability. Confirm it returns a real PNG of the current display (not a mock).

- [ ] **Step 8: Log results in DECISIONS.md**

Create `docs/sprints/m9.5-s4-template-verification/DECISIONS.md` documenting:
- Number of iterations needed
- What failed on each iteration (if any)
- Template adjustments made
- Final harness result

- [ ] **Step 9: Commit**

If the template was adjusted, commit the updated template. Commit DECISIONS.md.

---

### Task 8: Acceptance test — conversation with Nina reads Kwrite

**Files:**
- No new files — this is an agent-driven test through the dashboard

The acceptance test is agent-level, not framework-level: Nina uses the desktop tools herself to read text from a Kwrite document. The developer observes — they don't call MCP tools directly.

- [ ] **Step 1: Ensure Kwrite is open with text content**

Kwrite should already be open. If not, open it with some test content.

- [ ] **Step 2: Open dashboard chat and ask Nina**

Navigate to the dashboard at the Tailscale address. In the chat, type:

> What text is in the open Kwrite document?

- [ ] **Step 3: Observe Nina's tool usage**

Nina should:
1. Use `desktop_screenshot` to capture the screen
2. See the Kwrite window in the screenshot
3. Read the text content
4. Respond with what she sees

- [ ] **Step 4: Evaluate pass/fail**

**Pass criteria:**
- Nina used the desktop tools (not just guessing)
- She correctly identified the Kwrite text content
- The response was natural and accurate

**Fail criteria:**
- Nina couldn't find or use the desktop tools
- She misread the content
- Desktop capability wasn't available in the session

- [ ] **Step 5: Log acceptance test result**

Add to `docs/sprints/m9.5-s4-template-verification/DECISIONS.md`:
- Tools Nina used
- Text she reported vs actual text
- Pass/fail verdict
- Any issues observed

---

### Task 8.5: User feedback — Nina reflects on tool UX

**Files:**
- Modify: `docs/sprints/m9.5-s4-template-verification/DECISIONS.md`
- Possibly modify: `skills/capability-templates/desktop-control.md` (if feedback is actionable)

After the acceptance test, ask Nina to reflect on the desktop control tools. This feedback informs template refinement and future platform implementations.

- [ ] **Step 1: Ask Nina for feedback**

In the dashboard chat, ask Nina to reflect on:
- Which tools did you use? Which were most helpful?
- Were any tools confusing or unnecessary?
- What was missing that would have helped?
- Was coordinate interpretation intuitive?
- Would optional tools (OCR, find_element, diff_check) have helped?

- [ ] **Step 2: Log feedback**

Add Nina's responses to DECISIONS.md under a "User Feedback" section.

- [ ] **Step 3: Adjust template if needed**

If Nina's feedback reveals actionable improvements (e.g., "I wished I could search for UI elements by name"), update the template to emphasize those optional tools or adjust required tool descriptions.

- [ ] **Step 4: Commit if template changed**

```bash
git add skills/capability-templates/desktop-control.md docs/sprints/m9.5-s4-template-verification/DECISIONS.md
git commit -m "docs(m9.5-s4): user feedback on desktop tools, template adjusted"
```

---

### Task 9: Sprint artifacts and verification

**Files:**
- Modify: `docs/ROADMAP.md` (update S4 status)
- Create: `docs/sprints/m9.5-s4-template-verification/DEVIATIONS.md` (if any deviations occurred)

- [ ] **Step 1: Run full test suite**

Run: `cd packages/core && npx vitest run --reporter=verbose`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Verify TypeScript compiles for both packages**

Run: `cd packages/core && npx tsc --noEmit && cd ../dashboard && npx tsc --noEmit`
Expected: Clean compilation for both.

- [ ] **Step 3: Create DEVIATIONS.md**

Create `docs/sprints/m9.5-s4-template-verification/DEVIATIONS.md` — empty if no deviations, or document any spec deviations that occurred.

- [ ] **Step 4: Update roadmap**

In `docs/ROADMAP.md`, update the S4 row status from "Planned" to "Done" and add links to plan and review artifacts.

- [ ] **Step 5: Commit artifacts**

```bash
git add docs/sprints/m9.5-s4-template-verification/ docs/ROADMAP.md
git commit -m "docs(m9.5-s4): sprint artifacts and roadmap update"
```

---

### Task 10: Dispatch external reviewer

This task is handled by the tech lead after all implementation is complete. Follow `docs/procedures/external-reviewer.md` to dispatch the reviewer agent with the full input package.

- [ ] **Step 1: Gather input package**

- Design spec: `docs/design/capability-framework-v2.md`
- Sprint plan: `docs/sprints/m9.5-s4-template-verification/plan.md`
- Git diff: `git diff master...HEAD`
- Test results from Task 9
- File list: `git diff master...HEAD --name-only`

- [ ] **Step 2: Dispatch external reviewer agent**

Spawn an Opus reviewer agent with the input package. The reviewer writes `review.md` and `test-report.md` in the sprint directory.

- [ ] **Step 3: Notify CTO**

"Sprint complete. Run `/trip-review` when ready."
