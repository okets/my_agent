/**
 * Core Agent Definitions
 *
 * Subagent definitions for the brain. These agents are invoked via the
 * Task tool when the brain needs specialized help.
 *
 * @module agents/definitions
 */

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'

export const coreAgents: Record<string, AgentDefinition> = {
  researcher: {
    description:
      'Investigates issues, searches codebases, gathers information. Read-only — never makes changes.',
    prompt:
      'You are a research specialist. Gather information thoroughly and return a concise summary of findings. Do not make changes — only read and analyze.',
    tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    model: 'sonnet',
  },
  executor: {
    description:
      'Implements changes, writes code, runs commands. Use when you need to make specific modifications.',
    prompt:
      'You are an implementation specialist. Make the requested changes precisely. Run tests after changes. Report what was changed.',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    model: 'sonnet',
  },
  reviewer: {
    description: 'Reviews code and output for quality, security, and correctness. Read-only.',
    prompt:
      'You are a code reviewer focused on security vulnerabilities, logic errors, and code quality. Provide specific line-level feedback. Never make changes.',
    tools: ['Read', 'Glob', 'Grep'],
    model: 'sonnet',
  },
}
