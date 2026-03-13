import * as readline from 'node:readline/promises'
import * as path from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
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
    let autonomy: string
    while (true) {
      const autonomyChoice = await rl.question('\nPick a number (1-3): ')
      const match = AUTONOMY_OPTIONS[autonomyChoice.trim()]
      if (match) {
        autonomy = match
        break
      }
      console.log('Invalid choice, please try again.')
    }

    const escalations = await rl.question(
      '\nWhat should always be escalated to you? (e.g., financial decisions, external communications): ',
    )

    console.log('\nCommunication style preference?')
    console.log('  1. Concise — brief and direct')
    console.log('  2. Detailed — thorough explanations')
    console.log('  3. Adaptive — matches context')
    let style: string
    while (true) {
      const styleChoice = await rl.question('\nPick a number (1-3): ')
      const match = STYLE_OPTIONS[styleChoice.trim()]
      if (match) {
        style = match
        break
      }
      console.log('Invalid choice, please try again.')
    }

    // Operating rules are OPERATIONAL, not identity — write to standing-orders, not CLAUDE.md
    const notebookDir = path.join(agentDir, 'notebook', 'reference')
    await mkdir(notebookDir, { recursive: true })
    const standingOrdersPath = path.join(notebookDir, 'standing-orders.md')

    const rulesSection = buildRulesSection(
      autonomy,
      escalations.trim() || 'Nothing specified — use best judgment',
      style,
    )

    await writeFile(standingOrdersPath, `# Standing Orders\n${rulesSection}`, 'utf-8')
    console.log('\nOperating rules saved to standing-orders.md.')

    // ── Morning brief preferences ──
    console.log('\n--- Morning Brief ---\n')

    const briefTimeRaw = await rl.question(
      'What time should your morning brief be delivered? (HH:MM, default 08:00): ',
    )
    const briefTime = briefTimeRaw.trim() || '08:00'

    const timezoneRaw = await rl.question(
      'What is your timezone? (e.g. Europe/Paris, America/New_York, UTC — default UTC): ',
    )
    const timezone = timezoneRaw.trim() || 'UTC'

    const briefModel = 'sonnet'

    // Write preferences to config.yaml using raw YAML read/write pattern
    const configPath = path.join(agentDir, 'config.yaml')
    let yaml: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      try {
        yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
      } catch {
        yaml = {}
      }
    }

    yaml.preferences = {
      morningBrief: {
        time: briefTime,
        model: briefModel,
        channel: 'default',
      },
      timezone,
    }

    writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')
    console.log(`\nMorning brief preferences saved (${briefTime} ${timezone}, model: ${briefModel}).`)
  },
}
