/**
 * Task MCP Server (Stub)
 *
 * Placeholder server for task management tools.
 * Returns "Not implemented yet" for all tools. Full implementation will follow.
 *
 * @module mcp/task-server
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

export function createTaskServer() {
  const createTask = tool(
    'create_task',
    'Create a new task. (Not yet implemented)',
    {
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('Task priority'),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Not implemented yet. Task tools coming in a future sprint.',
        },
      ],
      isError: true,
    }),
  )

  const updateTask = tool(
    'update_task',
    'Update an existing task. (Not yet implemented)',
    {
      id: z.string().describe('Task ID'),
      status: z
        .enum(['pending', 'in_progress', 'completed', 'cancelled'])
        .optional()
        .describe('New status'),
      title: z.string().optional().describe('Updated title'),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Not implemented yet. Task tools coming in a future sprint.',
        },
      ],
      isError: true,
    }),
  )

  return createSdkMcpServer({
    name: 'tasks',
    tools: [createTask, updateTask],
  })
}
