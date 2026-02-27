/**
 * Memory MCP Server
 *
 * Wraps existing memory tools (recall, remember, daily_log, notebook_read, notebook_write)
 * as MCP tools via the Agent SDK's createSdkMcpServer pattern.
 *
 * @module mcp/memory-server
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  recall,
  remember,
  dailyLog,
  notebookRead,
  notebookWrite,
  formatRecallResults,
} from '../memory/index.js'
import type { MemoryServerDeps } from './types.js'

export function createMemoryServer(deps: MemoryServerDeps) {
  const { notebookDir, searchService } = deps

  const rememberTool = tool(
    'remember',
    'Save information to the notebook. Routes content to the appropriate category and file based on intent. Use for facts, contacts, preferences, todos, and other persistent information.',
    {
      content: z.string().describe('The information to remember'),
      category: z
        .enum(['lists', 'reference', 'knowledge'])
        .optional()
        .describe('Target category. If omitted, inferred from content.'),
      file: z
        .string()
        .optional()
        .describe('Target filename (e.g. "contacts.md"). If omitted, inferred from content.'),
      section: z
        .string()
        .optional()
        .describe('Section heading to append under. If omitted, appends to end of file.'),
    },
    async (args) => {
      const result = await remember(notebookDir, {
        content: args.content,
        category: args.category,
        file: args.file,
        section: args.section,
      })
      return {
        content: [{ type: 'text' as const, text: result.message }],
      }
    },
  )

  const recallTool = tool(
    'recall',
    'Search the notebook and daily logs using hybrid search (semantic + keyword). Returns relevant entries ranked by relevance.',
    {
      query: z.string().describe('Search query — what you want to find'),
      maxResults: z.number().optional().describe('Maximum number of results (default: 10)'),
    },
    async (args) => {
      const results = await recall(searchService, args.query, {
        maxResults: args.maxResults,
      })
      const formatted = formatRecallResults(results)
      return {
        content: [{ type: 'text' as const, text: formatted }],
      }
    },
  )

  const dailyLogTool = tool(
    'daily_log',
    "Append a timestamped entry to today's daily log. Use for noting events, accomplishments, observations, and anything worth recording for the day.",
    {
      entry: z.string().describe('The log entry to add (will be prefixed with timestamp)'),
    },
    async (args) => {
      const result = await dailyLog(notebookDir, { entry: args.entry })
      return {
        content: [
          { type: 'text' as const, text: `Logged at ${result.timestamp} in ${result.file}` },
        ],
      }
    },
  )

  const notebookReadTool = tool(
    'notebook_read',
    'Read a specific file from the notebook. Use when you know exactly which file you need, rather than searching.',
    {
      path: z.string().describe('Path relative to notebook/, e.g. "reference/contacts.md"'),
      startLine: z.number().optional().describe('Line number to start reading from (1-indexed)'),
      lines: z.number().optional().describe('Number of lines to read'),
    },
    async (args) => {
      try {
        const content = await notebookRead(notebookDir, args.path, {
          startLine: args.startLine,
          lines: args.lines,
        })
        return {
          content: [{ type: 'text' as const, text: content }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        }
      }
    },
  )

  const notebookWriteTool = tool(
    'notebook_write',
    'Write directly to a notebook file. Use for precise file control — creating files, replacing sections, or appending content.',
    {
      path: z.string().describe('Path relative to notebook/, e.g. "reference/my-notes.md"'),
      content: z.string().describe('Content to write'),
      section: z
        .string()
        .optional()
        .describe('Section heading to write under. If omitted, writes entire file.'),
      replace: z
        .boolean()
        .optional()
        .describe(
          'If true and section is specified, replaces the section content instead of appending',
        ),
    },
    async (args) => {
      const result = await notebookWrite(notebookDir, {
        path: args.path,
        content: args.content,
        section: args.section,
        replace: args.replace,
      })
      return {
        content: [{ type: 'text' as const, text: result.message }],
        isError: !result.success,
      }
    },
  )

  return createSdkMcpServer({
    name: 'memory',
    tools: [rememberTool, recallTool, dailyLogTool, notebookReadTool, notebookWriteTool],
  })
}
