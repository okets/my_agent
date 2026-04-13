// browser-chrome test fixture — mock @playwright/mcp.
// Same tool surface as the real server, no real browser dependency.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const FIXTURE_NAME = 'browser-chrome'

const server = new McpServer({ name: `${FIXTURE_NAME}-fixture`, version: '1.0.0' })

// Minimal valid 1x1 red PNG — for screenshot tools that return image content.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
  '2e00000000c4944415478016360f8cf00000001010000187227a00000000' +
  '049454e44ae426082',
  'hex',
).toString('base64')

server.tool(
  'browser_navigate',
  'Navigate to URL (test fixture)',
  { url: z.string() },
  async ({ url }) => ({
    content: [{ type: 'text', text: JSON.stringify({ navigated: url, fixture: FIXTURE_NAME }) }],
  }),
)

server.tool(
  'browser_click',
  'Click an element by accessibility ref (test fixture)',
  { element: z.string(), ref: z.string() },
  async ({ element, ref }) => ({
    content: [{ type: 'text', text: JSON.stringify({ clicked: { element, ref }, fixture: FIXTURE_NAME }) }],
  }),
)

server.tool(
  'browser_type',
  'Type text into an element (test fixture)',
  { element: z.string(), ref: z.string(), text: z.string(), submit: z.boolean().optional() },
  async ({ element, ref, text }) => ({
    content: [{ type: 'text', text: JSON.stringify({ typed: { element, ref, text }, fixture: FIXTURE_NAME }) }],
  }),
)

server.tool(
  'browser_snapshot',
  'Capture an accessibility snapshot of the page (test fixture)',
  {},
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          url: 'about:blank',
          title: 'Fixture page',
          tree: [{ role: 'document', name: 'fixture', children: [] }],
          fixture: FIXTURE_NAME,
        }),
      },
    ],
  }),
)

server.tool(
  'browser_take_screenshot',
  'Take a screenshot of the page (test fixture)',
  { fullPage: z.boolean().optional() },
  async () => ({
    content: [
      { type: 'image', data: TINY_PNG, mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify({ width: 1, height: 1, fixture: FIXTURE_NAME }) },
    ],
  }),
)

server.tool(
  'browser_wait_for',
  'Wait for text/timeout/element (test fixture)',
  { text: z.string().optional(), time: z.number().optional() },
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify({ waited: args, fixture: FIXTURE_NAME }) }],
  }),
)

server.tool(
  'browser_close',
  'Close the page (test fixture)',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ closed: true, fixture: FIXTURE_NAME }) }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
