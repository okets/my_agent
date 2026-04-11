import { describe, it, expect } from 'vitest'
import type { Capability, CapabilityFrontmatter } from '../../src/capabilities/types.js'

describe('Capability types', () => {
  it('accepts MCP capability with entrypoint and system requirements', () => {
    const cap: Capability = {
      name: 'Desktop Control (X11)',
      provides: 'desktop-control',
      interface: 'mcp',
      path: '/home/test/.my_agent/capabilities/desktop-x11',
      status: 'available',
      health: 'untested',
      enabled: true,
      entrypoint: 'npx tsx src/server.ts',
    }
    expect(cap.enabled).toBe(true)
    expect(cap.entrypoint).toBe('npx tsx src/server.ts')
  })

  it('accepts script capability without entrypoint', () => {
    const cap: Capability = {
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      interface: 'script',
      path: '/home/test/.my_agent/capabilities/stt-deepgram',
      status: 'available',
      health: 'untested',
      enabled: true,
    }
    expect(cap.entrypoint).toBeUndefined()
  })

  it('frontmatter accepts requires.system array', () => {
    const fm: CapabilityFrontmatter = {
      name: 'Desktop Control (X11)',
      provides: 'desktop-control',
      interface: 'mcp',
      entrypoint: 'npx tsx src/server.ts',
      requires: {
        env: [],
        system: ['xdotool', 'maim', 'wmctrl'],
      },
    }
    expect(fm.requires?.system).toEqual(['xdotool', 'maim', 'wmctrl'])
  })
})
