import * as path from 'node:path'
import { mkdir, writeFile, readdir, readFile, copyFile } from 'node:fs/promises'
import { stringify } from 'yaml'
import { validateSetupToken } from '../auth.js'
import { DEFAULT_MODELS } from '../config.js'

// ── Directory structure ──

export async function createDirectoryStructure(agentDir: string): Promise<void> {
  const dirs = [
    agentDir,
    path.join(agentDir, 'brain'),
    path.join(agentDir, 'brain', 'memory', 'core'),
    path.join(agentDir, '.claude', 'skills'),
  ]
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true })
  }
}

export async function writeMinimalConfig(
  agentDir: string,
  agentIdentity?: { nickname: string; fullName?: string },
): Promise<void> {
  const config: Record<string, unknown> = {
    brain: {
      model: DEFAULT_MODELS.sonnet,
    },
  }
  if (agentIdentity) {
    config.agent = {
      nickname: agentIdentity.nickname,
      fullName: agentIdentity.fullName ?? agentIdentity.nickname,
    }
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
  nickname: string // Short name for casual use (e.g., "Alex")
  fullName?: string // Full name for formal use (e.g., "Alex Johnson"), defaults to nickname
  purpose: string
  contacts?: string // comma-separated
}

function buildIdentityMd(nickname: string, fullName: string, purpose: string): string {
  return `# Identity

## User
- **Nickname:** ${nickname}
- **Full Name:** ${fullName}
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

  const fullName = data.fullName ?? data.nickname
  await writeFile(
    path.join(coreDir, 'identity.md'),
    buildIdentityMd(data.nickname, fullName, data.purpose),
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
  const agentsMdPath = path.join(brainDir, 'AGENTS.md')
  const sourcePath = path.resolve(PERSONALITIES_DIR, `${filename}.md`)
  if (!sourcePath.startsWith(PERSONALITIES_DIR)) {
    throw new Error(`Invalid personality filename: ${filename}`)
  }
  await copyFile(sourcePath, agentsMdPath)
}

export async function writeCustomPersonality(agentDir: string, text: string): Promise<void> {
  const brainDir = path.join(agentDir, 'brain')
  await mkdir(brainDir, { recursive: true })
  const agentsMdPath = path.join(brainDir, 'AGENTS.md')
  const customPath = path.join(PERSONALITIES_DIR, 'custom.md')
  const template = await readFile(customPath, 'utf-8')

  // Replace the placeholder or append to template
  const content = text.trim() ? text : template
  await writeFile(agentsMdPath, content, 'utf-8')
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

export { validateSetupToken }

// ── Operating Rules ──
// NOTE: Operating rules are OPERATIONAL instructions, not identity.
// They live in notebook/reference/standing-orders.md, NOT in brain/AGENTS.md.
// brain/AGENTS.md is for identity only: who you are, your voice, your philosophy.

export interface OperatingRulesData {
  autonomy: string
  escalations: string
  style: string
}

function buildStandingOrders(autonomy: string, escalations: string, style: string): string {
  return `# Standing Orders

## Autonomy

${autonomy}

## Escalation Rules

**Always escalate:**
${escalations || 'Nothing specified — use best judgment'}

## Communication Style

${style}
`
}

export async function writeOperatingRules(
  agentDir: string,
  data: OperatingRulesData,
): Promise<void> {
  // Write to notebook/reference/standing-orders.md (operational, not identity)
  const notebookDir = path.join(agentDir, 'notebook', 'reference')
  await mkdir(notebookDir, { recursive: true })
  const standingOrdersPath = path.join(notebookDir, 'standing-orders.md')

  const content = buildStandingOrders(
    data.autonomy,
    data.escalations || 'Nothing specified — use best judgment',
    data.style,
  )

  await writeFile(standingOrdersPath, content, 'utf-8')
}
