import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTodoTools, type TodoProgress } from '../../../src/mcp/todo-server.js'
import { writeTodoFile } from '../../../src/automations/todo-file.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('todo server onProgress callback', () => {
  let tempDir: string
  let todoPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'todo-progress-'))
    todoPath = join(tempDir, 'todos.json')
    writeTodoFile(todoPath, {
      items: [
        { id: 't1', text: 'First task', status: 'pending', mandatory: true },
        { id: 't2', text: 'Second task', status: 'pending', mandatory: true },
        { id: 't3', text: 'Third task', status: 'pending', mandatory: false },
      ],
      last_activity: new Date().toISOString(),
    })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should call onProgress when todo_update changes status', async () => {
    const onProgress = vi.fn()
    const tools = createTodoTools(todoPath, undefined, undefined, onProgress)

    await tools.todo_update({ id: 't1', status: 'in_progress' })
    expect(onProgress).toHaveBeenCalledWith({
      done: 0,
      total: 3,
      current: 'First task',
    })

    await tools.todo_update({ id: 't1', status: 'done' })
    expect(onProgress).toHaveBeenCalledWith({
      done: 1,
      total: 3,
      current: null,
    })
  })

  it('should report correct current item when multiple in_progress', async () => {
    const onProgress = vi.fn()
    const tools = createTodoTools(todoPath, undefined, undefined, onProgress)

    await tools.todo_update({ id: 't1', status: 'done' })
    await tools.todo_update({ id: 't2', status: 'in_progress' })

    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0]
    expect(lastCall.done).toBe(1)
    expect(lastCall.current).toBe('Second task')
  })

  it('should not call onProgress when only adding notes', async () => {
    const onProgress = vi.fn()
    const tools = createTodoTools(todoPath, undefined, undefined, onProgress)

    await tools.todo_update({ id: 't1', notes: 'some notes' })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('should not crash when onProgress is not provided', async () => {
    const tools = createTodoTools(todoPath)
    await tools.todo_update({ id: 't1', status: 'done' })
    // No error thrown
  })
})
