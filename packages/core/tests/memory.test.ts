/**
 * Integration Tests — Memory System
 *
 * Tests the memory system at the component level:
 * - MemoryDb schema creation and operations
 * - Markdown chunking
 * - File sync and indexing
 * - Hybrid search (FTS5 + vector)
 * - Graceful fallback to FTS5-only when embeddings unavailable
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { MemoryDb } from '../src/memory/memory-db.js'
import { chunkMarkdown, hashFileContent } from '../src/memory/chunker.js'
import { SyncService } from '../src/memory/sync-service.js'
import { SearchService } from '../src/memory/search-service.js'
import { initNotebook } from '../src/memory/init.js'
import { remember, dailyLog, notebookWrite } from '../src/memory/tools.js'

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memory-test-'))
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function writeFile(dir: string, relativePath: string, content: string): void {
  const fullPath = path.join(dir, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf-8')
}

// -------------------------------------------------------------------
// MemoryDb Tests
// -------------------------------------------------------------------

describe('MemoryDb', () => {
  let tempDir: string
  let db: MemoryDb

  beforeEach(() => {
    tempDir = createTempDir()
    // Create brain directory for memory.db
    fs.mkdirSync(path.join(tempDir, 'brain'), { recursive: true })
    db = new MemoryDb(tempDir)
  })

  afterEach(() => {
    db.close()
    cleanDir(tempDir)
  })

  it('creates tables on initialization', () => {
    // Should not throw
    const status = db.getStatus()
    expect(status.filesIndexed).toBe(0)
    expect(status.totalChunks).toBe(0)
  })

  it('tracks files', () => {
    db.upsertFile({
      path: 'test.md',
      hash: 'abc123',
      mtime: new Date().toISOString(),
      size: 100,
      indexedAt: new Date().toISOString(),
    })

    const files = db.listFiles()
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('test.md')
  })

  it('stores and retrieves chunks', () => {
    // First upsert the file
    db.upsertFile({
      path: 'test.md',
      hash: 'abc123',
      mtime: new Date().toISOString(),
      size: 100,
      indexedAt: new Date().toISOString(),
    })

    // Then add chunk
    const chunkId = db.insertChunk({
      filePath: 'test.md',
      heading: 'Test Section',
      startLine: 1,
      endLine: 10,
      text: 'This is test content about programming',
      hash: 'chunk123',
    })

    expect(chunkId).toBeGreaterThan(0)

    const chunk = db.getChunk(chunkId)
    expect(chunk).not.toBeNull()
    expect(chunk!.heading).toBe('Test Section')
  })

  it('performs FTS5 search', () => {
    db.upsertFile({
      path: 'test.md',
      hash: 'abc123',
      mtime: new Date().toISOString(),
      size: 100,
      indexedAt: new Date().toISOString(),
    })

    db.insertChunk({
      filePath: 'test.md',
      heading: 'Programming Guide',
      startLine: 1,
      endLine: 10,
      text: 'Learn Python programming basics',
      hash: 'chunk1',
    })

    db.insertChunk({
      filePath: 'test.md',
      heading: 'Cooking',
      startLine: 11,
      endLine: 20,
      text: 'How to make pasta',
      hash: 'chunk2',
    })

    const results = db.searchFts('programming', 10)
    expect(results.length).toBeGreaterThan(0)
    // searchFts returns { chunkId, rank }
    expect(results[0].chunkId).toBeGreaterThan(0)
  })

  it('clears all data', () => {
    db.upsertFile({
      path: 'test.md',
      hash: 'abc123',
      mtime: new Date().toISOString(),
      size: 100,
      indexedAt: new Date().toISOString(),
    })

    db.clearAll()

    const status = db.getStatus()
    expect(status.filesIndexed).toBe(0)
    expect(status.totalChunks).toBe(0)
  })
})

// -------------------------------------------------------------------
// Chunker Tests
// -------------------------------------------------------------------

describe('Markdown Chunker', () => {
  it('chunks simple text', () => {
    const content = '# Title\n\nSome content here.\n\nMore content.'
    const chunks = chunkMarkdown(content)

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].heading).toBe('Title')
  })

  it('respects heading boundaries', () => {
    const content = `# Section One

Content for section one with lots of text.

# Section Two

Content for section two with more text.`

    const chunks = chunkMarkdown(content)

    // Each section should have its own heading
    const headings = chunks.map((c) => c.heading)
    expect(headings).toContain('Section One')
    expect(headings).toContain('Section Two')
  })

  it('generates consistent hashes', () => {
    const content = 'Test content'
    const hash1 = hashFileContent(content)
    const hash2 = hashFileContent(content)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA256 hex
  })

  it('handles empty content', () => {
    const chunks = chunkMarkdown('')
    expect(chunks).toHaveLength(0)
  })

  it('handles content without headings', () => {
    const content = 'Just some text without any headings.\n\nAnother paragraph.'
    const chunks = chunkMarkdown(content)

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].heading).toBeNull()
  })
})

// -------------------------------------------------------------------
// Sync Service Tests
// -------------------------------------------------------------------

describe('SyncService', () => {
  let tempDir: string
  let db: MemoryDb
  let syncService: SyncService

  beforeEach(async () => {
    tempDir = createTempDir()
    fs.mkdirSync(path.join(tempDir, 'brain'), { recursive: true })
    await initNotebook(tempDir)

    db = new MemoryDb(tempDir)
    syncService = new SyncService({
      notebookDir: path.join(tempDir, 'notebook'),
      db,
      getPlugin: () => null, // No embeddings for basic tests
    })
  })

  afterEach(() => {
    syncService.stopWatching()
    db.close()
    cleanDir(tempDir)
  })

  it('syncs a single file', async () => {
    writeFile(tempDir, 'notebook/reference/test.md', '# Test\n\nSome test content.')

    const result = await syncService.fullSync()

    expect(result.added).toBeGreaterThan(0)
    expect(result.errors).toHaveLength(0)

    const files = db.listFiles()
    expect(files.length).toBeGreaterThan(0)
  })

  it('detects file changes', async () => {
    writeFile(tempDir, 'notebook/reference/test.md', '# Original\n\nContent.')

    await syncService.fullSync()
    const initialFiles = db.listFiles()
    const initialHash = initialFiles[0].hash

    // Modify the file
    writeFile(tempDir, 'notebook/reference/test.md', '# Modified\n\nNew content.')

    const result = await syncService.fullSync()
    expect(result.updated).toBeGreaterThan(0)

    const updatedFiles = db.listFiles()
    expect(updatedFiles[0].hash).not.toBe(initialHash)
  })

  it('removes deleted files from index', async () => {
    writeFile(tempDir, 'notebook/reference/test.md', '# Test\n\nContent.')
    await syncService.fullSync()

    expect(db.listFiles()).toHaveLength(1)

    // Delete the file
    fs.unlinkSync(path.join(tempDir, 'notebook/reference/test.md'))

    const result = await syncService.fullSync()
    expect(result.removed).toBe(1)
    expect(db.listFiles()).toHaveLength(0)
  })

  it('handles multiple files', async () => {
    writeFile(tempDir, 'notebook/reference/file1.md', '# File 1\n\nContent 1.')
    writeFile(tempDir, 'notebook/knowledge/file2.md', '# File 2\n\nContent 2.')
    writeFile(tempDir, 'notebook/lists/tasks.md', '# Tasks\n\n- [ ] Task 1')

    const result = await syncService.fullSync()

    expect(result.added).toBe(3)
    expect(db.listFiles()).toHaveLength(3)
  })
})

// -------------------------------------------------------------------
// Search Service Tests
// -------------------------------------------------------------------

describe('SearchService', () => {
  let tempDir: string
  let db: MemoryDb
  let searchService: SearchService

  beforeEach(async () => {
    tempDir = createTempDir()
    fs.mkdirSync(path.join(tempDir, 'brain'), { recursive: true })

    db = new MemoryDb(tempDir)
    searchService = new SearchService({
      db,
      getPlugin: () => null, // FTS5-only mode
    })

    // Seed test data
    db.upsertFile({
      path: 'reference/contacts.md',
      hash: 'abc123',
      mtime: new Date().toISOString(),
      size: 100,
      indexedAt: new Date().toISOString(),
    })

    db.insertChunk({
      filePath: 'reference/contacts.md',
      heading: 'Work Contacts',
      startLine: 1,
      endLine: 10,
      text: 'John Smith - Engineering Lead - john@example.com',
      hash: 'chunk1',
    })

    db.insertChunk({
      filePath: 'reference/contacts.md',
      heading: 'Personal Contacts',
      startLine: 11,
      endLine: 20,
      text: 'Jane Doe - Friend - likes hiking and photography',
      hash: 'chunk2',
    })

    db.upsertFile({
      path: 'daily/2024-01-15.md',
      hash: 'def456',
      mtime: new Date().toISOString(),
      size: 200,
      indexedAt: new Date().toISOString(),
    })

    db.insertChunk({
      filePath: 'daily/2024-01-15.md',
      heading: null,
      startLine: 1,
      endLine: 5,
      text: 'Met with John to discuss project timeline',
      hash: 'chunk3',
    })
  })

  afterEach(() => {
    db.close()
    cleanDir(tempDir)
  })

  it('finds results by keyword', async () => {
    // Use minScore: 0 to disable score filtering in FTS5-only mode
    // (RRF scores are low without vector search component)
    const results = await searchService.recall('John', { minScore: 0 })

    expect(results.notebook.length + results.daily.length).toBeGreaterThan(0)
  })

  it('groups results by type', async () => {
    const results = await searchService.recall('John', { minScore: 0 })

    // John appears in both notebook (contacts) and daily
    expect(results.notebook.length).toBeGreaterThan(0)
    expect(results.daily.length).toBeGreaterThan(0)
  })

  it('respects maxResults option', async () => {
    const results = await searchService.recall('contacts', {
      maxResults: 1,
      minScore: 0,
    })

    expect(results.notebook.length + results.daily.length).toBeLessThanOrEqual(1)
  })

  it('handles queries with no results', async () => {
    const results = await searchService.recall('xyznonexistent', { minScore: 0 })

    expect(results.notebook).toHaveLength(0)
    expect(results.daily).toHaveLength(0)
  })

  it('searches partial matches', async () => {
    const results = await searchService.recall('Engineering', { minScore: 0 })

    expect(results.notebook.length).toBeGreaterThan(0)
    expect(results.notebook[0].snippet).toContain('Engineering')
  })
})

// -------------------------------------------------------------------
// Init / Migration Tests
// -------------------------------------------------------------------

describe('Notebook Initialization', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('creates notebook folder structure', async () => {
    await initNotebook(tempDir)

    expect(fs.existsSync(path.join(tempDir, 'notebook'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'notebook/lists'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'notebook/reference'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'notebook/knowledge'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'notebook/daily'))).toBe(true)
  })

  it('creates brain directory', async () => {
    await initNotebook(tempDir)

    expect(fs.existsSync(path.join(tempDir, 'brain'))).toBe(true)
  })

  it('creates cache/models directory', async () => {
    await initNotebook(tempDir)

    expect(fs.existsSync(path.join(tempDir, 'cache/models'))).toBe(true)
  })

  it('is idempotent', async () => {
    await initNotebook(tempDir)
    await initNotebook(tempDir)

    // Should not throw, directories should still exist
    expect(fs.existsSync(path.join(tempDir, 'notebook'))).toBe(true)
  })
})

// -------------------------------------------------------------------
// remember() Tool Tests
// -------------------------------------------------------------------

describe('remember() Tool', () => {
  let tempDir: string
  let notebookDir: string

  beforeEach(async () => {
    tempDir = createTempDir()
    await initNotebook(tempDir)
    notebookDir = path.join(tempDir, 'notebook')
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('auto-routes contact info to reference/contacts.md', async () => {
    const result = await remember(notebookDir, {
      content: 'John Doe - john@example.com - 555-1234',
    })

    expect(result.success).toBe(true)
    expect(result.file).toBe('reference/contacts.md')

    const content = fs.readFileSync(path.join(notebookDir, 'reference/contacts.md'), 'utf-8')
    expect(content).toContain('John Doe')
    expect(content).toContain('john@example.com')
  })

  it('auto-routes preferences to reference/preferences.md', async () => {
    const result = await remember(notebookDir, {
      content: 'I prefer dark mode in all apps',
    })

    expect(result.success).toBe(true)
    expect(result.file).toBe('reference/preferences.md')
  })

  it('respects explicit category', async () => {
    const result = await remember(notebookDir, {
      content: 'Remember to buy milk',
      category: 'lists',
    })

    expect(result.success).toBe(true)
    expect(result.file).toContain('lists/')
  })

  it('appends to specific section', async () => {
    // First create a file with a section
    await notebookWrite(notebookDir, {
      path: 'reference/contacts.md',
      content: '# Contacts\n\n## Work\n\nAlice - Manager',
    })

    const result = await remember(notebookDir, {
      content: 'Bob - Developer',
      category: 'reference',
      file: 'contacts',
      section: 'Work',
    })

    expect(result.success).toBe(true)
    expect(result.section).toBe('Work')

    const content = fs.readFileSync(path.join(notebookDir, 'reference/contacts.md'), 'utf-8')
    expect(content).toContain('Alice - Manager')
    expect(content).toContain('Bob - Developer')
  })
})

// -------------------------------------------------------------------
// daily_log() Tool Tests
// -------------------------------------------------------------------

describe('daily_log() Tool', () => {
  let tempDir: string
  let notebookDir: string

  beforeEach(async () => {
    tempDir = createTempDir()
    await initNotebook(tempDir)
    notebookDir = path.join(tempDir, 'notebook')
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('creates daily log with timestamp', async () => {
    const result = await dailyLog(notebookDir, {
      entry: 'Started working on memory system',
    })

    expect(result.success).toBe(true)
    expect(result.file).toMatch(/daily\/\d{4}-\d{2}-\d{2}\.md/)
    expect(result.timestamp).toMatch(/\d{2}:\d{2}/)

    const content = fs.readFileSync(path.join(notebookDir, result.file), 'utf-8')
    expect(content).toContain('Started working on memory system')
    expect(content).toMatch(/- \[\d{2}:\d{2}\]/)
  })

  it('appends to existing daily log', async () => {
    await dailyLog(notebookDir, { entry: 'First entry' })
    await dailyLog(notebookDir, { entry: 'Second entry' })

    const today = new Date().toISOString().split('T')[0]
    const content = fs.readFileSync(path.join(notebookDir, 'daily', `${today}.md`), 'utf-8')

    expect(content).toContain('First entry')
    expect(content).toContain('Second entry')
  })
})

// -------------------------------------------------------------------
// notebook_write() Tool Tests
// -------------------------------------------------------------------

describe('notebook_write() Tool', () => {
  let tempDir: string
  let notebookDir: string

  beforeEach(async () => {
    tempDir = createTempDir()
    await initNotebook(tempDir)
    notebookDir = path.join(tempDir, 'notebook')
  })

  afterEach(() => {
    cleanDir(tempDir)
  })

  it('writes new file', async () => {
    const result = await notebookWrite(notebookDir, {
      path: 'lists/shopping.md',
      content: '# Shopping\n\n- Milk\n- Bread',
    })

    expect(result.success).toBe(true)

    const content = fs.readFileSync(path.join(notebookDir, 'lists/shopping.md'), 'utf-8')
    expect(content).toContain('# Shopping')
    expect(content).toContain('- Milk')
  })

  it('appends to section', async () => {
    // Create initial file
    await notebookWrite(notebookDir, {
      path: 'lists/shopping.md',
      content: '# Shopping\n\n## Groceries\n\n- Milk',
    })

    // Append to section
    const result = await notebookWrite(notebookDir, {
      path: 'lists/shopping.md',
      content: '- Eggs',
      section: 'Groceries',
      replace: false,
    })

    expect(result.success).toBe(true)

    const content = fs.readFileSync(path.join(notebookDir, 'lists/shopping.md'), 'utf-8')
    expect(content).toContain('- Milk')
    expect(content).toContain('- Eggs')
  })

  it('replaces section content', async () => {
    // Create initial file
    await notebookWrite(notebookDir, {
      path: 'lists/shopping.md',
      content: '# Shopping\n\n## Groceries\n\n- Old items',
    })

    // Replace section
    const result = await notebookWrite(notebookDir, {
      path: 'lists/shopping.md',
      content: '- New items',
      section: 'Groceries',
      replace: true,
    })

    expect(result.success).toBe(true)

    const content = fs.readFileSync(path.join(notebookDir, 'lists/shopping.md'), 'utf-8')
    expect(content).not.toContain('Old items')
    expect(content).toContain('New items')
  })

  it('prevents directory traversal', async () => {
    const result = await notebookWrite(notebookDir, {
      path: '../../../etc/passwd',
      content: 'malicious content',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Invalid path')
  })
})
