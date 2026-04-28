# Decisions Log — M9.4-S4.2

## D1: SDK role-assumption verified — bare prompts are user-role; `[SYSTEM:]` wrap is textual only

**Date:** 2026-04-27
**Question:** does the Agent SDK distinguish user-role bare prompts from `[SYSTEM:]`-wrapped ones at the role level, or only at the textual level?

**Method:** read SDK type declarations directly at `packages/core/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. Context7 didn't surface an authoritative entry for `@anthropic-ai/claude-agent-sdk` (only third-party docs/SDKs); going to the installed type definitions was both faster and more authoritative. Per CTO directive (Q3 answer), `claude-api` skill is for `@anthropic-ai/sdk` (raw API), not the Agent SDK — not a valid substitute.

**Findings:**

1. `query({ prompt: string | AsyncIterable<SDKUserMessage>, options? }): Query` (`sdk.d.ts:1473-1476`).
   - When `prompt` is a string, the SDK constructs a single user-role turn from it.

2. `SDKUserMessage` is **explicitly** typed (`sdk.d.ts:2219-2228`):
   ```ts
   export declare type SDKUserMessage = {
       type: 'user';
       message: MessageParam;
       parent_tool_use_id: string | null;
       isSynthetic?: boolean;
       ...
   };
   ```
   The `type: 'user'` is fixed — no programmatic way for caller to set anything else via the public surface.

3. `SDKSystemMessage` exists but is emitted **by** the SDK (session_init, status events), **not** received from the caller. There is no caller-side affordance for `system`-role turns at the message-input level.

4. Dashboard call chain confirms:
   `streamMessage(content)` → `createBrainQuery(content, opts)` → `query({ prompt: content, options })` (`brain.ts:64-157`).
   The string passes through verbatim — no SDK auto-prefix transforms it.

**Conclusion:**

The load-bearing claim of M9.4-S4.2 is **verified**. Specifically:

- The role of the injected turn does not change between `streamMessage("[SYSTEM: do X]")` and `streamMessage("do X")`. Both arrive at the model as a single user-role turn.
- The `[SYSTEM: ]` wrap is purely **textual content inside the user-role turn**, not a role marker the SDK interprets.
- The behavioral difference between the two — Nina dismissing the first as "background context" and the planned action-request principle treating the second as "request-to-fulfill" — is therefore explained entirely by textual pragmatics: how the model interprets the framing of the turn's content, not by any role-level distinction.

This is exactly the lever the sprint claims to pull: shift the textual framing from "system-status-note" to "user-action-request" so the model's response loop selects the request-fulfilling behavior over the context-acknowledging behavior.

**Implication for the plan:**

- `injectActionRequest(prompt)` simply calls `streamMessage(prompt)` with no wrap. No new SDK surface, no role parameter needed.
- The pre-flight gate (Task 2) is **PASSED** — proceed to Task 3.

**Citations:**
- `/home/nina/my_agent/packages/core/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1473-1476` (query signature)
- `/home/nina/my_agent/packages/core/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2219-2228` (SDKUserMessage)
- `/home/nina/my_agent-s4.2/packages/core/src/brain.ts:64-157` (createBrainQuery → query passthrough)
- `/home/nina/my_agent-s4.2/packages/dashboard/src/agent/session-manager.ts:666-793` (streamMessage internals — confirms `content` flows directly to `createBrainQuery`)

**No scratch probe written** — type declarations are authoritative. Probing would be necessary only if the SDK had a hidden role-detection on prompt content (e.g., regex-based promotion of `[SYSTEM: ]` to a system message), which the type surface and observed `query()` semantics rule out.

---

## D2: Standing-orders changes require a service restart

**Date:** 2026-04-27

`SystemPromptBuilder.getStablePrompt()` caches the assembled identity+skills+notebook prompt for the lifetime of a `SessionManager`. `standing-orders.md` is loaded inside that cached block. Edits to the file take effect only on the next session creation OR after `invalidateCache()` is called.

**Decision (this sprint):**

- After Task 11 edits `~/my_agent/.my_agent/notebook/reference/standing-orders.md` (deleted `## Brief Requirements`, appended `## Conversation Voice`), restart `nina-dashboard.service` immediately so the new system prompt loads on the next conversation turn.
- `invalidateCache()` already exists publicly on `SystemPromptBuilder` (line 239) — no API change needed. A future hot-reload (file watcher → invalidateCache) would build on this.
- **Cache invariant (documented contract):** any code path that mutates files contributing to layers 1–2 of the system prompt must either restart the dashboard or call `app.sessionRegistry.forEach(s => s.promptBuilder.invalidateCache())`. Without this, edits are silently ignored until the next session boundary.

**Why not hot-reload now:**

Hot-reload would require a file watcher on the brain/notebook directories plus an iteration over all open `SessionManager` instances. The plan keeps scope tight; restart-on-edit is sufficient for this sprint and matches existing operational practice (M9.4-S4.1 used the same pattern).

**Verification:**

```
systemctl --user restart nina-dashboard.service
journalctl --user -u nina-dashboard.service -n 30 --no-pager
```

Confirmed `active (running)`, no errors, WhatsApp transport reconnected. New system prompt loads on next conversation turn.

---

## D3: PROACTIVE_DELIVERY_AS_ACTION_REQUEST feature flag — routing only

**Date:** 2026-04-27 (planned for Task 13)

The flag controls *only* the routing decision in `conversation-initiator.ts` (`sendActionRequest` vs `sendSystemMessage`). It does NOT preserve obsolete prompt text.

- `formatNotification` always emits the new action-request prompt body.
- `[Pending Deliveries]` is always the system-prompt section name.
- If the flag is set to `0`, the new prompts get delivered through the old (system-role) injection path — strictly different from S4.1 behaviour, but provides a config-only path back if user-role injection itself is the problem (e.g. if Nina pivots mid-answer over the soak window).

**Default ON.** Set to `0` in `packages/dashboard/.env` and restart if Task 16 (live soak) reveals a regression. Plan to remove the flag after 14 days of clean operation post-soak (= 21 days from merge).

---

## D4: User-authored automation manifests need explicit deliverable validators

**Date:** 2026-04-28 (Soak Day-1 follow-up)

The `generic` and `research` todo templates (S4.2 Task 5) include a Write-tool-only deliverable todo with `validation: deliverable_written`. But automations with **inline todos** in their manifest (like `daily-relocation-session.md`) override the template, and those inline todos may not include the validator. Day-1 surfaced this: the relocation worker emitted a 100% narration deliverable; the validator regex didn't match (separately fixed by L1); but more fundamentally **the validator was never asked to run** because the manifest's inline todos didn't reference it.

**Decision (this round):** audit user-authored manifests one-by-one. Patch `daily-relocation-session.md` (the failing one) plus any other `notify: immediate` / `notify: debrief` automation with inline todos and no validator.

**Audit performed 2026-04-28:**
- Total `notify: immediate` manifests with inline todos and no validator: 17
- Of those, 16 are `status: disabled` + `once: true` (already-run one-offs that won't fire again) — left as-is
- 1 is `status: active` + manual trigger (`coworking-spaces-chiang-mai`) — patched in place
- `daily-relocation-session` (the Day-1 failure) — patched in place
- All `notify: debrief` manifests with inline todos already attach the validator (zero gaps found)

**Future work (deferred — not this sprint):** at automation registration time, force-attach a `deliverable_written` validator to any manifest with `notify: immediate` or `notify: debrief` that doesn't already have one. Lifts the responsibility off the author. Tracked as L7 in the follow-up plan's "out of scope" section.
