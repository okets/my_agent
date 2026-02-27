/**
 * MCP Server Infrastructure
 *
 * Domain-separated MCP servers for the brain's custom tools.
 * Memory server is live; channel and task servers are stubs.
 *
 * @module mcp
 */

export { createMemoryServer } from './memory-server.js'
export { createChannelServer } from './channel-server.js'
export { createTaskServer } from './task-server.js'
export type { MemoryServerDeps } from './types.js'
