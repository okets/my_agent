/**
 * Unit Tests — .env read/write utility
 *
 * Tests the env utility functions:
 * - getEnvValue: read individual keys
 * - setEnvValue: set/update keys, file creation, chmod
 * - removeEnvValue: remove keys
 * - getAllSecrets: return all values except config keys
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { getEnvValue, setEnvValue, removeEnvValue, getAllSecrets } from '../src/env.js'

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'))
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// -------------------------------------------------------------------
// getEnvValue
// -------------------------------------------------------------------

describe('getEnvValue', () => {
  let tempDir: string
  let envPath: string

  beforeEach(() => {
    tempDir = createTempDir()
    envPath = path.join(tempDir, '.env')
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('returns null when file does not exist', () => {
    expect(getEnvValue(envPath, 'FOO')).toBeNull()
  })

  it('reads an existing key', () => {
    fs.writeFileSync(envPath, 'FOO=bar\nBAZ=qux\n')
    expect(getEnvValue(envPath, 'FOO')).toBe('bar')
    expect(getEnvValue(envPath, 'BAZ')).toBe('qux')
  })

  it('returns null for a missing key', () => {
    fs.writeFileSync(envPath, 'FOO=bar\n')
    expect(getEnvValue(envPath, 'MISSING')).toBeNull()
  })

  it('skips comment lines', () => {
    fs.writeFileSync(envPath, '# FOO=secret\nBAR=visible\n')
    expect(getEnvValue(envPath, 'FOO')).toBeNull()
    expect(getEnvValue(envPath, 'BAR')).toBe('visible')
  })

  it('skips blank lines', () => {
    fs.writeFileSync(envPath, '\nFOO=bar\n\n')
    expect(getEnvValue(envPath, 'FOO')).toBe('bar')
  })

  it('handles values with equals signs', () => {
    fs.writeFileSync(envPath, 'CONNECTION=postgres://host:5432/db?opt=val\n')
    expect(getEnvValue(envPath, 'CONNECTION')).toBe('postgres://host:5432/db?opt=val')
  })

  it('handles empty values', () => {
    fs.writeFileSync(envPath, 'EMPTY=\n')
    expect(getEnvValue(envPath, 'EMPTY')).toBe('')
  })
})

// -------------------------------------------------------------------
// setEnvValue
// -------------------------------------------------------------------

describe('setEnvValue', () => {
  let tempDir: string
  let envPath: string

  beforeEach(() => {
    tempDir = createTempDir()
    envPath = path.join(tempDir, '.env')
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('creates file if missing', () => {
    setEnvValue(envPath, 'FOO', 'bar')
    expect(fs.existsSync(envPath)).toBe(true)
    expect(fs.readFileSync(envPath, 'utf-8')).toBe('FOO=bar\n')
  })

  it('sets chmod 600 on created file', () => {
    setEnvValue(envPath, 'FOO', 'bar')
    const stat = fs.statSync(envPath)
    // 0o600 = owner read/write only
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('adds a new key to existing file', () => {
    fs.writeFileSync(envPath, 'FOO=bar\n')
    setEnvValue(envPath, 'BAZ', 'qux')
    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toContain('FOO=bar')
    expect(content).toContain('BAZ=qux')
  })

  it('updates an existing key', () => {
    fs.writeFileSync(envPath, 'FOO=old\nBAR=keep\n')
    setEnvValue(envPath, 'FOO', 'new')
    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toContain('FOO=new')
    expect(content).toContain('BAR=keep')
    expect(content).not.toContain('FOO=old')
  })

  it('preserves comments and blank lines when updating', () => {
    fs.writeFileSync(envPath, '# Database config\nDB_HOST=localhost\n\nDB_PORT=5432\n')
    setEnvValue(envPath, 'DB_HOST', '127.0.0.1')
    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toContain('# Database config')
    expect(content).toContain('DB_HOST=127.0.0.1')
    expect(content).toContain('DB_PORT=5432')
  })

  it('sets chmod 600 on updated file', () => {
    fs.writeFileSync(envPath, 'FOO=bar\n', { mode: 0o644 })
    setEnvValue(envPath, 'FOO', 'baz')
    const stat = fs.statSync(envPath)
    expect(stat.mode & 0o777).toBe(0o600)
  })
})

// -------------------------------------------------------------------
// removeEnvValue
// -------------------------------------------------------------------

describe('removeEnvValue', () => {
  let tempDir: string
  let envPath: string

  beforeEach(() => {
    tempDir = createTempDir()
    envPath = path.join(tempDir, '.env')
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('does nothing when file does not exist', () => {
    // Should not throw
    removeEnvValue(envPath, 'FOO')
  })

  it('removes an existing key', () => {
    fs.writeFileSync(envPath, 'FOO=bar\nBAZ=qux\n')
    removeEnvValue(envPath, 'FOO')
    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).not.toContain('FOO')
    expect(content).toContain('BAZ=qux')
  })

  it('does nothing for a missing key', () => {
    fs.writeFileSync(envPath, 'FOO=bar\n')
    removeEnvValue(envPath, 'MISSING')
    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toContain('FOO=bar')
  })

  it('preserves comments and blank lines', () => {
    fs.writeFileSync(envPath, '# Config\nFOO=bar\n\nBAZ=qux\n')
    removeEnvValue(envPath, 'FOO')
    const content = fs.readFileSync(envPath, 'utf-8')
    expect(content).toContain('# Config')
    expect(content).toContain('BAZ=qux')
  })
})

// -------------------------------------------------------------------
// getAllSecrets
// -------------------------------------------------------------------

describe('getAllSecrets', () => {
  let tempDir: string
  let envPath: string

  beforeEach(() => {
    tempDir = createTempDir()
    envPath = path.join(tempDir, '.env')
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('returns empty array when file does not exist', () => {
    expect(getAllSecrets(envPath)).toEqual([])
  })

  it('returns all values', () => {
    fs.writeFileSync(envPath, 'API_KEY=secret123\nDB_PASS=hunter2\n')
    const secrets = getAllSecrets(envPath)
    expect(secrets).toContain('secret123')
    expect(secrets).toContain('hunter2')
  })

  it('excludes config keys (PORT, HOST, NODE_ENV)', () => {
    fs.writeFileSync(envPath, 'PORT=3000\nHOST=localhost\nNODE_ENV=production\nAPI_KEY=secret\n')
    const secrets = getAllSecrets(envPath)
    expect(secrets).toEqual(['secret'])
  })

  it('skips commented-out keys', () => {
    fs.writeFileSync(envPath, '# OLD_KEY=leaked\nNEW_KEY=safe\n')
    const secrets = getAllSecrets(envPath)
    expect(secrets).toEqual(['safe'])
  })

  it('skips blank lines and empty values', () => {
    fs.writeFileSync(envPath, '\nEMPTY=\nREAL=value\n\n')
    const secrets = getAllSecrets(envPath)
    expect(secrets).toEqual(['value'])
  })
})
