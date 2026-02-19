import * as path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import type { BrainConfig } from './types.js'
import type { ChannelInstanceConfig, ReconnectPolicy, WatchdogConfig } from './channels/types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'

const DEFAULT_RECONNECT: ReconnectPolicy = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.8,
  jitter: 0.25,
  maxAttempts: 50,
}

const DEFAULT_WATCHDOG: WatchdogConfig = {
  enabled: true,
  checkIntervalMs: 60000,
  timeoutMs: 1800000,
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
      watchdog?: Partial<WatchdogConfig>
      debounceMs?: number
    }
    [key: string]: unknown
  }
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

function loadChannelConfigs(yaml: YamlConfig | null): Record<string, ChannelInstanceConfig> {
  if (!yaml?.channels) {
    return {}
  }

  const channelsSection = yaml.channels
  const defaultsOverride = channelsSection.defaults as
    | {
        reconnect?: Partial<ReconnectPolicy>
        watchdog?: Partial<WatchdogConfig>
        debounceMs?: number
      }
    | undefined

  const mergedReconnect: ReconnectPolicy = {
    ...DEFAULT_RECONNECT,
    ...(defaultsOverride?.reconnect ?? {}),
  }
  const mergedWatchdog: WatchdogConfig = {
    ...DEFAULT_WATCHDOG,
    ...(defaultsOverride?.watchdog ?? {}),
  }
  const mergedDebounce = defaultsOverride?.debounceMs ?? DEFAULT_DEBOUNCE_MS

  const result: Record<string, ChannelInstanceConfig> = {}

  for (const [key, value] of Object.entries(channelsSection)) {
    if (key === 'defaults') continue

    const channelYaml = value as Record<string, unknown>

    const config: ChannelInstanceConfig = {
      id: key,
      plugin: (channelYaml.plugin as string) ?? '',
      role: (channelYaml.role as 'dedicated' | 'personal') ?? 'dedicated',
      identity: (channelYaml.identity as string) ?? '',
      processing: (channelYaml.processing as 'immediate' | 'on_demand') ?? 'immediate',
      owner: channelYaml.owner as string | undefined,
      escalation: channelYaml.escalation as string | undefined,
      permissions: channelYaml.permissions as string[] | undefined,
      authDir: (channelYaml.authDir ?? channelYaml.auth_dir) as string | undefined,
      reconnect: {
        ...mergedReconnect,
        ...((channelYaml.reconnect as Partial<ReconnectPolicy>) ?? {}),
      },
      watchdog: {
        ...mergedWatchdog,
        ...((channelYaml.watchdog as Partial<WatchdogConfig>) ?? {}),
      },
      debounceMs: (channelYaml.debounceMs ?? channelYaml.debounce_ms ?? mergedDebounce) as number,
      ownerIdentities: (channelYaml.ownerIdentities ?? channelYaml.owner_identities) as
        | string[]
        | undefined,
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
      'watchdog',
      'debounceMs',
      'debounce_ms',
      'ownerIdentities',
      'owner_identities',
    ])

    for (const [k, v] of Object.entries(channelYaml)) {
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
  const yaml = loadYamlConfig(agentDir)

  return {
    model: process.env.MY_AGENT_MODEL ?? yaml?.brain?.model ?? DEFAULT_MODEL,
    brainDir:
      process.env.MY_AGENT_BRAIN_DIR ??
      (yaml?.brain?.dir ? path.resolve(agentDir, yaml.brain.dir) : path.join(agentDir, 'brain')),
    channels: loadChannelConfigs(yaml),
  }
}

/**
 * Save channel config to config.yaml.
 * Merges channelData into the existing channel entry (if any),
 * preserving fields not present in channelData.
 */
export function saveChannelToConfig(
  channelId: string,
  channelData: Record<string, unknown>,
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

  if (!yaml.channels || typeof yaml.channels !== 'object') {
    yaml.channels = {}
  }

  const channels = yaml.channels as Record<string, unknown>
  const existing = (channels[channelId] as Record<string, unknown>) ?? {}
  channels[channelId] = { ...existing, ...channelData }

  writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')
}
