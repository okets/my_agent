/**
 * Capability test harness — validates capabilities against template test contracts.
 *
 * Each well-known type has a template in skills/capability-templates/ that defines
 * a test contract. This module runs those contracts against installed capabilities.
 */

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Capability, CapabilityTestResult } from './types.js'
import { validateToolContract } from './tool-contracts.js'

const execFileAsync = promisify(execFile)

/** Maximum time to wait for a capability script to complete (30 seconds) */
const TEST_TIMEOUT_MS = 30_000

/**
 * Test a single capability by running its script with test input
 * and validating the output against the template's test contract.
 */
export async function testCapability(
  capability: Capability,
  projectRoot: string,
): Promise<CapabilityTestResult> {
  if (capability.status !== 'available') {
    return { status: 'error', latencyMs: 0, message: `Capability is ${capability.status}` }
  }

  // MCP interface: use generic MCP test path
  if (capability.interface === 'mcp') {
    try {
      return await testMcpCapability(capability)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', latencyMs: 0, message }
    }
  }

  // Script interface: dispatch to well-known type test contracts
  const type = capability.provides
  if (!type) {
    return { status: 'error', latencyMs: 0, message: 'No well-known type — cannot test' }
  }

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

/**
 * Test an MCP capability by spawning its server, connecting a client,
 * and verifying that at least one tool is registered.
 */
async function testMcpCapability(capability: Capability): Promise<CapabilityTestResult> {
  if (!capability.entrypoint) {
    return { status: 'error', latencyMs: 0, message: 'MCP capability missing entrypoint' }
  }

  // Run detect.sh if present (environment pre-check)
  const detectScript = join(capability.path, 'scripts', 'detect.sh')
  if (existsSync(detectScript)) {
    try {
      await execFileAsync('bash', [detectScript], {
        timeout: 10_000,
        cwd: capability.path,
      })
    } catch {
      return { status: 'error', latencyMs: 0, message: 'environment check failed (detect.sh)' }
    }
  }

  const parts = capability.entrypoint.split(/\s+/)
  const command = parts[0]
  const args = parts.slice(1)

  const transport = new StdioClientTransport({
    command,
    args,
    cwd: capability.path,
    env: { ...process.env } as Record<string, string>,
  })

  const client = new Client({ name: 'capability-test', version: '1.0.0' })
  const start = performance.now()

  try {
    await client.connect(transport)

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

    // Functional screenshot test for desktop-control
    if (capability.provides === 'desktop-control') {
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
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', latencyMs, message }
  } finally {
    try {
      await client.close()
    } catch {
      // ignore cleanup errors
    }
  }
}

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

    const contents = result.content as Array<{ type: string; data?: string; mimeType?: string }>
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

    return { status: 'ok', latencyMs }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', latencyMs, message }
  } finally {
    try { await client.close() } catch { /* ignore */ }
  }
}

/** Map of well-known types to their test functions */
const TEST_CONTRACTS: Record<
  string,
  (cap: Capability, projectRoot: string) => Promise<CapabilityTestResult>
> = {
  'audio-to-text': testAudioToText,
  'text-to-audio': testTextToAudio,
  'text-to-image': testTextToImage,
}

/**
 * Test audio-to-text: generate a test WAV fixture, run transcribe.sh, validate JSON output.
 */
async function testAudioToText(cap: Capability): Promise<CapabilityTestResult> {
  const scriptPath = join(cap.path, 'scripts', 'transcribe.sh')
  if (!existsSync(scriptPath)) {
    return { status: 'error', latencyMs: 0, message: 'scripts/transcribe.sh not found' }
  }

  // Generate a test audio fixture if it doesn't exist
  const fixturePath = '/tmp/capability-test-audio.wav'
  if (!existsSync(fixturePath)) {
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=2',
          '-ar',
          '16000',
          '-ac',
          '1',
          fixturePath,
        ],
        { timeout: 10_000 },
      )
    } catch {
      return {
        status: 'error',
        latencyMs: 0,
        message: 'Failed to generate test audio fixture (is ffmpeg installed?)',
      }
    }
  }

  const start = performance.now()
  try {
    const { stdout, stderr } = await execFileAsync('bash', [scriptPath, fixturePath], {
      timeout: TEST_TIMEOUT_MS,
      env: { ...process.env },
    })
    const latencyMs = Math.round(performance.now() - start)

    return validateJsonOutput(stdout, stderr, 'text', latencyMs)
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    return execError(err, latencyMs)
  }
}

