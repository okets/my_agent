import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createBrainQuery, streamResponse } from './brain.js'
import { loadConfig } from './config.js'
import { assembleSystemPrompt } from './prompt.js'
import { runHatching, findAgentDir, isHatched, allSteps } from './hatching/index.js'

async function singleShot(message: string): Promise<void> {
  const config = loadConfig()
  const systemPrompt = await assembleSystemPrompt(config.brainDir)
  const q = createBrainQuery(message, { systemPrompt })
  await streamResponse(q)
  console.log()
}

function matchCommand(input: string): string | null {
  const match = input.trim().match(/^\/my-agent:(\S+)/)
  return match ? match[1] : null
}

async function handleCommand(
  commandName: string,
  rl: readline.Interface,
  agentDir: string,
): Promise<boolean> {
  const step = allSteps.find((s) => s.name === commandName)
  if (!step) {
    console.log(`Unknown command: /my-agent:${commandName}`)
    console.log('Available commands:')
    for (const s of allSteps) {
      console.log(`  /my-agent:${s.name} — ${s.description}`)
    }
    return true
  }
  await step.run(rl, agentDir)
  return true
}

async function repl(): Promise<void> {
  const agentDir = findAgentDir()
  const rl = readline.createInterface({ input, output })

  try {
    if (!isHatched(agentDir)) {
      await runHatching(rl, agentDir)
    }

    const config = loadConfig()
    const systemPrompt = await assembleSystemPrompt(config.brainDir)

    console.log('Brain REPL started. Type "exit" or Ctrl+C to quit.\n')

    let isFirstTurn = true
    while (true) {
      const userInput = await rl.question('> ')
      if (userInput.trim().toLowerCase() === 'exit') break
      if (!userInput.trim()) continue

      const command = matchCommand(userInput)
      if (command) {
        await handleCommand(command, rl, agentDir)
        continue
      }

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
