import * as path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const AUTH_FILENAME = 'auth.json'
const SETUP_TOKEN_PREFIX = 'sk-ant-oat01-'
const SETUP_TOKEN_MIN_LENGTH = 80

export interface AuthProfile {
  provider: string
  method: 'api_key' | 'setup_token'
  token: string
}

interface AuthFile {
  version: number
  activeProfile: string
  profiles: Record<string, AuthProfile>
}

export interface ResolvedAuth {
  type: 'api_key' | 'setup_token'
  source: 'env' | 'file'
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

export function readAuthFile(agentDir: string): AuthFile | null {
  const filePath = path.join(agentDir, AUTH_FILENAME)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as AuthFile
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    console.warn(
      `Warning: Failed to read ${AUTH_FILENAME}: ${err instanceof Error ? err.message : String(err)}. ` +
        'Delete the file and run /my-agent:auth to reconfigure.',
    )
    return null
  }
}

export function writeAuthFile(agentDir: string, profile: AuthProfile): void {
  const filePath = path.join(agentDir, AUTH_FILENAME)
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true })
  }

  const existing = readAuthFile(agentDir)
  const authFile: AuthFile = existing ?? {
    version: 1,
    activeProfile: 'default',
    profiles: {},
  }

  authFile.profiles['default'] = profile
  authFile.activeProfile = 'default'

  writeFileSync(filePath, JSON.stringify(authFile, null, 2) + '\n', 'utf-8')
}

export function resolveAuth(agentDir: string): ResolvedAuth {
  // 1. Env var override — always wins
  if (process.env.ANTHROPIC_API_KEY) {
    return { type: 'api_key', source: 'env' }
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { type: 'setup_token', source: 'env' }
  }

  // 2. Auth file
  const authFile = readAuthFile(agentDir)
  const profileName = authFile?.activeProfile?.trim()
  if (profileName && authFile?.profiles[profileName]) {
    const profile = authFile.profiles[profileName]

    // Set the appropriate env var so the SDK picks it up
    if (profile.method === 'api_key') {
      process.env.ANTHROPIC_API_KEY = profile.token
    } else {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = profile.token
    }

    return { type: profile.method, source: 'file' }
  }

  // 3. No auth found
  throw new Error(
    'No Anthropic authentication configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, or run /my-agent:auth',
  )
}
