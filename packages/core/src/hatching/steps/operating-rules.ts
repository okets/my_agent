import * as readline from 'node:readline/promises'
import * as path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { HatchingStep } from '../index.js'

const AUTONOMY_OPTIONS: Record<string, string> = {
  '1': 'Conservative — always ask before acting',
  '2': 'Balanced — ask for external actions, handle internal tasks independently',
  '3': 'Autonomous — act freely and report after',
}

const STYLE_OPTIONS: Record<string, string> = {
  '1': 'Concise — brief and direct',
  '2': 'Detailed — thorough explanations',
  '3': 'Adaptive — matches context',
}

function buildRulesSection(autonomy: string, escalations: string, style: string): string {
  return `

## Operating Rules

- **Autonomy:** ${autonomy}
- **Always escalate:** ${escalations}
- **Communication style:** ${style}
`
}

export const operatingRulesStep: HatchingStep = {
  name: 'operating-rules',
  description: 'Configure autonomy level, escalation rules, and communication style',
  required: false,
  async run(rl: readline.Interface, agentDir: string): Promise<void> {
    console.log('\n--- Operating Rules ---\n')

    console.log('How autonomous should your agent be?')
    console.log('  1. Conservative — always ask before acting')
    console.log('  2. Balanced — ask for external actions, handle internal tasks independently')
    console.log('  3. Autonomous — act freely and report after')
    const autonomyChoice = await rl.question('\nPick a number (1-3): ')
    const autonomy = AUTONOMY_OPTIONS[autonomyChoice.trim()] ?? AUTONOMY_OPTIONS['2']

    const escalations = await rl.question(
      '\nWhat should always be escalated to you? (e.g., financial decisions, external communications): ',
    )

    console.log('\nCommunication style preference?')
    console.log('  1. Concise — brief and direct')
    console.log('  2. Detailed — thorough explanations')
    console.log('  3. Adaptive — matches context')
    const styleChoice = await rl.question('\nPick a number (1-3): ')
    const style = STYLE_OPTIONS[styleChoice.trim()] ?? STYLE_OPTIONS['3']

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
      autonomy,
      escalations.trim() || 'Nothing specified — use best judgment',
      style,
    )

    await writeFile(claudeMdPath, existing + rulesSection, 'utf-8')
    console.log('\nOperating rules saved.')
  },
}
