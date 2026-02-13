import * as path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { BrainConfig } from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
function findAgentDir(): string {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, '.my_agent')
    if (existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  return path.resolve('.my_agent')
}

const DEFAULT_AGENT_DIR = findAgentDir()
const CONFIG_FILENAME = 'config.yaml'

interface YamlConfig {
  brain?: {
    model?: string
    dir?: string
  }
}

function loadYamlConfig(agentDir: string): YamlConfig | null {
  try {
    const raw = readFileSync(path.join(agentDir, CONFIG_FILENAME), 'utf-8')
    return parse(raw) as YamlConfig
  } catch {
    return null
  }
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
