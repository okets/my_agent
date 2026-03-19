import * as path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import type { BrainConfig } from './types.js'
import type { TransportConfig, ReconnectPolicy } from './transports/types.js'
import { migrateConfig } from './config-migration.js'

/**
 * Default model IDs — versionless, always resolve to latest.
 * Users can override in config.yaml under `preferences.models`.
 */
export const DEFAULT_MODELS: ModelDefaults = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-6',
}

export interface ModelDefaults {
  sonnet: string
  haiku: string
  opus: string
}

const DEFAULT_MODEL = DEFAULT_MODELS.sonnet

const DEFAULT_RECONNECT: ReconnectPolicy = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.8,
  jitter: 0.25,
  maxAttempts: 50,
}

const DEFAULT_DEBOUNCE_MS = 0
export function findAgentDir(): string {
  // Walk up from cwd looking for an existing .my_agent/ directory
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, '.my_agent')
    if (existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  // No .my_agent/ found — default to project root (where .git lives)
  dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) {
      return path.join(dir, '.my_agent')
    }
    dir = path.dirname(dir)
  }
  // Fallback: cwd
  return path.resolve('.my_agent')
}

const DEFAULT_AGENT_DIR = findAgentDir()
const CONFIG_FILENAME = 'config.yaml'

interface YamlConfig {
  agent?: {
    name?: string // Legacy field for backward compatibility
    nickname?: string
    fullName?: string
  }
  brain?: {
    model?: string
    dir?: string
  }
  channels?: {
    defaults?: {
      reconnect?: Partial<ReconnectPolicy>
      debounceMs?: number
    }
    [key: string]: unknown
  }
  transports?: {
    defaults?: {
      reconnect?: Partial<ReconnectPolicy>
      debounceMs?: number
    }
    [key: string]: unknown
  }
  health?: {
    defaults?: { intervalMs?: number }
    plugins?: Record<string, { intervalMs?: number }>
  }
  embeddings?: YamlEmbeddingsConfig
  preferences?: {
    debrief?: {
      time?: string
      model?: string
    }
    timezone?: string
    models?: Partial<ModelDefaults>
    outboundChannel?: string
  }
}

/**
 * Embeddings plugin configuration for config.yaml.
 * Note: Named YamlEmbeddingsConfig to avoid collision with EmbeddingsConfig in memory/embeddings.
 */
export interface YamlEmbeddingsConfig {
  plugin: 'ollama' | 'local' | 'disabled'
  host?: string // Ollama only
  model?: string // Ollama only
}

function loadYamlConfig(agentDir: string): YamlConfig | null {
  const configPath = path.join(agentDir, CONFIG_FILENAME)
  if (!existsSync(configPath)) {
    return null
  }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return parse(raw) as YamlConfig
  } catch (err) {
    console.warn(
      `Warning: Could not parse ${configPath}: ${err instanceof Error ? err.message : String(err)}. Using defaults.`,
    )
    return null
  }
}

function loadTransportConfigs(yaml: YamlConfig | null): Record<string, TransportConfig> {
  // After migration, transports are in the 'transports:' section.
  // Fall back to 'channels:' for backward compatibility (pre-migration configs).
  const section = (yaml as any)?.transports ?? yaml?.channels
  if (!section) {
    return {}
  }

  const channelsSection = section
  const defaultsOverride = channelsSection.defaults as
    | {
        reconnect?: Partial<ReconnectPolicy>
        debounceMs?: number
      }
    | undefined

  const mergedReconnect: ReconnectPolicy = {
    ...DEFAULT_RECONNECT,
    ...(defaultsOverride?.reconnect ?? {}),
  }
  const mergedDebounce = defaultsOverride?.debounceMs ?? DEFAULT_DEBOUNCE_MS

  const result: Record<string, TransportConfig> = {}

  for (const [key, value] of Object.entries(channelsSection)) {
    if (key === 'defaults') continue

    const entryYaml = value as Record<string, unknown>

    const config: TransportConfig = {
      id: key,
      plugin: (entryYaml.plugin as string) ?? '',
      role: (entryYaml.role as 'dedicated' | 'personal') ?? 'dedicated',
      identity: (entryYaml.identity as string) ?? '',
      processing: (entryYaml.processing as 'immediate' | 'on_demand') ?? 'immediate',
      owner: entryYaml.owner as string | undefined,
      escalation: entryYaml.escalation as string | undefined,
      permissions: entryYaml.permissions as string[] | undefined,
      authDir: (entryYaml.authDir ?? entryYaml.auth_dir) as string | undefined,
      reconnect: {
        ...mergedReconnect,
        ...((entryYaml.reconnect as Partial<ReconnectPolicy>) ?? {}),
      },
      debounceMs: (entryYaml.debounceMs ?? entryYaml.debounce_ms ?? mergedDebounce) as number,
      ownerIdentities: (entryYaml.ownerIdentities ?? entryYaml.owner_identities) as
        | string[]
        | undefined,
      ownerJid: (entryYaml.ownerJid ?? entryYaml.owner_jid) as string | undefined,
    }

    const knownKeys = new Set([
      'id',
      'plugin',
      'role',
      'identity',
      'processing',
      'owner',
      'escalation',
      'permissions',
      'authDir',
      'auth_dir',
      'reconnect',
      'debounceMs',
      'debounce_ms',
      'ownerIdentities',
      'owner_identities',
      'ownerJid',
      'owner_jid',
    ])

    for (const [k, v] of Object.entries(entryYaml)) {
      if (!knownKeys.has(k)) {
        config[k] = v
      }
    }

    result[key] = config
  }

  return result
}

/**
 * Load the agent's nickname (short name for casual use).
 * Falls back to legacy `name` field, then to 'Agent'.
 */
