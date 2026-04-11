import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'desktop-x11-test', version: '1.0.0' })

// Required tools (7)

server.tool(
  'desktop_screenshot',
  'Take screenshot (test fixture)',
  { region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ fixture: true, width: 1920, height: 1080 }) }],
  }),
)

server.tool(
  'desktop_click',
  'Click at coordinates (test fixture)',
  { x: z.number(), y: z.number(), button: z.string().optional(), double: z.boolean().optional() },
  async ({ x, y }) => ({
    content: [{ type: 'text', text: JSON.stringify({ clicked: { x, y }, fixture: true }) }],
  }),
)

server.tool(
  'desktop_type',
  'Type text (test fixture)',
  { text: z.string() },
  async ({ text }) => ({
    content: [{ type: 'text', text: JSON.stringify({ typed: text, fixture: true }) }],
  }),
)

server.tool(
  'desktop_key',
  'Press key combo (test fixture)',
  { key: z.string() },
  async ({ key }) => ({
    content: [{ type: 'text', text: JSON.stringify({ pressed: key, fixture: true }) }],
  }),
)

server.tool(
  'desktop_scroll',
  'Scroll at position (test fixture)',
  { x: z.number(), y: z.number(), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().optional() },
  async ({ x, y, direction }) => ({
    content: [{ type: 'text', text: JSON.stringify({ scrolled: { x, y, direction }, fixture: true }) }],
  }),
)

server.tool(
  'desktop_info',
  'Query desktop info (test fixture)',
  { query: z.enum(['windows', 'display', 'capabilities']) },
  async ({ query }) => ({
    content: [{ type: 'text', text: JSON.stringify({ query, fixture: true }) }],
  }),
)

server.tool(
  'desktop_wait',
  'Wait for UI settling (test fixture)',
  { seconds: z.number() },
  async ({ seconds }) => ({
    content: [{ type: 'text', text: JSON.stringify({ waited: seconds, fixture: true }) }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
