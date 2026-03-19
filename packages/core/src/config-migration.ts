/**
 * Config Migration: channels → transports
 *
 * Auto-migrates config.yaml from the old format (channels section with 'plugin' field)
 * to the new format (transports + channels as bindings).
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'

const CONFIG_FILENAME = 'config.yaml'
const BACKUP_FILENAME = 'config.yaml.backup-pre-transport-split'

export interface MigrationResult {
  migrated: boolean
  warning?: string
}

/**
 * Detect if a channels entry is old format (has 'plugin' field)
 * vs new format (has 'transport' field — a channel binding).
 */
function isOldFormat(entries: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(entries)) {
    if (key === 'defaults') continue
    if (typeof value === 'object' && value !== null) {
      const entry = value as Record<string, unknown>
      if ('plugin' in entry) return true
      if ('transport' in entry) return false
    }
  }
  return false
}

/**
 * Migrate config.yaml from old channels format to new transports + channels format.
 *
 * Migration rules:
 * 1. Guard: if 'transports:' section already exists, skip
 * 2. Detect old format: 'channels:' entries have 'plugin' field
 * 3. Back up config.yaml
 * 4. Move entries from 'channels:' to 'transports:'
 * 5. If entry has ownerIdentities, create a channel binding
 * 6. Remove ownerIdentities/ownerJid from transport config
 */
export function migrateConfig(agentDir: string): MigrationResult {
  const configPath = join(agentDir, CONFIG_FILENAME)

  if (!existsSync(configPath)) {
    return { migrated: false }
  }

  let yaml: Record<string, unknown>
  try {
    yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
  } catch {
    return { migrated: false }
  }

  // Guard: if transports section already exists, skip
  if (yaml.transports) {
    return { migrated: false }
  }

  // Guard: no channels section
  if (!yaml.channels || typeof yaml.channels !== 'object') {
    return { migrated: false }
  }

  const channels = yaml.channels as Record<string, unknown>

  // Guard: check if this is already new-format channels (bindings with 'transport' field)
  if (!isOldFormat(channels)) {
    return { migrated: false }
  }

  // Back up before migration
  const backupPath = join(agentDir, BACKUP_FILENAME)
  copyFileSync(configPath, backupPath)

  // Migrate: move entries from channels to transports
  const transports: Record<string, unknown> = {}
  const newChannels: Record<string, unknown> = {}
  let warning: string | undefined

  for (const [key, value] of Object.entries(channels)) {
    if (key === 'defaults') {
      // Preserve defaults section
      transports.defaults = value
      continue
    }

    if (typeof value !== 'object' || value === null) continue
    const entry = { ...(value as Record<string, unknown>) }

    // Extract owner info before moving to transport
    const ownerIdentities = (entry.ownerIdentities ?? entry.owner_identities) as string[] | undefined
    const ownerJid = (entry.ownerJid ?? entry.owner_jid) as string | undefined

    // Remove owner fields from transport config
    delete entry.ownerIdentities
    delete entry.owner_identities
    delete entry.ownerJid
    delete entry.owner_jid

    // Move to transports
    transports[key] = entry

    // Create channel binding if owner exists
    if (ownerIdentities && ownerIdentities.length > 0) {
      if (ownerIdentities.length > 1) {
        warning = `Transport "${key}" had ${ownerIdentities.length} owner identities — using first: "${ownerIdentities[0]}"`
        console.warn(`[ConfigMigration] ${warning}`)
      }

      const bindingId = `${key}_binding`
      newChannels[bindingId] = {
        transport: key,
        ownerIdentity: ownerIdentities[0],
        ownerJid: ownerJid,
      }
    }
  }

  // Write migrated config
  yaml.transports = transports

  // Replace old channels with new bindings (or remove if no bindings)
  if (Object.keys(newChannels).length > 0) {
    yaml.channels = newChannels
  } else {
    delete yaml.channels
  }

  writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')

  console.log(`[ConfigMigration] Migrated config.yaml: ${Object.keys(transports).length} transport(s), ${Object.keys(newChannels).length} channel binding(s)`)

  return { migrated: true, warning }
}
