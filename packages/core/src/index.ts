import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createBrainQuery, streamResponse } from './brain.js'
import { loadConfig } from './config.js'
import { assembleSystemPrompt } from './prompt.js'

async function singleShot(message: string): Promise<void> {
  const config = loadConfig()
  const systemPrompt = await assembleSystemPrompt(config.brainDir)
  const q = createBrainQuery(message, { systemPrompt })
  await streamResponse(q)
  console.log()
}

async function repl(): Promise<void> {
  const config = loadConfig()
  const systemPrompt = await assembleSystemPrompt(config.brainDir)
  const rl = readline.createInterface({ input, output })

  console.log('Brain REPL started. Type "exit" or Ctrl+C to quit.\n')

  try {
    let isFirstTurn = true
    while (true) {
      const userInput = await rl.question('> ')
      if (userInput.trim().toLowerCase() === 'exit') break
      if (!userInput.trim()) continue

      const q = createBrainQuery(userInput, {
        systemPrompt,
        continue: !isFirstTurn,
      })
      await streamResponse(q)
      console.log('\n')
      isFirstTurn = false
    }
  } finally {
    rl.close()
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length > 0) {
    await singleShot(args.join(' '))
  } else {
    await repl()
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
