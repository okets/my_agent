/**
 * Channel Binding Config Parser
 *
 * Reads channel bindings from the `channels:` section of config.yaml.
 * Only entries with a `transport` field are channel bindings.
 * Entries with a `plugin` field are old-format transport configs (ignored here).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { ChannelBinding } from './types.js'

const CONFIG_FILENAME = 'config.yaml'

/**
 * Load channel bindings from config.yaml.
 * Returns an empty array if no bindings exist.
 */
export function loadChannelBindings(agentDir: string): ChannelBinding[] {
  const configPath = join(agentDir, CONFIG_FILENAME)

  if (!existsSync(configPath)) {
    return []
  }

  let yaml: Record<string, unknown>
  try {
    yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
  } catch {
    return []
  }

  if (!yaml.channels || typeof yaml.channels !== 'object') {
    return []
  }

  const channelsSection = yaml.channels as Record<string, unknown>
  const bindings: ChannelBinding[] = []

  for (const [key, value] of Object.entries(channelsSection)) {
    if (typeof value !== 'object' || value === null) continue

    const entry = value as Record<string, unknown>

    // Only parse entries with 'transport' field (new-format bindings)
    // Skip entries with 'plugin' field (old-format transport configs)
    if (!entry.transport) continue

    const binding: ChannelBinding = {
      id: key,
      transport: entry.transport as string,
      ownerIdentity: ((entry.ownerIdentity ?? entry.owner_identity) as string) ?? '',
      ownerJid: ((entry.ownerJid ?? entry.owner_jid) as string) ?? '',
      previousOwner: (entry.previousOwner ?? entry.previous_owner) as string | undefined,
    }

    bindings.push(binding)
  }

  return bindings
}
