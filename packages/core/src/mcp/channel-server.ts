/**
 * Channel MCP Server (Stub)
 *
 * Placeholder server for channel tools (send_whatsapp, send_email).
 * Returns "Not implemented yet" for all tools. Will be implemented in M9/M10.
 *
 * @module mcp/channel-server
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

export function createChannelServer() {
  const sendWhatsapp = tool(
    'send_whatsapp',
    'Send a WhatsApp message to a contact. (Not yet implemented — coming in M9)',
    {
      to: z.string().describe('Recipient phone number or contact name'),
      message: z.string().describe('Message text to send'),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Not implemented yet. WhatsApp channel will be available in M9.',
        },
      ],
      isError: true,
    }),
  )

  const sendEmail = tool(
    'send_email',
    'Send an email message. (Not yet implemented — coming in M10)',
    {
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body text'),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Not implemented yet. Email channel will be available in M10.',
        },
      ],
      isError: true,
    }),
  )

  return createSdkMcpServer({
    name: 'channels',
    tools: [sendWhatsapp, sendEmail],
  })
}
