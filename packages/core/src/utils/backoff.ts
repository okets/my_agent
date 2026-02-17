/**
 * Exponential Backoff Utility
 *
 * Computes delay for reconnection attempts with jitter.
 */

import type { ReconnectPolicy } from '../channels/types.js'

/** Default reconnect policy */
export const DEFAULT_BACKOFF: ReconnectPolicy = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.8,
  jitter: 0.25,
  maxAttempts: 50,
}

/**
 * Compute backoff delay for a given attempt number.
 *
 * @param policy - Reconnect policy configuration
 * @param attempt - Zero-based attempt number
 * @returns Delay in milliseconds, or null if maxAttempts exceeded
 */
export function computeBackoff(policy: ReconnectPolicy, attempt: number): number | null {
  if (attempt >= policy.maxAttempts) return null

  const base = policy.initialMs * Math.pow(policy.factor, attempt)
  const capped = Math.min(base, policy.maxMs)

  // Apply jitter: ±jitter% of the computed delay
  const jitterRange = capped * policy.jitter
  const jitterOffset = (Math.random() * 2 - 1) * jitterRange

  return Math.round(capped + jitterOffset)
}
