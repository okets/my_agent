import * as path from 'node:path'
import { mkdir, writeFile, readdir, readFile, copyFile } from 'node:fs/promises'
import { stringify } from 'yaml'
import { writeAuthFile, validateSetupToken, type AuthProfile } from '../auth.js'

// ── Directory structure ──

export async function createDirectoryStructure(agentDir: string): Promise<void> {
  const dirs = [
    agentDir,
    path.join(agentDir, 'brain'),
    path.join(agentDir, 'brain', 'memory', 'core'),
    path.join(agentDir, 'brain', 'skills'),
  ]
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true })
  }
}

export async function writeMinimalConfig(agentDir: string, agentName?: string): Promise<void> {
  const config: Record<string, unknown> = {
    brain: {
      model: 'claude-sonnet-4-5-20250929',
    },
  }
  if (agentName) {
    config.agent = { name: agentName }
  }
  await writeFile(path.join(agentDir, 'config.yaml'), stringify(config), 'utf-8')
}

export async function writeHatchedMarker(agentDir: string): Promise<void> {
  await writeFile(
    path.join(agentDir, '.hatched'),
    `hatched: ${new Date().toISOString()}\n`,
    'utf-8',
  )
}

// ── Identity ──

export interface IdentityData {
  name: string
  purpose: string
  contacts?: string // comma-separated
}

function buildIdentityMd(userName: string, purpose: string): string {
  return `# Identity

## User
- **Name:** ${userName}
- **Purpose:** ${purpose}

## Agent
- **Created:** ${new Date().toISOString().split('T')[0]}
- **Platform:** my_agent framework
`
}

function buildContactsMd(contacts: string): string {
  return `# Key People

${contacts}
`
}

export async function writeIdentity(agentDir: string, data: IdentityData): Promise<void> {
  const coreDir = path.join(agentDir, 'brain', 'memory', 'core')
  await mkdir(coreDir, { recursive: true })

  await writeFile(
    path.join(coreDir, 'identity.md'),
    buildIdentityMd(data.name, data.purpose),
    'utf-8',
  )

  if (data.contacts && data.contacts.trim()) {
    const lines = data.contacts
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => `- ${c}`)
      .join('\n')
    await writeFile(path.join(coreDir, 'contacts.md'), buildContactsMd(lines), 'utf-8')
  }
}

// ── Personality ──

export interface PersonalityOption {
  name: string
  description: string
  emoji: string
  filename: string
}

const PERSONALITY_EMOJIS: Record<string, string> = {
  academic: '🎓',
  butler: '🎩',
  coach: '🎯',
  hacker: '⚡',
  operator: '⚙️',
  partner: '🤝',
}

const PERSONALITIES_DIR = path.resolve(import.meta.dirname, '../../defaults/personalities')

function extractDescription(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('<!--')) continue
    return trimmed
  }
  return ''
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export async function getPersonalities(): Promise<PersonalityOption[]> {
  const files = await readdir(PERSONALITIES_DIR)
  const options: PersonalityOption[] = []

  for (const file of files.sort()) {
    if (!file.endsWith('.md') || file === 'custom.md') continue
    const filename = file.replace('.md', '')
    const filePath = path.join(PERSONALITIES_DIR, file)
    const content = await readFile(filePath, 'utf-8')
    const name = capitalize(filename)
    options.push({
      name,
      description: extractDescription(content),
      emoji: PERSONALITY_EMOJIS[filename] || '🤖',
      filename,
    })
  }

  return options
}

export async function applyPersonality(agentDir: string, filename: string): Promise<void> {
  const brainDir = path.join(agentDir, 'brain')
  await mkdir(brainDir, { recursive: true })
  const claudeMdPath = path.join(brainDir, 'CLAUDE.md')
  const sourcePath = path.resolve(PERSONALITIES_DIR, `${filename}.md`)
  if (!sourcePath.startsWith(PERSONALITIES_DIR)) {
    throw new Error(`Invalid personality filename: ${filename}`)
  }
  await copyFile(sourcePath, claudeMdPath)
}

export async function writeCustomPersonality(agentDir: string, text: string): Promise<void> {
  const brainDir = path.join(agentDir, 'brain')
  await mkdir(brainDir, { recursive: true })
  const claudeMdPath = path.join(brainDir, 'CLAUDE.md')
  const customPath = path.join(PERSONALITIES_DIR, 'custom.md')
  const template = await readFile(customPath, 'utf-8')

  // Replace the placeholder or append to template
  const content = text.trim() ? text : template
  await writeFile(claudeMdPath, content, 'utf-8')
}

// ── Auth ──

export function checkEnvAuth(): { type: 'api_key' | 'oauth'; preview: string } | null {
  if (process.env.ANTHROPIC_API_KEY) {
    const key = process.env.ANTHROPIC_API_KEY
    const preview = `${key.slice(0, 7)}...${key.slice(-4)}`
    return { type: 'api_key', preview }
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const preview = `${token.slice(0, 14)}...${token.slice(-4)}`
    return { type: 'oauth', preview }
  }

  return null
}

export function saveAuth(agentDir: string, method: 'api_key' | 'setup_token', token: string): void {
  const profile: AuthProfile = {
    provider: 'anthropic',
    method,
    token,
  }

  writeAuthFile(agentDir, profile)

  // Set env var for immediate use
  if (method === 'api_key') {
    process.env.ANTHROPIC_API_KEY = token
  } else {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token
  }
}

export { validateSetupToken }

// ── Operating Rules ──

export interface OperatingRulesData {
  autonomy: string
  escalations: string
  style: string
}

function buildRulesSection(autonomy: string, escalations: string, style: string): string {
  return `

## Operating Rules

- **Autonomy:** ${autonomy}
- **Always escalate:** ${escalations}
- **Communication style:** ${style}
`
}

export async function writeOperatingRules(
  agentDir: string,
  data: OperatingRulesData,
): Promise<void> {
  const brainDir = path.join(agentDir, 'brain')
  await mkdir(brainDir, { recursive: true })
  const claudeMdPath = path.join(brainDir, 'CLAUDE.md')

  let existing = ''
  try {
    existing = await readFile(claudeMdPath, 'utf-8')
  } catch {
    // File may not exist yet
  }

  const rulesSection = buildRulesSection(
    data.autonomy,
    data.escalations || 'Nothing specified — use best judgment',
    data.style,
  )

  await writeFile(claudeMdPath, existing + rulesSection, 'utf-8')
}
