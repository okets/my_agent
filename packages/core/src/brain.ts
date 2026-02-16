import { query, type Query, type Options } from '@anthropic-ai/claude-agent-sdk'

export interface BrainSessionOptions {
  model: string
  systemPrompt?: string
  continue?: boolean
  includePartialMessages?: boolean
  /** Enable extended thinking (adaptive mode with high effort) */
  reasoning?: boolean
}

export function createBrainQuery(prompt: string, options: BrainSessionOptions): Query {
  // Auth is resolved before this point (resolveAuth sets env vars).
  // This is a safety check in case createBrainQuery is called without resolving auth first.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error(
      'No Anthropic authentication configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, or run /my-agent:auth',
    )
  }

  const queryOptions: Options = {
    model: options.model,
    systemPrompt: options.systemPrompt,
    permissionMode: 'bypassPermissions',
  }
  if (options.continue) {
    queryOptions.continue = true
  }
  if (options.includePartialMessages) {
    queryOptions.includePartialMessages = true
  }
  // Extended thinking configuration
  if (options.reasoning) {
    queryOptions.thinking = { type: 'adaptive' }
    queryOptions.effort = 'high'
  } else {
    queryOptions.thinking = { type: 'disabled' }
  }
  return query({ prompt, options: queryOptions })
}

export async function streamResponse(q: Query): Promise<string> {
  let fullText = ''
  for await (const msg of q) {
    if (msg.type === 'assistant') {
      // Filter for text content blocks — the SDK may return other block types
      // (e.g., tool_use, thinking) that don't have a text field.
      const text = msg.message.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { type: string; text?: string }) => block.text ?? '')
        .join('')
      process.stdout.write(text.slice(fullText.length))
      fullText = text
    }
    if (msg.type === 'result') break
  }
  return fullText
}
