import { query, type Query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { loadConfig } from './config.js'

export interface BrainSessionOptions {
  model?: string
  systemPrompt?: string
  continue?: boolean
}

export function createBrainQuery(prompt: string, options?: BrainSessionOptions): Query {
  const config = loadConfig()
  const queryOptions: Options = {
    model: options?.model ?? config.model,
    systemPrompt: options?.systemPrompt,
  }
  if (options?.continue) {
    queryOptions.continue = true
  }
  return query({ prompt, options: queryOptions })
}

export async function streamResponse(q: Query): Promise<string> {
  let fullText = ''
  for await (const msg of q) {
    if (msg.type === 'assistant') {
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
