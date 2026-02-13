import * as readline from 'node:readline/promises'
import * as path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { stringify } from 'yaml'
import { identityStep } from './steps/identity.js'
import { personalityStep } from './steps/personality.js'
import { operatingRulesStep } from './steps/operating-rules.js'

export interface HatchingStep {
  name: string
  description: string
  required: boolean
  run(rl: readline.Interface, agentDir: string): Promise<void>
}

const requiredSteps: HatchingStep[] = [identityStep, personalityStep]

const optionalSteps: HatchingStep[] = [operatingRulesStep]

export const allSteps: HatchingStep[] = [...requiredSteps, ...optionalSteps]

async function createDirectoryStructure(agentDir: string): Promise<void> {
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

async function writeMinimalConfig(agentDir: string): Promise<void> {
  const config = {
    brain: {
      model: 'claude-sonnet-4-5-20250929',
    },
  }
  await writeFile(path.join(agentDir, 'config.yaml'), stringify(config), 'utf-8')
}

async function writeHatchedMarker(agentDir: string): Promise<void> {
  await writeFile(
    path.join(agentDir, '.hatched'),
    `hatched: ${new Date().toISOString()}\n`,
    'utf-8',
  )
}

export async function runHatching(rl: readline.Interface, agentDir: string): Promise<void> {
  console.log("\nWelcome! Let's set up your agent.\n")

  await createDirectoryStructure(agentDir)

  for (const step of requiredSteps) {
    await step.run(rl, agentDir)
  }

  const answer = await rl.question(
    '\nWant to complete full setup now, or continue later? (now/later) ',
  )

  if (answer.trim().toLowerCase().startsWith('n')) {
    for (const step of optionalSteps) {
      await step.run(rl, agentDir)
    }
  } else {
    console.log('\nYou can run these anytime in chat:')
    for (const step of optionalSteps) {
      console.log(`  /my-agent:${step.name} — ${step.description}`)
    }
    console.log()
  }

  await writeMinimalConfig(agentDir)
  await writeHatchedMarker(agentDir)

  console.log("You're all set!\n")
}

export function findAgentDir(): string {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, '.my_agent')
    if (existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  return path.resolve('.my_agent')
}

export function isHatched(agentDir: string): boolean {
  return existsSync(agentDir) && existsSync(path.join(agentDir, '.hatched'))
}
