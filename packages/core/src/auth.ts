const SETUP_TOKEN_PREFIX = 'sk-ant-oat01-'
const SETUP_TOKEN_MIN_LENGTH = 80

export interface ResolvedAuth {
  type: 'api_key' | 'setup_token'
  source: 'env'
}

export function validateSetupToken(token: string): string | null {
  if (!token.startsWith(SETUP_TOKEN_PREFIX)) {
    return `Expected token starting with ${SETUP_TOKEN_PREFIX}`
  }
  if (token.length < SETUP_TOKEN_MIN_LENGTH) {
    return 'Token looks too short; paste the full setup-token'
  }
  return null
}

export function resolveAuth(agentDir: string): ResolvedAuth {
  if (process.env.ANTHROPIC_API_KEY) {
    return { type: 'api_key', source: 'env' }
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { type: 'setup_token', source: 'env' }
  }
  throw new Error(
    'No Anthropic authentication configured. Use the dashboard to set up authentication.',
  )
}

export function isAuthenticated(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN)
}

export function clearAuth(): void {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
}
