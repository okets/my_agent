/**
 * Model discovery — derive the current Claude model list from the installed
 * @anthropic-ai/sdk package types (not from /v1/models).
 *
 * Why: the Anthropic /v1/models endpoint needs an API key. Max-subscription
 * OAuth users don't have one. But @anthropic-ai/sdk's TypeScript types ship
 * an authoritative `Model` union that Anthropic updates on every release.
 * Reading that union at runtime gives us fresh model IDs for free, as long
 * as the SDK dependency is kept current (e.g. via Dependabot).
 *
 * Fallback: if the SDK isn't resolvable (standalone CLI use, minimal install),
 * callers get null and should fall back to DEFAULT_MODELS.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ModelDefaults } from '../config.js'

interface DiscoveryResult {
  /** Picked "latest" undated alias per family */
  defaults: ModelDefaults
  /** All model IDs found in the union, sorted */
  all: string[]
  /** Path of the .d.ts the result was parsed from */
  source: string
}

let cached: DiscoveryResult | null | undefined = undefined

/**
 * Find the SDK's messages.d.ts by trying likely node_modules locations.
 * Returns null if not found.
 */
function locateSdkTypes(): string | null {
  const cwd = process.cwd()
  const candidates: string[] = []

  // 1) Workspace locations relative to cwd (dashboard usage)
  candidates.push(
    resolve(cwd, 'node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts'),
    resolve(cwd, '../dashboard/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts'),
    resolve(cwd, '../../packages/dashboard/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts'),
    resolve(cwd, 'packages/dashboard/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts'),
  )

  // 2) Walk up to 5 parents looking for either workspace root or hoisted install
  let dir = cwd
  for (let i = 0; i < 5; i++) {
    candidates.push(
      resolve(dir, 'node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts'),
      resolve(dir, 'packages/dashboard/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts'),
    )
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Parse the `export type Model = ...` union literal from the SDK's .d.ts
 * source. Returns the list of `claude-*` string literals in declaration order.
 */
function parseModelUnion(source: string): string[] {
  const match = source.match(/export type Model\s*=\s*([^;]+);/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith('claude-'))
}

/**
 * Pick the highest undated alias from a list of IDs for a given family.
 * Ignores dated IDs (end with -YYYYMMDD) and `-latest` / `-preview` aliases.
 * Uses numeric-aware locale compare so `4-6` beats `4-5`, `4-10` beats `4-9`.
 */
function pickLatestUndated(ids: string[]): string | null {
  const undated = ids.filter(
    (id) =>
      !/-\d{8}$/.test(id) &&
      !id.endsWith('-latest') &&
      !id.endsWith('-preview'),
  )
  if (undated.length === 0) return null
  return [...undated].sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )[0]
}

/**
 * Discover the latest model IDs per family from the installed SDK types.
 * Returns null if the SDK isn't installed or the union can't be parsed.
 * Result is cached for the life of the process.
 */
export function discoverLatestModels(): DiscoveryResult | null {
  if (cached !== undefined) return cached

  const sourcePath = locateSdkTypes()
  if (!sourcePath) {
    cached = null
    return null
  }

  let ids: string[]
  try {
    const source = readFileSync(sourcePath, 'utf-8')
    ids = parseModelUnion(source)
  } catch {
    cached = null
    return null
  }

  if (ids.length === 0) {
    cached = null
    return null
  }

  const byFamily = {
    opus: ids.filter((id) => id.includes('opus')),
    sonnet: ids.filter((id) => id.includes('sonnet')),
    haiku: ids.filter((id) => id.includes('haiku')),
  }

  const opus = pickLatestUndated(byFamily.opus)
  const sonnet = pickLatestUndated(byFamily.sonnet)
  const haiku = pickLatestUndated(byFamily.haiku)

  if (!opus || !sonnet || !haiku) {
    cached = null
    return null
  }

  cached = {
    defaults: { opus, sonnet, haiku },
    all: [...ids].sort(),
    source: sourcePath,
  }
  return cached
}

/**
 * Clear the discovery cache. Useful in tests.
 */
export function _resetDiscoveryCache(): void {
  cached = undefined
}
