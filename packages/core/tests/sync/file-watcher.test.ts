import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileWatcher, hashContent } from '../../src/sync/file-watcher.js'
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('FileWatcher', () => {
  let tempDir: string
  let watcher: FileWatcher

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'fw-test-'))
  })

  afterEach(async () => {
    if (watcher) await watcher.stop()
  })

  it('should hash content deterministically', () => {
    const hash1 = hashContent('hello world')
    const hash2 = hashContent('hello world')
    const hash3 = hashContent('different')
    expect(hash1).toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash1).toHaveLength(64) // SHA256 hex
  })

  it('should emit file:changed on scanAll for matching files', async () => {
    const subDir = join(tempDir, 'project')
    mkdirSync(subDir)
    writeFileSync(join(subDir, 'SPACE.md'), '---\nname: test\n---\nHello')
    writeFileSync(join(subDir, 'README.md'), '# Readme')

    watcher = new FileWatcher({
      watchDir: tempDir,
      includePattern: '**/SPACE.md',
      debounceMs: 50,
    })

    const changes: any[] = []
    watcher.on('file:changed', (c) => changes.push(c))

    const count = await watcher.scanAll()
    expect(count).toBe(1)
    expect(changes).toHaveLength(1)
    expect(changes[0].relativePath).toBe('project/SPACE.md')
    expect(changes[0].content).toContain('name: test')
    expect(changes[0].hash).toHaveLength(64)
  })

  it('should skip files with unchanged hash on repeated scanAll', async () => {
    writeFileSync(join(tempDir, 'SPACE.md'), '---\nname: a\n---\n')

    watcher = new FileWatcher({
      watchDir: tempDir,
      includePattern: '**/SPACE.md',
      debounceMs: 50,
    })

    const count1 = await watcher.scanAll()
    expect(count1).toBe(1)

    const count2 = await watcher.scanAll()
    expect(count2).toBe(0)
  })

  it('should re-emit after content changes between scans', async () => {
    const filePath = join(tempDir, 'SPACE.md')
    writeFileSync(filePath, 'version 1')

    watcher = new FileWatcher({
      watchDir: tempDir,
      includePattern: '**/SPACE.md',
      debounceMs: 50,
    })

    await watcher.scanAll()

    writeFileSync(filePath, 'version 2')
    const count = await watcher.scanAll()
    expect(count).toBe(1)
  })

  it('should respect exclude patterns', async () => {
    mkdirSync(join(tempDir, 'included'))
    mkdirSync(join(tempDir, 'excluded'))
    writeFileSync(join(tempDir, 'included', 'SPACE.md'), 'yes')
    writeFileSync(join(tempDir, 'excluded', 'SPACE.md'), 'no')

    watcher = new FileWatcher({
      watchDir: tempDir,
      includePattern: '**/SPACE.md',
      excludePatterns: ['excluded/**'],
      debounceMs: 50,
    })

    const changes: any[] = []
    watcher.on('file:changed', (c) => changes.push(c))

    await watcher.scanAll()
    expect(changes).toHaveLength(1)
    expect(changes[0].relativePath).toBe('included/SPACE.md')
  })

  it('should emit scan:complete after scanAll', async () => {
    writeFileSync(join(tempDir, 'SPACE.md'), 'test')

    watcher = new FileWatcher({
      watchDir: tempDir,
      includePattern: '**/SPACE.md',
      debounceMs: 50,
    })

    const scanEvents: any[] = []
    watcher.on('scan:complete', (e) => scanEvents.push(e))

    await watcher.scanAll()
    expect(scanEvents).toHaveLength(1)
    expect(scanEvents[0].count).toBe(1)
  })

  it('should scan all files when no includePattern set', async () => {
    writeFileSync(join(tempDir, 'a.md'), 'one')
    writeFileSync(join(tempDir, 'b.txt'), 'two')

    watcher = new FileWatcher({
      watchDir: tempDir,
      debounceMs: 50,
    })

    const count = await watcher.scanAll()
    expect(count).toBe(2)
  })
})
