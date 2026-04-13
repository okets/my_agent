// browser-edge test fixture — same surface as browser-chrome-fixture,
// distinct name so multi-instance tests can verify two browser-control caps
// register, toggle, and delete independently.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const FIXTURE_NAME = 'browser-edge'

const server = new McpServer({ name: `${FIXTURE_NAME}-fixture`, version: '1.0.0' })

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
  'browser_close',
  'Close the page (test fixture)',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ closed: true, fixture: FIXTURE_NAME }) }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
