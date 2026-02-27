/**
 * MCP Server Types
 *
 * Type definitions for the MCP tool infrastructure.
 * Uses the Agent SDK's built-in types.
 *
 * @module mcp/types
 */

import type { SearchService } from '../memory/search-service.js'

/**
 * Dependencies needed by the memory MCP server.
 */
export interface MemoryServerDeps {
  notebookDir: string
  searchService: SearchService
}
