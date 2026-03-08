/**
 * .env file read/write utility
 *
 * Simple KEY=VALUE format, no quoting. Files are chmod 600.
 * This is the foundation for the auth system where .env is
 * the single source of truth for secrets.
 */

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'

/** Keys that are configuration, not secrets */
const CONFIG_KEYS = new Set(['PORT', 'HOST', 'NODE_ENV'])

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const eqIndex = trimmed.indexOf('=')
  if (eqIndex === -1) return null
  const key = trimmed.slice(0, eqIndex)
  const value = trimmed.slice(eqIndex + 1)
  return { key, value }
}

function readLines(envPath: string): string[] {
  if (!existsSync(envPath)) return []
  return readFileSync(envPath, 'utf-8').split('\n')
}

function writeEnv(envPath: string, content: string): void {
  writeFileSync(envPath, content, 'utf-8')
  chmodSync(envPath, 0o600)
}

/** Read a value from a .env file. Returns null if key or file not found. */
export function getEnvValue(envPath: string, key: string): string | null {
  const lines = readLines(envPath)
  for (const line of lines) {
    const parsed = parseLine(line)
    if (parsed && parsed.key === key) return parsed.value
  }
  return null
}

/** Set or update a key in a .env file. Creates the file if missing. chmod 600. */
export function setEnvValue(envPath: string, key: string, value: string): void {
  const lines = readLines(envPath)
  let found = false
  const updated = lines.map((line) => {
    const parsed = parseLine(line)
    if (parsed && parsed.key === key) {
      found = true
      return `${key}=${value}`
    }
    return line
  })

  if (!found) {
    // If the file had a trailing newline, lines ends with ''. Insert before it.
    if (updated.length > 0 && updated[updated.length - 1] === '') {
      updated.splice(updated.length - 1, 0, `${key}=${value}`)
    } else {
      updated.push(`${key}=${value}`)
    }
  }

  // Ensure trailing newline
  const content = updated.join('\n')
  writeEnv(envPath, content.endsWith('\n') ? content : content + '\n')
}

/** Remove a key from a .env file. No-op if file or key not found. */
export function removeEnvValue(envPath: string, key: string): void {
  if (!existsSync(envPath)) return
  const lines = readLines(envPath)
  const filtered = lines.filter((line) => {
    const parsed = parseLine(line)
    return !parsed || parsed.key !== key
  })
  writeEnv(envPath, filtered.join('\n'))
}

/** Return all secret values (excludes config keys like PORT, HOST, NODE_ENV). */
export function getAllSecrets(envPath: string): string[] {
  if (!existsSync(envPath)) return []
  const lines = readLines(envPath)
  const secrets: string[] = []
  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue
    if (CONFIG_KEYS.has(parsed.key)) continue
    if (!parsed.value) continue
    secrets.push(parsed.value)
  }
  return secrets
}
