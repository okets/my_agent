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

export class McpCapabilitySpawner extends EventEmitter {
  private handles: McpHandle[] = []

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

    const connectPromise = client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Server startup timeout (${STARTUP_TIMEOUT_MS}ms)`)), STARTUP_TIMEOUT_MS),
    )
    await Promise.race([connectPromise, timeoutPromise])

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
          this.handles = this.handles.filter(
            h => !(h.capabilityName === capability.name && h.sessionId === sessionId)
          )
        }
      })
    }

    const shutdown = async () => {
      this.handles = this.handles.filter(
        h => !(h.capabilityName === capability.name && h.sessionId === sessionId)
      )

      try { await client.close() } catch { /* best effort */ }

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

  async shutdown(capabilityName: string, sessionId: string): Promise<void> {
    const handle = this.handles.find(h => h.capabilityName === capabilityName && h.sessionId === sessionId)
    if (handle) await handle.shutdown()
  }

  async shutdownCapability(capabilityName: string): Promise<void> {
    const toShutdown = this.handles.filter(h => h.capabilityName === capabilityName)
    await Promise.all(toShutdown.map(h => h.shutdown()))
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(this.handles.map(h => h.shutdown()))
    this.handles = []
  }

  listActive(): McpHandle[] {
    return [...this.handles]
  }
}
