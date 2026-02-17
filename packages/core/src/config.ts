import * as path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
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
    name?: string
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

    const channelYaml = value as Partial<ChannelInstanceConfig>

    const config: ChannelInstanceConfig = {
      id: key,
      plugin: channelYaml.plugin ?? '',
      role: channelYaml.role ?? 'dedicated',
      identity: channelYaml.identity ?? '',
      processing: channelYaml.processing ?? 'immediate',
      owner: channelYaml.owner,
      escalation: channelYaml.escalation,
      permissions: channelYaml.permissions,
      authDir: channelYaml.authDir,
      reconnect: {
        ...mergedReconnect,
        ...(channelYaml.reconnect ?? {}),
      },
      watchdog: {
        ...mergedWatchdog,
        ...(channelYaml.watchdog ?? {}),
      },
      debounceMs: channelYaml.debounceMs ?? mergedDebounce,
    }

    for (const [k, v] of Object.entries(channelYaml)) {
      if (
        k !== 'id' &&
        k !== 'plugin' &&
        k !== 'role' &&
        k !== 'identity' &&
        k !== 'processing' &&
        k !== 'owner' &&
        k !== 'escalation' &&
        k !== 'permissions' &&
        k !== 'authDir' &&
        k !== 'reconnect' &&
        k !== 'watchdog' &&
        k !== 'debounceMs'
      ) {
        config[k] = v
      }
    }

    result[key] = config
  }

  return result
}

export function loadAgentName(agentDir?: string): string {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(dir)
  return yaml?.agent?.name ?? 'Agent'
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
