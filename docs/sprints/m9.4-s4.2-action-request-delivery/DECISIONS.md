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