/**
 * Test text-to-audio: run synthesize.sh with test text, validate output file.
 */
async function testTextToAudio(cap: Capability): Promise<CapabilityTestResult> {
  const scriptPath = join(cap.path, 'scripts', 'synthesize.sh')
  if (!existsSync(scriptPath)) {
    return { status: 'error', latencyMs: 0, message: 'scripts/synthesize.sh not found' }
  }

  const outputPath = '/tmp/capability-test-output.ogg'

  const start = performance.now()
  try {
    const { stdout, stderr } = await execFileAsync(
      'bash',
      [scriptPath, 'Hello, this is a test.', outputPath],
      { timeout: TEST_TIMEOUT_MS, env: { ...process.env } },
    )
    const latencyMs = Math.round(performance.now() - start)

    const jsonResult = validateJsonOutput(stdout, stderr, 'path', latencyMs)
    if (jsonResult.status === 'error') return jsonResult

    // Validate the output file exists and is non-trivial
    return validateOutputFile(outputPath, 100, latencyMs)
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    return execError(err, latencyMs)
  }
}

/**
 * Test text-to-image: run generate.sh with test prompt, validate output file.
 */
async function testTextToImage(cap: Capability): Promise<CapabilityTestResult> {
  const scriptPath = join(cap.path, 'scripts', 'generate.sh')
  if (!existsSync(scriptPath)) {
    return { status: 'error', latencyMs: 0, message: 'scripts/generate.sh not found' }
  }

  const outputPath = '/tmp/capability-test-output.png'

  const start = performance.now()
  try {
    const { stdout, stderr } = await execFileAsync(
      'bash',
      [scriptPath, 'A simple red circle on a white background', outputPath],
      { timeout: TEST_TIMEOUT_MS, env: { ...process.env } },
    )
    const latencyMs = Math.round(performance.now() - start)

    const jsonResult = validateJsonOutput(stdout, stderr, 'path', latencyMs)
    if (jsonResult.status === 'error') return jsonResult

    // Validate the output file exists and is non-trivial
    return validateOutputFile(outputPath, 1000, latencyMs)
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    return execError(err, latencyMs)
  }
}

/** Validate that stdout is valid JSON with the expected field */
function validateJsonOutput(
  stdout: string,
  stderr: string,
  requiredField: string,
  latencyMs: number,
): CapabilityTestResult {
  const trimmed = stdout.trim()
  if (!trimmed) {
    const errMsg = stderr.trim()
    return { status: 'error', latencyMs, message: errMsg || 'No output on stdout' }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { status: 'error', latencyMs, message: `Invalid JSON: ${trimmed.slice(0, 200)}` }
  }

  if (!(requiredField in parsed)) {
    return { status: 'error', latencyMs, message: `Missing "${requiredField}" field in output` }
  }

  return { status: 'ok', latencyMs }
}

/** Validate that an output file exists and meets minimum size */
function validateOutputFile(
  filePath: string,
  minBytes: number,
  latencyMs: number,
): CapabilityTestResult {
  if (!existsSync(filePath)) {
    return { status: 'error', latencyMs, message: `Output file not found: ${filePath}` }
  }

  const stat = statSync(filePath)
  if (stat.size < minBytes) {
    return {
      status: 'error',
      latencyMs,
      message: `Output file too small: ${stat.size} bytes (expected >= ${minBytes})`,
    }
  }

  return { status: 'ok', latencyMs }
}

/** Convert exec errors to test results */
function execError(err: unknown, latencyMs: number): CapabilityTestResult {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = String((err as { stderr: unknown }).stderr).trim()
    if (stderr) return { status: 'error', latencyMs, message: stderr }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { status: 'error', latencyMs, message }
}
