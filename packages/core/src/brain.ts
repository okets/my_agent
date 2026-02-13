import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { loadConfig } from './config.js'

export function createBrainSession(model?: string) {
  const config = loadConfig()
  return unstable_v2_createSession({ model: model ?? config.model })
}

export async function streamResponse(
  session: ReturnType<typeof createBrainSession>,
): Promise<string> {
  let fullText = ''
  for await (const msg of session.stream()) {
    if (msg.type === 'assistant') {
      const text = msg.message.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { type: string; text?: string }) => block.text ?? '')
        .join('')
      process.stdout.write(text.slice(fullText.length))
      fullText = text
    }
  }
  return fullText
}
