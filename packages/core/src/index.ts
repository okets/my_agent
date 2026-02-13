import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createBrainQuery, streamResponse } from './brain.js'
import { loadConfig, findAgentDir } from './config.js'
import { assembleSystemPrompt } from './prompt.js'
import { resolveAuth } from './auth.js'
import { runHatching, isHatched, allSteps } from './hatching/index.js'

async function singleShot(message: string): Promise<void> {
  const agentDir = findAgentDir()
  if (!isHatched(agentDir)) {
    console.log('Agent not set up yet. Run `npm run brain` (without arguments) to start setup.')
    process.exit(1)
  }

  resolveAuth(agentDir)
  const config = loadConfig()
  const systemPrompt = await assembleSystemPrompt(config.brainDir)
  try {
    const q = createBrainQuery(message, { model: config.model, systemPrompt })
    await streamResponse(q)
    console.log()
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
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
  const step = allSteps.find((s) => s.name.toLowerCase() === commandName.toLowerCase())
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

    resolveAuth(agentDir)
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

      try {
        const q = createBrainQuery(userInput, {
          model: config.model,
          systemPrompt,
          continue: !isFirstTurn,
        })
        await streamResponse(q)
        console.log('\n')
        isFirstTurn = false
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err))
      }
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
