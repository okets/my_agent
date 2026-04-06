import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createStopReminder } from '../../src/hooks/safety.js'

describe('createStopReminder', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-hook-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns systemMessage when mandatory items are incomplete', async () => {
    const todoPath = path.join(tmpDir, 'todos.json')
    fs.writeFileSync(todoPath, JSON.stringify({
      items: [
        { id: 't1', text: 'Read spec', status: 'done', mandatory: true },
        { id: 't2', text: 'Write CAPABILITY.md', status: 'pending', mandatory: true },
        { id: 't3', text: 'Run tests', status: 'in_progress', mandatory: true },
      ],
      last_activity: new Date().toISOString(),
    }))

    const hook = createStopReminder(todoPath)
    const result = await hook({} as any, undefined, {} as any)

    expect(result.systemMessage).toBeDefined()
    expect(result.systemMessage).toContain('2 incomplete mandatory items')
    expect(result.systemMessage).toContain('t2: Write CAPABILITY.md')
    expect(result.systemMessage).toContain('t3: Run tests')
  })

  it('returns empty when all mandatory items are done', async () => {
    const todoPath = path.join(tmpDir, 'todos.json')
    fs.writeFileSync(todoPath, JSON.stringify({
      items: [
        { id: 't1', text: 'Read spec', status: 'done', mandatory: true },
        { id: 't2', text: 'Write code', status: 'done', mandatory: true },
        { id: 't3', text: 'Optional note', status: 'pending', mandatory: false },
      ],
      last_activity: new Date().toISOString(),
    }))

    const hook = createStopReminder(todoPath)
    const result = await hook({} as any, undefined, {} as any)

    expect(result.systemMessage).toBeUndefined()
  })

  it('treats blocked items as acceptable (not incomplete)', async () => {
    const todoPath = path.join(tmpDir, 'todos.json')
    fs.writeFileSync(todoPath, JSON.stringify({
      items: [
        { id: 't1', text: 'Done task', status: 'done', mandatory: true },
        { id: 't2', text: 'Blocked task', status: 'blocked', mandatory: true },
      ],
      last_activity: new Date().toISOString(),
    }))

    const hook = createStopReminder(todoPath)
    const result = await hook({} as any, undefined, {} as any)

    expect(result.systemMessage).toBeUndefined()
  })

  it('returns empty when todos.json does not exist', async () => {
    const hook = createStopReminder(path.join(tmpDir, 'nonexistent.json'))
    const result = await hook({} as any, undefined, {} as any)

    expect(result.systemMessage).toBeUndefined()
  })

  it('returns empty when no items exist', async () => {
    const todoPath = path.join(tmpDir, 'todos.json')
    fs.writeFileSync(todoPath, JSON.stringify({
      items: [],
      last_activity: new Date().toISOString(),
    }))

    const hook = createStopReminder(todoPath)
    const result = await hook({} as any, undefined, {} as any)

    expect(result.systemMessage).toBeUndefined()
  })
})
