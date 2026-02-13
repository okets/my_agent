import * as readline from 'node:readline/promises'
import * as path from 'node:path'
import { readdir, readFile, copyFile, mkdir } from 'node:fs/promises'
import type { HatchingStep } from '../index.js'

const PERSONALITIES_DIR = path.resolve(import.meta.dirname, '../../../defaults/personalities')

interface PersonalityOption {
  name: string
  description: string
  filePath: string
}

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

async function loadPersonalities(): Promise<PersonalityOption[]> {
  const files = await readdir(PERSONALITIES_DIR)
  const options: PersonalityOption[] = []

  for (const file of files.sort()) {
    if (!file.endsWith('.md') || file === 'custom.md') continue
    const filePath = path.join(PERSONALITIES_DIR, file)
    const content = await readFile(filePath, 'utf-8')
    const name = capitalize(file.replace('.md', ''))
    options.push({ name, description: extractDescription(content), filePath })
  }

  return options
}

export const personalityStep: HatchingStep = {
  name: 'personality',
  description: "Choose your agent's personality archetype",
  required: true,
  async run(rl: readline.Interface, agentDir: string): Promise<void> {
    console.log('\n--- Personality Setup ---\n')

    const personalities = await loadPersonalities()

    console.log('Choose a personality for your agent:\n')
    for (let i = 0; i < personalities.length; i++) {
      console.log(`  ${i + 1}. ${personalities[i].name} — ${personalities[i].description}`)
    }
    const writeYourOwn = personalities.length + 1
    console.log(`  ${writeYourOwn}. Write your own\n`)

    const answer = await rl.question(`Pick a number (1-${writeYourOwn}): `)
    const choice = parseInt(answer.trim(), 10)

    const brainDir = path.join(agentDir, 'brain')
    await mkdir(brainDir, { recursive: true })
    const claudeMdPath = path.join(brainDir, 'CLAUDE.md')

    if (choice >= 1 && choice <= personalities.length) {
      const selected = personalities[choice - 1]
      await copyFile(selected.filePath, claudeMdPath)
      console.log(`\n${selected.name} personality applied.`)
    } else {
      const customPath = path.join(PERSONALITIES_DIR, 'custom.md')
      await copyFile(customPath, claudeMdPath)
      console.log('\nCustom template copied to brain/CLAUDE.md — edit it to make it yours.')
    }
  },
}
