import {
  query,
  type Query,
  type Options,
  type SDKUserMessage,
  type HookEvent,
  type HookCallbackMatcher,
  type AgentDefinition,
} from '@anthropic-ai/claude-agent-sdk'

export interface BrainSessionOptions {
  model: string
  systemPrompt?: string
  continue?: boolean
  includePartialMessages?: boolean
  /** Enable extended thinking (adaptive mode with high effort) */
  reasoning?: boolean
  /** MCP servers to attach (e.g., memory, channels, tasks) */
  mcpServers?: Options['mcpServers']
  /** Subagent definitions (e.g., researcher, executor, reviewer) */
  agents?: Record<string, AgentDefinition>
  /** Programmatic hooks for safety and auditing */
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>
}

/** Content block types for multimodal messages */
export type TextBlock = { type: 'text'; text: string }
export type ImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
export type ContentBlock = TextBlock | ImageBlock

/** Prompt can be plain text or content blocks (for images) */
export type PromptContent = string | ContentBlock[]

export function createBrainQuery(prompt: PromptContent, options: BrainSessionOptions): Query {
  // Debug logging to trace model flow
  console.log(`[Brain] createBrainQuery model: ${options.model}`)

  // Auth is resolved before this point (resolveAuth sets env vars).
  // This is a safety check in case createBrainQuery is called without resolving auth first.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error(
      'No Anthropic authentication configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, or run /my-agent:auth',
    )
  }

  // Build allowed tools list — add Task tool when agents are provided
  const allowedTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']
  if (options.agents && Object.keys(options.agents).length > 0) {
    allowedTools.push('Task')
  }

  const queryOptions: Options = {
    model: options.model,
    systemPrompt: options.systemPrompt,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    allowedTools,
  }

  // Wire MCP servers (memory, channels, tasks)
  if (options.mcpServers) {
    queryOptions.mcpServers = options.mcpServers
  }

  // Wire subagent definitions
  if (options.agents) {
    queryOptions.agents = options.agents
  }

  // Wire programmatic hooks
  if (options.hooks) {
    queryOptions.hooks = options.hooks
  }
  console.log(`[Brain] Full queryOptions: model=${queryOptions.model}`)
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

  // Handle content blocks (for images) vs plain text
  if (typeof prompt === 'string') {
    return query({ prompt, options: queryOptions })
  } else {
    // Convert content blocks to async iterable matching SDK streaming input pattern
    // See: https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
    async function* messageStream(): AsyncIterable<SDKUserMessage> {
      yield {
        type: 'user',
        message: {
          role: 'user',
          content: prompt,
        },
        // Required by SDK types but not used for simple queries
        parent_tool_use_id: null,
        session_id: '',
      } as SDKUserMessage
    }
    return query({ prompt: messageStream(), options: queryOptions })
  }
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
