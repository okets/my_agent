/**
 * MCP Server Infrastructure
 *
 * Domain-separated MCP servers for the brain's custom tools.
 * Memory server is live; channel server is a stub.
 *
 * @module mcp
 */

export { createMemoryServer } from './memory-server.js'
export { createChannelServer } from './channel-server.js'
export type { MemoryServerDeps } from './types.js'
