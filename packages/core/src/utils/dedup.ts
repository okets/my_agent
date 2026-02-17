/**
 * Message Deduplication Cache
 *
 * Map-based LRU + TTL cache for filtering duplicate messages.
 * Uses lazy pruning — entries are cleaned on insert when cache exceeds max size.
 */

export interface DedupOptions {
  /** Maximum number of entries (default: 5000) */
  maxEntries?: number
  /** Time-to-live in milliseconds (default: 20 minutes) */
  ttlMs?: number
}

const DEFAULT_MAX_ENTRIES = 5000
const DEFAULT_TTL_MS = 20 * 60 * 1000 // 20 minutes

export class DedupCache {
  private cache = new Map<string, number>() // key → timestamp
  private maxEntries: number
  private ttlMs: number

  constructor(options?: DedupOptions) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  }

  /**
   * Check if a key has been seen recently.
   * If not seen, marks it as seen and returns false (not a duplicate).
   * If seen within TTL, returns true (duplicate).
   */
  isDuplicate(key: string): boolean {
    const now = Date.now()

    // Check existing entry
    const existing = this.cache.get(key)
    if (existing !== undefined) {
      if (now - existing < this.ttlMs) {
        return true // Still within TTL — duplicate
      }
      // Expired — remove and re-add below
      this.cache.delete(key)
    }

    // Lazy prune if over capacity
    if (this.cache.size >= this.maxEntries) {
      this.prune(now)
    }

    // If still over capacity after pruning, evict oldest
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) {
        this.cache.delete(oldest)
      }
    }

    // Mark as seen
    this.cache.set(key, now)
    return false
  }

  /**
   * Remove entries that have expired.
   */
  private prune(now: number): void {
    for (const [key, timestamp] of this.cache) {
      if (now - timestamp >= this.ttlMs) {
        this.cache.delete(key)
      }
    }
  }

  /** Current cache size */
  get size(): number {
    return this.cache.size
  }

  /** Clear all entries */
  clear(): void {
    this.cache.clear()
  }
}
