import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SpaceSyncService, type SpaceSyncPayload } from '../../src/spaces/space-sync-service.js'
import { mkdtempSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('SpaceSyncService', () => {
  let tempDir: string
  let service: SpaceSyncService
  let changed: SpaceSyncPayload[]
  let deleted: string[]

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'space-sync-'))
    changed = []
    deleted = []
  })

  afterEach(async () => {
    if (service) await service.stop()
  })

  function createService() {
    service = new SpaceSyncService({
      spacesDir: tempDir,
      onSpaceChanged: (payload) => changed.push(payload),
      onSpaceDeleted: (name) => deleted.push(name),
      debounceMs: 50,
    })
    return service
  }

  function writeSpaceMd(name: string, frontmatter: string, body: string = '') {
    const dir = join(tempDir, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SPACE.md'), `---\n${frontmatter}---\n${body ? '\n' + body : ''}`)
  }

  it('should parse SPACE.md frontmatter and call onSpaceChanged on fullSync', async () => {
    writeSpaceMd('web-scraper', 'name: web-scraper\ntags:\n  - tool\n  - scraper\nruntime: uv\nentry: main.py\ncreated: "2026-03-23"\n', 'A web scraper tool')

    createService()
    const count = await service.fullSync()

    expect(count).toBe(1)
    expect(changed).toHaveLength(1)
    expect(changed[0].name).toBe('web-scraper')
    expect(changed[0].tags).toEqual(['tool', 'scraper'])
    expect(changed[0].runtime).toBe('uv')
    expect(changed[0].entry).toBe('main.py')
    expect(changed[0].description).toBe('A web scraper tool')
    expect(changed[0].indexedAt).toBeTruthy()
  })

  it('should handle external spaces with path field', async () => {
    writeSpaceMd('external-repo', 'name: external-repo\npath: /home/user/projects/my-repo\ntags:\n  - project\ncreated: "2026-03-23"\n')

    createService()
    await service.fullSync()

    expect(changed).toHaveLength(1)
    expect(changed[0].path).toBe('/home/user/projects/my-repo')
  })

  it('should default path to manifest directory for internal spaces', async () => {
    writeSpaceMd('internal', 'name: internal\ncreated: "2026-03-23"\n')

    createService()
    await service.fullSync()

    expect(changed).toHaveLength(1)
    expect(changed[0].path).toBe(join(tempDir, 'internal'))
  })

  it('should use directory name as space name when frontmatter name is missing', async () => {
    writeSpaceMd('dir-name', 'created: "2026-03-23"\n')

    createService()
    await service.fullSync()

    expect(changed).toHaveLength(1)
    expect(changed[0].name).toBe('dir-name')
  })

  it('should emit space:synced events', async () => {
    writeSpaceMd('test-space', 'name: test-space\ncreated: "2026-03-23"\n')

    createService()
    const events: any[] = []
    service.on('space:synced', (e) => events.push(e))

    await service.fullSync()

    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('test-space')
  })

  it('should sync multiple spaces', async () => {
    writeSpaceMd('alpha', 'name: alpha\ntags:\n  - a\ncreated: "2026-03-23"\n')
    writeSpaceMd('beta', 'name: beta\ntags:\n  - b\ncreated: "2026-03-23"\n')

    createService()
    const count = await service.fullSync()

    expect(count).toBe(2)
    expect(changed).toHaveLength(2)
    const names = changed.map((c) => c.name).sort()
    expect(names).toEqual(['alpha', 'beta'])
  })
})
