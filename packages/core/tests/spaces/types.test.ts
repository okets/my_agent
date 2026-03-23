import { describe, it, expect } from 'vitest'
import { isToolSpace } from '../../src/spaces/types.js'
import type { Space } from '../../src/spaces/types.js'

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    name: 'test-space',
    manifestDir: '/tmp/spaces/test-space',
    tags: [],
    description: 'A test space',
    created: '2026-03-23',
    indexedAt: '2026-03-23',
    ...overrides,
  }
}

describe('isToolSpace', () => {
  it('returns true when runtime, entry, and io are all present', () => {
    const space = makeSpace({
      runtime: 'uv',
      entry: 'src/main.py',
      io: { input: { url: 'string' }, output: { results: 'file' } },
    })
    expect(isToolSpace(space)).toBe(true)
  })

  it('returns false when runtime is missing', () => {
    const space = makeSpace({
      entry: 'src/main.py',
      io: { input: { url: 'string' }, output: { results: 'file' } },
    })
    expect(isToolSpace(space)).toBe(false)
  })

  it('returns false when entry is missing', () => {
    const space = makeSpace({
      runtime: 'uv',
      io: { input: { url: 'string' }, output: { results: 'file' } },
    })
    expect(isToolSpace(space)).toBe(false)
  })

  it('returns false when io is missing', () => {
    const space = makeSpace({
      runtime: 'uv',
      entry: 'src/main.py',
    })
    expect(isToolSpace(space)).toBe(false)
  })

  it('returns false when all three are missing', () => {
    const space = makeSpace()
    expect(isToolSpace(space)).toBe(false)
  })

  it('returns true even without maintenance', () => {
    const space = makeSpace({
      runtime: 'node',
      entry: 'index.js',
      io: { input: { query: 'string' }, output: { answer: 'stdout' } },
    })
    expect(isToolSpace(space)).toBe(true)
  })
})
