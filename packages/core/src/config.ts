import * as path from 'node:path'
import type { BrainConfig } from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
const DEFAULT_BRAIN_DIR = path.resolve('.my_agent/brain')

export function loadConfig(): BrainConfig {
  return {
    model: process.env.MY_AGENT_MODEL ?? DEFAULT_MODEL,
    brainDir: process.env.MY_AGENT_BRAIN_DIR ?? DEFAULT_BRAIN_DIR,
  }
}
