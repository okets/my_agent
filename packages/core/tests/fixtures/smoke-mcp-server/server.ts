import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'smoke-test', version: '1.0.0' })

server.tool('smoke_ping', 'Returns pong', {}, async () => ({
  content: [{ type: 'text', text: JSON.stringify({ status: 'pong' }) }],
}))

server.tool(
  'smoke_echo',
  'Echoes input',
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
