import * as readline from 'node:readline/promises'
import * as path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { HatchingStep } from '../index.js'

function buildIdentityMd(userName: string, purpose: string): string {
  return `# Identity

## User
- **Name:** ${userName}
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

    const userName = await rl.question("What's your name? ")
    const purpose = await rl.question(
      'What do you mainly need help with? (work, personal, both, something specific?) ',
    )
    const contactsRaw = await rl.question(
      "Any key contacts I should know about? Name and relationship, or 'skip': ",
    )

    const coreDir = path.join(agentDir, 'brain', 'memory', 'core')
    await mkdir(coreDir, { recursive: true })

    await writeFile(
      path.join(coreDir, 'identity.md'),
      buildIdentityMd(userName.trim(), purpose.trim()),
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
