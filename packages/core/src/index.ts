import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createBrainSession, streamResponse } from './brain.js'

async function singleShot(message: string): Promise<void> {
  const session = createBrainSession()
  try {
    await session.send(message)
    await streamResponse(session)
    console.log()
  } finally {
    session.close()
  }
}

async function repl(): Promise<void> {
  const session = createBrainSession()
  const rl = readline.createInterface({ input, output })

  console.log('Brain REPL started. Type "exit" or Ctrl+C to quit.\n')

  try {
    while (true) {
      const userInput = await rl.question('> ')
      if (userInput.trim().toLowerCase() === 'exit') break
      if (!userInput.trim()) continue

      await session.send(userInput)
      await streamResponse(session)
      console.log('\n')
    }
  } finally {
    rl.close()
    session.close()
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
