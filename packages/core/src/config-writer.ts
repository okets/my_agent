/**
 * Config Writer — Serialized Async Write Queue
 *
 * All config.yaml mutations go through this queue to ensure
 * read-modify-write operations are sequential and race-free.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'

const CONFIG_FILENAME = 'config.yaml'

export class ConfigWriter {
  private agentDir: string
  private queue: Promise<void> = Promise.resolve()

  constructor(agentDir: string) {
    this.agentDir = agentDir
  }

  /**
   * Apply a mutation to config.yaml through the serialized queue.
   * The mutator receives the parsed YAML object and modifies it in place.
   */
  async write(mutator: (yaml: Record<string, unknown>) => void): Promise<void> {
    // Chain onto the queue to ensure sequential execution
    const operation = this.queue.then(() => {
      const configPath = join(this.agentDir, CONFIG_FILENAME)

      let yaml: Record<string, unknown> = {}
      if (existsSync(configPath)) {
        try {
          yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
        } catch {
          yaml = {}
        }
      }

      mutator(yaml)

      writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')
    })

    this.queue = operation.catch(() => {
      // Swallow errors in the queue chain so subsequent writes aren't blocked
    })

    // But still propagate the error to the caller
    return operation
  }

  /**
   * Save/merge transport config into transports section.
   */
  async saveTransport(transportId: string, data: Record<string, unknown>): Promise<void> {
    return this.write((yaml) => {
      if (!yaml.transports || typeof yaml.transports !== 'object') {
        yaml.transports = {}
      }
      const transports = yaml.transports as Record<string, unknown>
      const existing = (transports[transportId] as Record<string, unknown>) ?? {}
      transports[transportId] = { ...existing, ...data }
    })
  }

  /**
   * Remove a transport from transports section.
   */
  async removeTransport(transportId: string): Promise<void> {
    return this.write((yaml) => {
      if (yaml.transports && typeof yaml.transports === 'object') {
        delete (yaml.transports as Record<string, unknown>)[transportId]
      }
    })
  }

  /**
   * Save/merge a channel binding into channels section.
   */
  async saveChannelBinding(bindingId: string, data: Record<string, unknown>): Promise<void> {
    return this.write((yaml) => {
      if (!yaml.channels || typeof yaml.channels !== 'object') {
        yaml.channels = {}
      }
      const channels = yaml.channels as Record<string, unknown>
      const existing = (channels[bindingId] as Record<string, unknown>) ?? {}
      channels[bindingId] = { ...existing, ...data }
    })
  }

  /**
   * Remove a channel binding from channels section.
   */
  async removeChannelBinding(bindingId: string): Promise<void> {
    return this.write((yaml) => {
      if (yaml.channels && typeof yaml.channels === 'object') {
        delete (yaml.channels as Record<string, unknown>)[bindingId]
      }
    })
  }
}
