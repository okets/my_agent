/**
 * Dashboard environment flags.
 *
 * Read once at module load (process.env is set by `--env-file=.env` in the
 * systemd unit). Tests may override these by mutating process.env *before*
 * importing the module that consumes them; vitest module-cache reset is
 * handled per-test via vi.resetModules() when needed.
 */

/**
 * M9.4-S4.2 — proactive deliveries (alert/initiate, brief, scheduled
 * sessions, `notify: immediate` job completions) route through
 * `sendActionRequest` (user-role, no `[SYSTEM:]` wrap) instead of the
 * legacy `sendSystemMessage`.
 *
 * Default: ON (any value other than the literal string "0" enables the new
 * routing). Set `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` in
 * `packages/dashboard/.env` and restart the dashboard to roll back to S4.1
 * behaviour while keeping the new prompt content. The flag controls
 * routing only — `formatNotification` always emits the new prompt body
 * regardless of the flag's value.
 */
export function proactiveDeliveryAsActionRequest(): boolean {
  return process.env.PROACTIVE_DELIVERY_AS_ACTION_REQUEST !== "0";
}
