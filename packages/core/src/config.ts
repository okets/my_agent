import * as path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { BrainConfig } from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
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
  }
}
