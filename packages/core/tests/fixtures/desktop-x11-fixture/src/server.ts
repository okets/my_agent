import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'desktop-x11-test', version: '1.0.0' })

server.tool(
  'desktop_info',
  'Query desktop info (test fixture)',
  { query: z.enum(['windows', 'display', 'capabilities']) },
  async ({ query }) => ({
    content: [{ type: 'text', text: JSON.stringify({ query, fixture: true }) }],
  }),
)

server.tool(
  'desktop_screenshot',
  'Take screenshot (test fixture)',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ fixture: true, screenshot: 'mock' }) }],
  }),
)

server.tool(
  'desktop_click',
  'Click (test fixture)',
  { x: z.number(), y: z.number() },
  async ({ x, y }) => ({
    content: [{ type: 'text', text: JSON.stringify({ clicked: { x, y } }) }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
