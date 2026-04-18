import { describe, it, expect } from 'vitest'
import { classifyMcpToolError } from '../../src/capabilities/failure-symptoms.js'

describe('classifyMcpToolError', () => {
  it('maps "connection timed out" → timeout', () => {
    expect(classifyMcpToolError('MCP error -32000: connection timed out')).toBe('timeout')
  })

  it('maps "etimedout" → timeout', () => {
    expect(classifyMcpToolError('etimedout after 5000ms')).toBe('timeout')
  })

  it('maps "schema validation failed" → validation-failed', () => {
    expect(classifyMcpToolError('schema validation failed')).toBe('validation-failed')
  })

  it('maps "validation error on field value" → validation-failed', () => {
    expect(classifyMcpToolError('validation error on field value')).toBe('validation-failed')
  })

  it('maps "capability is disabled" → not-enabled', () => {
    expect(classifyMcpToolError('capability is disabled')).toBe('not-enabled')
  })

  it('maps "feature is not enabled" → not-enabled', () => {
    expect(classifyMcpToolError('feature is not enabled')).toBe('not-enabled')
  })

  it('maps Mode 2 child-crash "Connection closed" → execution-error', () => {
    expect(classifyMcpToolError('MCP error -32000: Connection closed')).toBe('execution-error')
  })

  it('maps unknown error → execution-error (default)', () => {
    expect(classifyMcpToolError('MCP error -32000: Spike-induced tool error: something random')).toBe('execution-error')
  })
})
