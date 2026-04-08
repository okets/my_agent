import { describe, it, expect } from 'vitest'

/**
 * Tests the auto-resume safety predicate.
 * A job should only auto-resume if ALL four criteria are met.
 * IMPORTANT: autonomy defaults to "full" when undefined in the manifest.
 */

interface AutoResumeInput {
  once?: boolean
  autonomy?: string
  sdkSessionId?: string | null
  priorStatus: string
}

export function shouldAutoResume(input: AutoResumeInput): boolean {
  return (
    !!input.once &&
    (input.autonomy ?? 'full') === 'full' &&
    !!input.sdkSessionId &&
    input.priorStatus === 'running'
  )
}

describe('auto-resume safety predicate', () => {
  it('resumes once:true + autonomy:full + has session + was running', () => {
    expect(shouldAutoResume({
      once: true, autonomy: 'full', sdkSessionId: 'sess-123', priorStatus: 'running',
    })).toBe(true)
  })

  it('resumes when autonomy is undefined (defaults to full)', () => {
    expect(shouldAutoResume({
      once: true, autonomy: undefined, sdkSessionId: 'sess-123', priorStatus: 'running',
    })).toBe(true)
  })

  it('does NOT resume recurring automations (once:false)', () => {
    expect(shouldAutoResume({
      once: false, autonomy: 'full', sdkSessionId: 'sess-123', priorStatus: 'running',
    })).toBe(false)
  })

  it('does NOT resume once:undefined', () => {
    expect(shouldAutoResume({
      once: undefined, autonomy: 'full', sdkSessionId: 'sess-123', priorStatus: 'running',
    })).toBe(false)
  })

  it('does NOT resume cautious autonomy', () => {
    expect(shouldAutoResume({
      once: true, autonomy: 'cautious', sdkSessionId: 'sess-123', priorStatus: 'running',
    })).toBe(false)
  })

  it('does NOT resume review autonomy', () => {
    expect(shouldAutoResume({
      once: true, autonomy: 'review', sdkSessionId: 'sess-123', priorStatus: 'running',
    })).toBe(false)
  })

  it('does NOT resume without SDK session', () => {
    expect(shouldAutoResume({
      once: true, autonomy: 'full', sdkSessionId: null, priorStatus: 'running',
    })).toBe(false)
  })

  it('does NOT resume pending jobs (never started)', () => {
    expect(shouldAutoResume({
      once: true, autonomy: 'full', sdkSessionId: 'sess-123', priorStatus: 'pending',
    })).toBe(false)
  })
})
