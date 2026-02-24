/**
 * Memory System Initialization
 * Creates notebook folder structure and migrates existing files.
 *
 * @module memory/init
 */

import { mkdir, readFile, writeFile, copyFile, access } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'

const NOTEBOOK_FOLDERS = ['lists', 'reference', 'knowledge', 'daily']

/**
 * Initialize the notebook directory structure.
 */
export async function initNotebook(agentDir: string): Promise<void> {
  const notebookDir = join(agentDir, 'notebook')

  // Create notebook and subdirectories
  for (const folder of NOTEBOOK_FOLDERS) {
    const folderPath = join(notebookDir, folder)
    await mkdir(folderPath, { recursive: true })
  }

  // Ensure brain directory exists for memory.db
  await mkdir(join(agentDir, 'brain'), { recursive: true })

  // Ensure cache/models directory exists for local embeddings
  await mkdir(join(agentDir, 'cache', 'models'), { recursive: true })
}

/**
 * Migrate existing runtime files to notebook structure.
 */
export async function migrateToNotebook(agentDir: string): Promise<string[]> {
  const migrated: string[] = []
  const notebookDir = join(agentDir, 'notebook')

  // Ensure notebook exists
  await initNotebook(agentDir)

  // Migration mappings: old path -> new path
  const migrations: Array<{ from: string; to: string }> = [
    {
      from: join(agentDir, 'runtime', 'standing-orders.md'),
      to: join(notebookDir, 'reference', 'standing-orders.md'),
    },
    {
      from: join(agentDir, 'runtime', 'external-communications.md'),
      to: join(notebookDir, 'reference', 'external-communications.md'),
    },
    {
      from: join(agentDir, 'brain', 'memory', 'core', 'contacts.md'),
      to: join(notebookDir, 'reference', 'contacts.md'),
    },
    {
      from: join(agentDir, 'brain', 'memory', 'core', 'preferences.md'),
      to: join(notebookDir, 'reference', 'preferences.md'),
    },
  ]

  for (const { from, to } of migrations) {
    if (existsSync(from) && !existsSync(to)) {
      try {
        await mkdir(dirname(to), { recursive: true })
        await copyFile(from, to)
        migrated.push(`${from} -> ${to}`)
      } catch (error) {
        console.error(`Failed to migrate ${from}:`, error)
      }
    }
  }

  return migrated
}

/**
 * Check if notebook needs migration.
 */
export async function needsMigration(agentDir: string): Promise<boolean> {
  const notebookDir = join(agentDir, 'notebook')

  // If notebook doesn't exist, might need migration
  if (!existsSync(notebookDir)) {
    // Check if old files exist
    const oldPaths = [
      join(agentDir, 'runtime', 'standing-orders.md'),
      join(agentDir, 'runtime', 'external-communications.md'),
      join(agentDir, 'brain', 'memory', 'core'),
    ]

    for (const path of oldPaths) {
      if (existsSync(path)) {
        return true
      }
    }
  }

  return false
}

/**
 * Create a starter notebook with example files.
 */
export async function createStarterNotebook(agentDir: string): Promise<void> {
  await initNotebook(agentDir)

  const notebookDir = join(agentDir, 'notebook')

  // Create starter files if they don't exist
  const starterFiles: Array<{ path: string; content: string }> = [
    {
      path: join(notebookDir, 'reference', 'contacts.md'),
      content: `# Contacts

Add contact information here. Nina can search and update this file.

## Example Contact

- Name: Example Person
- Email: example@email.com
- Notes: This is an example contact
`,
    },
    {
      path: join(notebookDir, 'reference', 'preferences.md'),
      content: `# Preferences

Your preferences and how you like things done.

## Communication

- Preferred response style: Direct and concise

## Schedule

- Add your typical schedule and preferences here
`,
    },
    {
      path: join(notebookDir, 'reference', 'standing-orders.md'),
      content: `# Standing Orders

Rules and instructions that Nina should always follow.

## Notifications

- Add rules about when and how to notify you
`,
    },
    {
      path: join(notebookDir, 'lists', 'todos.md'),
      content: `# To Do

- [ ] Set up your notebook preferences
- [ ] Add your contacts
`,
    },
    {
      path: join(notebookDir, 'knowledge', 'facts.md'),
      content: `# Facts

Things Nina has learned that might be useful later.

## Project Info

- Add project-specific facts here
`,
    },
  ]

  for (const { path, content } of starterFiles) {
    if (!existsSync(path)) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf-8')
    }
  }
}
