/**
 * Audit Hook
 *
 * PostToolUse hook that logs tool usage to a JSONL audit file.
 * Applied at all trust levels.
 *
 * @module hooks/audit
 */

import { appendFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk'

/**
 * Create an audit logging hook.
 *
 * Logs tool name, a summary of the input, and timestamp to
 * {agentDir}/logs/audit.jsonl on every tool use.
 */
export function createAuditHook(agentDir?: string): HookCallback {
  return async (input) => {
    if (!agentDir) return {}

    const logPath = join(agentDir, 'logs', 'audit.jsonl')

    try {
      await mkdir(dirname(logPath), { recursive: true })

      // Narrow to PostToolUse input which has tool_name
      const toolName = 'tool_name' in input ? (input as { tool_name: string }).tool_name : 'unknown'

      const entry = {
        timestamp: new Date().toISOString(),
        tool: toolName,
        session: input.session_id,
      }

      await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf-8')
    } catch {
      // Audit logging is best-effort — never block tool execution
    }

    return {}
  }
}
