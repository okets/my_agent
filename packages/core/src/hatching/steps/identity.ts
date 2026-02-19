import * as readline from 'node:readline/promises'
import * as path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { HatchingStep } from '../index.js'

function buildIdentityMd(nickname: string, fullName: string, purpose: string): string {
  return `# Identity

## User
- **Nickname:** ${nickname}
- **Full Name:** ${fullName}
- **Purpose:** ${purpose}

## Agent
- **Created:** ${new Date().toISOString().split('T')[0]}
- **Platform:** my_agent framework
`
}

function buildContactsMd(contacts: string): string {
  return `# Key People

${contacts}
`
}

export const identityStep: HatchingStep = {
  name: 'identity',
  description: 'Set your name, purpose, and key contacts',
  required: true,
  async run(rl: readline.Interface, agentDir: string): Promise<void> {
    console.log('\n--- Identity Setup ---\n')

    let nickname = ''
    while (!nickname.trim()) {
      nickname = await rl.question('What should I call you? (nickname) ')
      if (!nickname.trim()) {
        console.log('Nickname is required, please try again.')
      }
    }
    const fullNameInput = await rl.question('And your full name? (or press Enter to use nickname) ')
    const fullName = fullNameInput.trim() || nickname.trim()

    const purposeInput = await rl.question(
      'What do you mainly need help with? (work, personal, both, something specific?) ',
    )
    const purpose = purposeInput.trim() || 'General assistance'
    const contactsRaw = await rl.question(
      "Any key contacts I should know about? Name and relationship, or 'skip': ",
    )

    const coreDir = path.join(agentDir, 'brain', 'memory', 'core')
    await mkdir(coreDir, { recursive: true })

    await writeFile(
      path.join(coreDir, 'identity.md'),
      buildIdentityMd(nickname.trim(), fullName, purpose),
      'utf-8',
    )

    if (contactsRaw.trim().toLowerCase() !== 'skip' && contactsRaw.trim()) {
      const lines = contactsRaw
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => `- ${c}`)
        .join('\n')
      await writeFile(path.join(coreDir, 'contacts.md'), buildContactsMd(lines), 'utf-8')
      console.log('\nIdentity and contacts saved.')
    } else {
      console.log('\nIdentity saved.')
    }
  },
}
