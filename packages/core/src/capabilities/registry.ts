import { readFileSync, existsSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'
import { parseFrontmatterContent } from '../metadata/frontmatter.js'
import { testCapability } from './test-harness.js'
import type { Capability, CapabilityTestResult } from './types.js'

export interface CapabilityHealthReport {
  type: string
  name: string
  enabled: boolean
  status: Capability['status']
  health: Capability['health']
  issue?: string
}

export class CapabilityRegistry extends EventEmitter {
  private capabilities: Map<string, Capability> = new Map()
  private projectRoot: string = ''

  constructor() {
    super()
  }

  /** Set the project root for template lookups during testing */
  setProjectRoot(root: string): void {
    this.projectRoot = root
  }

  /** Initialize with scan results (skips invalid capabilities) */
  load(capabilities: Capability[]): void {
    this.capabilities.clear()
    for (const cap of capabilities) {
      if (cap.status === 'invalid') continue
      this.capabilities.set(cap.name, cap)
    }
  }

  /**
   * Query by well-known type ('audio-to-text', 'text-to-audio', etc.).
   *
   * FIRST-MATCH ONLY. Do not call for multi-instance types like
   * `browser-control` — use `listByProvides(type)` instead.
   */
  has(type: string): boolean {
    return this.get(type) !== undefined
  }

  /**
   * Get capability by well-known `provides` type.
   * Returns the capability only when status is 'available' AND enabled is true.
   *
   * FIRST-MATCH ONLY. Do not call for multi-instance types like
   * `browser-control` — use `listByProvides(type)` and filter instead.
   */
  get(type: string): Capability | undefined {
    for (const cap of this.capabilities.values()) {
      if (cap.provides !== type) continue
      if (cap.status === 'available' && cap.enabled) return cap
    }
    return undefined
  }

  /**
   * Check if a capability type is explicitly enabled.
   * Returns false if the type doesn't exist in the registry.
   *
   * FIRST-MATCH ONLY. Do not call for multi-instance types like
   * `browser-control` — use `listByProvides(type)` and inspect each.
   */
  isEnabled(type: string): boolean {
    for (const cap of this.capabilities.values()) {
      if (cap.provides === type) return cap.enabled
    }
    return false
  }

  /**
   * Toggle a capability's enabled state by well-known `provides` type.
   * Writes or removes the .enabled file in the capability folder.
   * Emits 'capability:changed' event for downstream listeners.
   * Returns the new enabled state, or undefined if the type is not found.
   *
   * FIRST-MATCH ONLY. Do not call for multi-instance types like
   * `browser-control` — use `toggleByName(name)` instead. Preserved for
   * backwards compatibility with existing singleton call-sites.
   */
  toggle(type: string): boolean | undefined {
    let target: Capability | undefined
    for (const cap of this.capabilities.values()) {
      if (cap.provides === type) { target = cap; break }
    }
    if (!target) return undefined
    return this.applyToggle(target, { type })
  }

  /**
   * List every capability whose `provides` matches `type`, regardless of
   * enabled status or health. This is the correct method for multi-instance
   * types (e.g. `browser-control`): the caller decides which instances to
   * use based on `enabled`, `status`, etc.
   */
  listByProvides(type: string): Capability[] {
    const out: Capability[] = []
    for (const cap of this.capabilities.values()) {
      if (cap.provides === type) out.push(cap)
    }
    return out
  }

  /**
   * Toggle a capability's enabled state by its unique `name`.
   * This is the canonical toggle method for multi-instance capabilities.
   *
   * Returns the new enabled state, or undefined if no capability with that
   * name exists. Emits `capability:changed` with the capability's `provides`
   * (if any) and its name.
   */
  toggleByName(name: string): boolean | undefined {
    const target = this.capabilities.get(name)
    if (!target) return undefined
    return this.applyToggle(target, { type: target.provides })
  }

  private applyToggle(target: Capability, meta: { type?: string }): boolean {
    const enabledPath = path.join(target.path, '.enabled')
    if (target.enabled) {
      try { unlinkSync(enabledPath) } catch { /* already gone */ }
      target.enabled = false
    } else {
      writeFileSync(enabledPath, new Date().toISOString())
      target.enabled = true
    }
    this.emit('capability:changed', {
      type: meta.type,
      enabled: target.enabled,
      name: target.name,
    })
    return target.enabled
  }

  /**
   * Delete a capability by its unique `name`.
   *
   * Only allowed for capabilities with `canDelete: true` (populated by the
   * scanner based on the `WELL_KNOWN_MULTI_INSTANCE` allowlist). Attempting
   * to delete a singleton capability throws.
   *
   * Removes the capability folder from disk, drops it from the in-memory
   * registry, and emits `capability:changed` so downstream listeners can
   * unregister MCP servers etc. If `opts.wipeProfile` is true and a sibling
   * profile folder exists at
   * `<myAgentRoot>/browser-profiles/<name>/`, it is also removed.
   *
   * Returns true if a capability was removed, false if the name was unknown.
   * Throws when `canDelete` is false — callers should check that field and
   * return 403 at the API layer rather than calling this and catching.
   *
   * NOTE: Stopping a currently-spawned MCP child process is the caller's
   * responsibility. The registry has no handle on spawned children; the
   * dashboard/session manager listens for `capability:changed` and tears
   * down the MCP client for the affected capability.
   */
  delete(name: string, opts: { wipeProfile?: boolean } = {}): boolean {
    const target = this.capabilities.get(name)
    if (!target) return false
    if (!target.canDelete) {
      throw new Error(
        `Capability "${name}" (provides: ${target.provides ?? 'custom'}) is not deletable. ` +
          `Only instances of well-known multi-instance types can be deleted from the registry.`,
      )
    }

    const capPath = target.path
    // .my_agent/capabilities/<name>  →  up two to .my_agent
    const myAgentRoot = path.resolve(capPath, '..', '..')
    const profilePath = path.join(myAgentRoot, 'browser-profiles', target.name)

    try { rmSync(capPath, { recursive: true, force: true }) } catch { /* swallow — log upstream */ }

    if (opts.wipeProfile) {
      try { rmSync(profilePath, { recursive: true, force: true }) } catch { /* swallow */ }
    }

    this.capabilities.delete(name)
    this.emit('capability:changed', {
      type: target.provides,
      enabled: false,
      name: target.name,
      deleted: true,
      wipedProfile: opts.wipeProfile === true,
    })
    return true
  }

  /** All capabilities */
  list(): Capability[] {
    return Array.from(this.capabilities.values())
  }

  /**
   * Returns a health report for all capabilities, flagging unhealthy entries.
   * Consumed proactively on boot by App (logs at WARN).
   *
   * A capability is considered unhealthy when:
   *   - enabled && status === 'unavailable' (enabled but broken)
   *   - status === 'available' && health === 'degraded' (available but failing tests)
   */
  getHealth(): CapabilityHealthReport[] {
    const report: CapabilityHealthReport[] = []
    for (const cap of this.capabilities.values()) {
      let issue: string | undefined
      if (cap.enabled && cap.status === 'unavailable') {
        issue = `enabled but unavailable: ${cap.unavailableReason ?? 'unknown'}`
      } else if (cap.status === 'available' && cap.health === 'degraded') {
        issue = `degraded: ${cap.degradedReason ?? 'unknown'}`
      }
      report.push({
        type: cap.provides ?? 'custom',
        name: cap.name,
        enabled: cap.enabled,
        status: cap.status,
        health: cap.health,
        issue,
      })
    }
    return report
  }

  /**
   * Re-scan capabilities by delegating to an injected scanner function.
   * The scanner is injected to avoid circular dependencies.
   */
  async rescan(scanFn: () => Promise<Capability[]>): Promise<Capability[]> {
    const caps = await scanFn()
    this.load(caps)
    return caps
  }

  /**
   * On-demand content loading — reads CAPABILITY.md body (after frontmatter).
   * Returns null if the capability or file doesn't exist.
   */
  getContent(type: string): string | null {
    const cap = this.get(type)
    if (!cap) return null
    const filePath = path.join(cap.path, 'CAPABILITY.md')
    if (!existsSync(filePath)) return null
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const { body } = parseFrontmatterContent(raw)
      return body
    } catch {
      return null
    }
  }

  /**
   * Read a reference file from a capability's references/ subdirectory.
   * Returns content or null if not found.
   */
  getReference(type: string, filename: string): string | null {
    const cap = this.get(type)
    if (!cap) return null
    const filePath = path.join(cap.path, 'references', filename)
    if (!existsSync(filePath)) return null
    try {
      return readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }
  }

  /**
   * Test a capability against its template's test contract.
   * Updates the capability's health status based on the result.
   * Returns the test result.
   */
  async test(type: string): Promise<CapabilityTestResult> {
    const cap = this.get(type)
    if (!cap) {
      return { status: 'error', latencyMs: 0, message: `No capability found for type: ${type}` }
    }

    const result = await testCapability(cap, this.projectRoot)

    // Update health status in-place
    if (result.status === 'ok') {
      cap.health = 'healthy'
      cap.lastTestLatencyMs = result.latencyMs
      cap.degradedReason = undefined
    } else if (result.message?.includes('not found') || result.message?.includes('environment check failed')) {
      // Script not yet written or environment not suitable — keep untested, don't mark degraded
      cap.health = 'untested'
      cap.degradedReason = undefined
      cap.lastTestLatencyMs = undefined
    } else {
      cap.health = 'degraded'
      cap.degradedReason = result.message
      cap.lastTestLatencyMs = undefined
    }

    return result
  }

  /**
   * Test all available capabilities in the background.
   * Non-blocking — fires and forgets, updating health as results come in.
   */
  async testAll(): Promise<void> {
    const available = this.list().filter((c) => c.status === 'available' && c.provides)
    const types = new Set(available.map((c) => c.provides!))
    for (const type of types) {
      // Run sequentially to avoid overwhelming the system
      await this.test(type)
    }
  }
}
