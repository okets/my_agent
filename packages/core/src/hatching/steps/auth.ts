import * as readline from 'node:readline/promises'
import { validateSetupToken, writeAuthFile, type AuthProfile } from '../../auth.js'
import type { HatchingStep } from '../index.js'

const AUTH_METHODS: Record<string, string> = {
  '1': 'API key (pay-per-use billing)',
  '2': 'Claude subscription (Pro/Max)',
}

export const authStep: HatchingStep = {
  name: 'auth',
  description: 'Configure Anthropic authentication (API key or subscription)',
  required: true,
  async run(rl: readline.Interface, agentDir: string): Promise<void> {
    console.log('\n--- Authentication Setup ---\n')

    // Check for existing env vars
    if (process.env.ANTHROPIC_API_KEY) {
      const key = process.env.ANTHROPIC_API_KEY
      const preview = `${key.slice(0, 7)}...${key.slice(-4)}`
      console.log(`Found ANTHROPIC_API_KEY in environment (${preview}).`)
      const use = await rl.question('Use this key? (Y/n) ')
      if (!use.trim() || use.trim().toLowerCase().startsWith('y')) {
        console.log('\nUsing API key from environment.')
        return
      }
    }

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      const token = process.env.CLAUDE_CODE_OAUTH_TOKEN
      const preview = `${token.slice(0, 14)}...${token.slice(-4)}`
      console.log(`Found CLAUDE_CODE_OAUTH_TOKEN in environment (${preview}).`)
      const use = await rl.question('Use this token? (Y/n) ')
      if (!use.trim() || use.trim().toLowerCase().startsWith('y')) {
        console.log('\nUsing subscription token from environment.')
        return
      }
    }

    // Ask which method
    console.log('How do you want to authenticate with Anthropic?\n')
    console.log('  1. API key — pay-per-use from console.anthropic.com')
    console.log('  2. Claude subscription — use your Pro/Max plan\n')

    let method: string
    while (true) {
      const choice = await rl.question('Pick a number (1-2): ')
      const match = AUTH_METHODS[choice.trim()]
      if (match) {
        method = choice.trim()
        break
      }
      console.log('Invalid choice, please try again.')
    }

    let profile: AuthProfile

    if (method === '1') {
      // API key path
      let apiKey: string
      while (true) {
        const input = await rl.question('\nPaste your Anthropic API key: ')
        const key = input.trim()
        if (!key) {
          console.log('API key is required.')
          continue
        }
        if (!key.startsWith('sk-ant-')) {
          console.log('Expected API key starting with sk-ant-')
          continue
        }
        apiKey = key
        break
      }

      profile = {
        provider: 'anthropic',
        method: 'api_key',
        token: apiKey,
      }
    } else {
      // Subscription path
      console.log('\nTo generate a setup token:')
      console.log('  1. Open a terminal with Claude Code installed')
      console.log('  2. Run: claude setup-token')
      console.log('  3. Follow the browser auth flow')
      console.log('  4. Copy the generated token\n')

      let setupToken: string
      while (true) {
        const input = await rl.question('Paste your setup token: ')
        const token = input.trim()
        if (!token) {
          console.log('Token is required.')
          continue
        }
        const error = validateSetupToken(token)
        if (error) {
          console.log(error)
          continue
        }
        setupToken = token
        break
      }

      profile = {
        provider: 'anthropic',
        method: 'setup_token',
        token: setupToken,
      }
    }

    writeAuthFile(agentDir, profile)

    // Set env var for immediate use
    if (profile.method === 'api_key') {
      process.env.ANTHROPIC_API_KEY = profile.token
    } else {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = profile.token
    }

    console.log('\nAuthentication saved.')
  },
}