export function loadAgentNickname(agentDir?: string): string {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(dir)
  return yaml?.agent?.nickname ?? yaml?.agent?.name ?? 'Agent'
}

/**
 * Load the agent's full name (for formal use).
 * Falls back to nickname, then legacy `name`, then 'Agent'.
 */
export function loadAgentFullName(agentDir?: string): string {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(dir)
  return yaml?.agent?.fullName ?? yaml?.agent?.nickname ?? yaml?.agent?.name ?? 'Agent'
}

/**
 * Load agent name (backward compatibility alias for fullName).
 * @deprecated Use loadAgentFullName() or loadAgentNickname() instead.
 */
export function loadAgentName(agentDir?: string): string {
  return loadAgentFullName(agentDir)
}

export function loadConfig(): BrainConfig {
  const agentDir = process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR

  // Run config migration before loading (channels → transports)
  migrateConfig(agentDir)

  const yaml = loadYamlConfig(agentDir)

  return {
    model: process.env.MY_AGENT_MODEL ?? yaml?.brain?.model ?? DEFAULT_MODEL,
    brainDir:
      process.env.MY_AGENT_BRAIN_DIR ??
      (yaml?.brain?.dir ? path.resolve(agentDir, yaml.brain.dir) : path.join(agentDir, 'brain')),
    transports: loadTransportConfigs(yaml),
    health: yaml?.health,
  }
}

/**
 * Load embeddings configuration.
 * Priority: config.yaml > OLLAMA_HOST env var > defaults
 */
export function loadEmbeddingsConfig(agentDir?: string): YamlEmbeddingsConfig {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(dir)

  // If config.yaml has embeddings section, use it
  if (yaml?.embeddings) {
    return {
      plugin: yaml.embeddings.plugin ?? 'disabled',
      host: yaml.embeddings.host,
      model: yaml.embeddings.model,
    }
  }

  // Migration: if OLLAMA_HOST env var set but no config, migrate it
  const envHost = process.env.OLLAMA_HOST
  if (envHost) {
    return {
      plugin: 'ollama',
      host: envHost,
      model: 'nomic-embed-text',
    }
  }

  // Default: disabled
  return { plugin: 'disabled' }
}

/**
 * Save embeddings configuration to config.yaml.
 */
export function saveEmbeddingsConfig(embeddings: YamlEmbeddingsConfig, agentDir?: string): void {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const configPath = path.join(dir, CONFIG_FILENAME)

  let yaml: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
    } catch {
      yaml = {}
    }
  }

  yaml.embeddings = embeddings
  writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')
}

/**
 * Save transport config to config.yaml.
 * Merges data into the existing transport entry (if any),
 * preserving fields not present in data.
 */
export function saveTransportToConfig(
  transportId: string,
  data: Record<string, unknown>,
  agentDir?: string,
): void {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const configPath = path.join(dir, CONFIG_FILENAME)

  let yaml: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
    } catch {
      yaml = {}
    }
  }

  if (!yaml.transports || typeof yaml.transports !== 'object') {
    yaml.transports = {}
  }

  const transports = yaml.transports as Record<string, unknown>
  const existing = (transports[transportId] as Record<string, unknown>) ?? {}
  transports[transportId] = { ...existing, ...data }

  writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')
}

/** @deprecated Use saveTransportToConfig */
export const saveChannelToConfig = saveTransportToConfig

export interface DebriefPreferences {
  time: string
  model: string
}

export interface UserPreferences {
  debrief: DebriefPreferences
  timezone: string
  outboundChannel: string
}

const DEFAULT_PREFERENCES: UserPreferences = {
  debrief: { time: '08:00', model: 'sonnet' },
  timezone: 'UTC',
  outboundChannel: 'web',
}

/**
 * Load user preferences from config.yaml.
 * Returns defaults for any missing fields.
 */
export function loadPreferences(agentDir?: string): UserPreferences {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(dir)
  if (!yaml?.preferences) return { ...DEFAULT_PREFERENCES, debrief: { ...DEFAULT_PREFERENCES.debrief } }

  const p = yaml.preferences
  const db = p.debrief ?? {}

  return {
    debrief: {
      time: db.time ?? DEFAULT_PREFERENCES.debrief.time,
      model: db.model ?? DEFAULT_PREFERENCES.debrief.model,
    },
    timezone: p.timezone ?? DEFAULT_PREFERENCES.timezone,
    outboundChannel: p.outboundChannel ?? DEFAULT_PREFERENCES.outboundChannel,
  }
}

/**
 * Load model IDs from config.yaml, falling back to defaults.
 * Users override in config.yaml under `preferences.models`.
 */
export function loadModels(agentDir?: string): ModelDefaults {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(dir)
  const overrides = yaml?.preferences?.models

  return {
    sonnet: overrides?.sonnet ?? DEFAULT_MODELS.sonnet,
    haiku: overrides?.haiku ?? DEFAULT_MODELS.haiku,
    opus: overrides?.opus ?? DEFAULT_MODELS.opus,
  }
}

/**
 * Remove a transport from config.yaml
 */
export function removeTransportFromConfig(
  transportId: string,
  agentDir?: string,
): void {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const configPath = path.join(dir, CONFIG_FILENAME)

  if (!existsSync(configPath)) {
    return
  }

  let yaml: Record<string, unknown> = {}
  try {
    yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
  } catch {
    return
  }

  if (!yaml.transports || typeof yaml.transports !== 'object') {
    return
  }

  const transports = yaml.transports as Record<string, unknown>
  delete transports[transportId]

  writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')
}

/** @deprecated Use removeTransportFromConfig */
export const removeChannelFromConfig = removeTransportFromConfig
