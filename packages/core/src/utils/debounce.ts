/**
 * Message Debouncer
 *
 * Buffers rapid messages from the same sender into batched deliveries.
 * Media, replies, and control messages bypass the debouncer.
 */

export interface DebouncerOptions {
  /** Flush timeout in ms (messages are held this long before delivery) */
  flushMs: number
}

export interface DebouncedMessage<T> {
  /** The original message */
  message: T
  /** Whether this message should bypass debouncing */
  bypass: boolean
  /** Grouping key (e.g., "channelId:senderId") */
  key: string
}

export class MessageDebouncer<T> {
  private buffers = new Map<string, { messages: T[]; timer: ReturnType<typeof setTimeout> }>()
  private flushMs: number
  private onFlush: (key: string, messages: T[]) => void

  constructor(options: DebouncerOptions, onFlush: (key: string, messages: T[]) => void) {
    this.flushMs = options.flushMs
    this.onFlush = onFlush
  }

  /**
   * Add a message to the debouncer.
   * If bypass is true, flushes immediately (including any buffered messages for that key).
   */
  add(item: DebouncedMessage<T>): void {
    if (item.bypass) {
      // Flush any pending messages for this key first
      this.flushKey(item.key)
      // Then deliver this message immediately
      this.onFlush(item.key, [item.message])
      return
    }

    const existing = this.buffers.get(item.key)
    if (existing) {
      // Add to existing buffer and reset timer
      existing.messages.push(item.message)
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => this.flushKey(item.key), this.flushMs)
    } else {
      // Start new buffer with timer
      const timer = setTimeout(() => this.flushKey(item.key), this.flushMs)
      this.buffers.set(item.key, { messages: [item.message], timer })
    }
  }

  /**
   * Flush all buffered messages for a key.
   */
  private flushKey(key: string): void {
    const buffer = this.buffers.get(key)
    if (!buffer) return

    clearTimeout(buffer.timer)
    this.buffers.delete(key)

    if (buffer.messages.length > 0) {
      this.onFlush(key, buffer.messages)
    }
  }

  /**
   * Flush all pending buffers and clear timers.
   */
  flushAll(): void {
    for (const key of [...this.buffers.keys()]) {
      this.flushKey(key)
    }
  }

  /**
   * Clear all buffers without flushing.
   */
  clear(): void {
    for (const buffer of this.buffers.values()) {
      clearTimeout(buffer.timer)
    }
    this.buffers.clear()
  }

  /** Number of active debounce keys */
  get pendingCount(): number {
    return this.buffers.size
  }
}
