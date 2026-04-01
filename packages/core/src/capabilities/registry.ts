import { readFileSync, existsSync } from 'node:fs'
import * as path from 'node:path'
import { parseFrontmatterContent } from '../metadata/frontmatter.js'
import type { Capability } from './types.js'

export class CapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map()

  /** Initialize with scan results */
  load(capabilities: Capability[]): void {
    this.capabilities.clear()
    for (const cap of capabilities) {
      this.capabilities.set(cap.name, cap)
    }
  }

  /** Query by well-known type ('audio-to-text', 'text-to-audio', etc.) */
  has(type: string): boolean {
    return this.get(type) !== undefined
  }

  /**
   * Get capability by well-known `provides` type.
   * Returns the first available match, falling back to the first unavailable one.
   */
  get(type: string): Capability | undefined {
    let fallback: Capability | undefined
    for (const cap of this.capabilities.values()) {
      if (cap.provides !== type) continue
      if (cap.status === 'available') return cap
      if (!fallback) fallback = cap
    }
    return fallback
  }

  /** All capabilities */
  list(): Capability[] {
    return Array.from(this.capabilities.values())
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
}
