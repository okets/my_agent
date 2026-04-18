---
date: 2026-04-17
sprint: m9.6-s12
type: spike-results
author: Dev (fresh session)
status: needs-architect-review
gates: Task 2 onward
---

# S12 Spike Results: `PostToolUseFailure` Verification

Per `s12-plan.md` §Day-1 spike and `capability-resilience-v2.md` §6.1, this spike verifies whether the Claude Agent SDK's `PostToolUseFailure` hook (typed at `sdk.d.ts:1229-1236`) actually fires across the three MCP-plug failure modes named in the plan. The outcome gates Tasks 2–9.

**TL;DR:** Modes 1 and 2 route through `PostToolUseFailure` with full `tool_name` / `tool_input` / `tool_use_id` / `error` payload. **Mode 3 (server-never-started) does NOT fire any tool-level hook** — the MCP server's failure is surfaced only in the `init` system-message field `mcp_servers[].status` and the async RPC `q.mcpServerStatus()`. A secondary detection path is required for Mode 3.

## Setup

- **SDK version:** `@anthropic-ai/claude-agent-sdk@` (as vendored in `packages/core/node_modules/`). Type file at line ranges used:
  - `BaseHookInput` at `sdk.d.ts:99-112` — contains `session_id`.
  - `HOOK_EVENTS` tuple at `sdk.d.ts:397` — 21 event names, starting with `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, ...
  - `PostToolUseFailureHookInput` at `sdk.d.ts:1229-1236`: `{ hook_event_name: 'PostToolUseFailure', tool_name, tool_input, tool_use_id, error, is_interrupt? }`.
  - `McpServerStatus` at `sdk.d.ts:515-555` — status can be `'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'`.
  - `query().mcpServerStatus()` at `sdk.d.ts:1395` — async RPC returning the statuses.
- **Spike target:** a custom minimal MCP server (`test-mcp-server.mjs`, ~130 lines, no MCP SDK — bare JSON-RPC over stdio) exposing a single tool `test_tool`. Selected over breaking the real `browser-chrome` plug for safety and determinism.
- **Runner:** `spike-runner.mjs` — boots a fresh `query({ prompt, options })` per failure mode with the mock server wired as `mcpServers.spike` (stdio transport) and a catch-all hook attached to **every** `HookEvent` in `HOOK_EVENTS`.
- **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` loaded from `packages/dashboard/.env` (per project convention — no raw Anthropic API keys).
- **Model:** `claude-sonnet-4-5`.
- **Environment note:** initial runs failed inside the Claude Code session because the harness refuses nested sessions. Re-ran with `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`. All runs captured in `proposals/spike-workdir/spike-log-v3.txt`.

The three failure modes exercised by `MOCK_MODE` env:

| Mode | `MOCK_MODE` | Server behavior |
|---|---|---|
| 1. Tool-level exception | `throw` | Responds to `initialize` + `tools/list` correctly, then returns a JSON-RPC error (`code: -32000`) when `tools/call test_tool` arrives. |
| 2. Child process crash | `crash` | Responds correctly through handshake + tool registration, then self-exits with `process.exit(1)` 100 ms after receiving the first `tools/call`. |
| 3. Server-never-started | `never` | Exits with code 2 before responding to `initialize`. |

Spike artifacts:

- `docs/sprints/m9.6-capability-resilience/proposals/spike-workdir/test-mcp-server.mjs` — mock server.
- `docs/sprints/m9.6-capability-resilience/proposals/spike-workdir/spike-runner.mjs` — spike driver.
- `docs/sprints/m9.6-capability-resilience/proposals/spike-workdir/spike-log-v3.txt` — full hook + system-message trace.

## Failure Mode 1: Tool-level exception (`MOCK_MODE=throw`)

**SDK system init:** `mcp_servers: [{ name: "spike", status: "connected" }]`, `tools` includes `"mcp__spike__test_tool"`.
**`q.mcpServerStatus()`:** `status: "connected"`, `tools: [{ name: "test_tool" }]`.

**SDK hooks observed (in order):**

| Hook | Payload highlights |
|---|---|
| `UserPromptSubmit` | `session_id` |
| `PreToolUse` | `tool_name: "mcp__spike__test_tool"`, `tool_input: {"value":"spike"}`, `tool_use_id` |
| **`PostToolUseFailure`** | `tool_name: "mcp__spike__test_tool"`, `tool_input: {"value":"spike"}`, `tool_use_id`, `error: "MCP error -32000: Spike-induced tool error: validation failed on input.value"`, `is_interrupt: false` |
| `Stop` | `last_assistant_message: "The tool returned an MCP error …"` |

The server-originated error message is preserved verbatim in `error` (prefixed with `MCP error <code>:`).

**Routes through `PostToolUseFailure`:** **yes.**

## Failure Mode 2: Child process crash (`MOCK_MODE=crash`)

**SDK system init:** `mcp_servers: [{ name: "spike", status: "connected" }]`, `tools` includes `"mcp__spike__test_tool"` (the server WAS up during handshake).
**`q.mcpServerStatus()`:** `status: "connected"` at init time (the crash happens later, at first tool call).

**SDK hooks observed (in order):**

| Hook | Payload highlights |
|---|---|
| `UserPromptSubmit` | `session_id` |
| `PreToolUse` | `tool_name: "mcp__spike__test_tool"`, `tool_input: {"value":"spike"}`, `tool_use_id` |
| **`PostToolUseFailure`** | `tool_name: "mcp__spike__test_tool"`, `tool_input: {"value":"spike"}`, `tool_use_id`, `error: "MCP error -32000: Connection closed"`, `is_interrupt: false` |
| `Stop` | `last_assistant_message: "The MCP connection is closed."` |

The SDK reports the crash to the model as `MCP error -32000: Connection closed` — same error code as the tool-level throw, but a distinct, stable message substring. Classifier (`classifyMcpToolError` in Task 2) can discriminate: `/connection closed/i` → `execution-error` (or a new `transport-disconnected` symptom — recommend adding, see Additional hooks below).

**Routes through `PostToolUseFailure`:** **yes.**

## Failure Mode 3: Server-never-started (`MOCK_MODE=never`)

**SDK system init:** `mcp_servers: [{ name: "spike", status: "failed" }]`, `tools` does **NOT** include `"mcp__spike__test_tool"` (total 26, vs 27 in modes 1 & 2).
**`q.mcpServerStatus()`:** `status: "failed"`, `error: "MCP error -32000: Connection closed"`, `tools` absent.

**SDK hooks observed (in order):**

| Hook | Payload highlights |
|---|---|
| `UserPromptSubmit` | `session_id` |
| *(no `PreToolUse` / `PostToolUse` / `PostToolUseFailure` for the missing MCP tool)* | — |
| `Stop` | `last_assistant_message: "The tool \`mcp__spike__test_tool\` is not available in the current tool set."` |

When the model *did* attempt the call anyway (the prompt explicitly instructed it), the SDK returned an inline `tool_result` block marked `is_error: true` with content `<tool_use_error>Error: No such tool available: mcp__spike__test_tool</tool_use_error>` — but **no hook event fired** for that unknown-tool rejection. The SDK treats "tool not registered" as a client-side guard, not a `PostToolUseFailure`.

**Routes through `PostToolUseFailure`:** **no.**

**Signals available for Mode 3 detection:**

1. The `init` system message (first `type: "system"` frame in the query stream) carries `mcp_servers: [{ name, status }]`. A plug whose status is `failed` on init is the Mode 3 signature.
2. The async RPC `q.mcpServerStatus()` returns the full `McpServerStatus[]` including an `error` string. Can be polled at init or on-demand.
3. No `HookEvent` in `HOOK_EVENTS` fires for Mode 3. (`SessionStart` did not fire in `query()` mode either — likely because `query()` sessions bypass the interactive session-start path.)

## Conclusion

Per the plan's outcome table, this falls into the **"Some route through other events"** row:

> File spike-results.md AND a deviation proposal listing the additional hooks needed. Stop. Wait for architect adjudication before starting Task 2. Architect will commit scope expansions to this plan.

**Required action:** pause before Task 2. The dev is filing this spike-results.md and a paired deviation proposal (`proposals/s12-d1-mcp-never-started-detection.md` — to be written next). The architect adjudicates scope expansion: a second detection channel is required for Mode 3.

The first two modes (the common runtime failures — tool-level errors and child crashes) are both covered by `PostToolUseFailure` as designed. The architect's design §3.1 holds for those. Only Mode 3 needs an additional path.

## Additional hooks / signals needed (scope-expansion recommendation)

`PostToolUseFailure` alone cannot cover all three modes. Recommended augmentation, in order of complexity:

1. **MCP-init-status detector** (preferred, minimal):
   - Subscribe to the query's `type: "system", subtype: "init"` message as soon as it arrives.
   - For every entry in `mcp_servers` with `status === "failed" | "needs-auth" | "disabled"` whose `name` matches a known capability via `registry.findByName`, synthesize a CFR:
     - `symptom`: map `"failed"` → `execution-error` (or introduce `not-started`); `"needs-auth"` → `not-enabled`; `"disabled"` → `not-enabled`.
     - `detail`: the `error` string from `q.mcpServerStatus()` (enriched via the async RPC immediately after init — `McpServerStatus` has `error` while the init message only has `status`).
     - `triggeringInput.userUtterance`: empty or `"[mcp init]"` (no tool-call args exist).
     - `triggeringInput.artifact: undefined`.
   - Firing point: inside the session's message-consumer loop in `session-manager.ts` / `automation-executor.ts` (where the `for await (const msg of q)` loop already lives). One-shot per session; idempotent by `(name, sessionId)`.

2. **Transport-disconnect classifier refinement** (for Mode 2 fidelity):
   - Mode 2 fires `PostToolUseFailure` with `error: "MCP error -32000: Connection closed"`. Task 2's `classifyMcpToolError` regex map should recognize this substring and map to an appropriate symptom (either `execution-error` or a new `transport-disconnected`). Consider adding `/connection closed|transport closed/i → execution-error` to the regex map in `failure-symptoms.ts`.

3. **No additional `HookEvent` wiring is required.** The SDK does not expose Mode-3 detection as a hook — only as a message/RPC. So the detector in `mcp-cfr-detector.ts` should expose two entry points:
   - `hooks` (for Modes 1 & 2, per original design).
   - `processSystemInit(systemMessage)` / `processMcpStatus(statuses)` — a plain function the session manager calls from its message loop. This keeps CFR emission co-located and respects the "detection at the gates" rule (§0.2) — the gate simply widens to include system-init inspection alongside `PostToolUseFailure`.

Neither `SessionStart` nor `SessionEnd` nor `Setup` nor any other `HookEvent` fired during the spike runs, so none of them are viable as a Mode-3 channel.

## Follow-ups for S13+ (recommended, not blocking)

- **In-session late MCP crash.** The spike only exercised a crash triggered *by* a tool call. A server that crashes between tool calls (without a call to route through) would not fire `PostToolUseFailure`; it might not even surface in the init snapshot. Mid-session MCP status polling is a candidate for S13's reverify flow. Name in `s12-FOLLOW-UPS.md`.
- **`is_interrupt: true`.** The SDK's type has this field; neither Mode 1 nor Mode 2 set it true. Covered as a distinct branch (user-initiated abort) in S13 — call out in FOLLOW-UPS.
- **Unknown-tool `tool_result` with `is_error: true`.** The model's fallback call in Mode 3 produced such a block but no hook fire. If any CFR requires distinguishing "model hallucinated a tool" vs "MCP plug missing", that requires parsing `tool_result` blocks from the `user` message stream — out of scope for S12.

## Appendix A: Exact hook events observed, by mode

Captured verbatim from `spike-log-v3.txt`. The catch-all wired to all 21 `HookEvent` values in `HOOK_EVENTS` fired only the events below — no others.

- **Mode 1 (`throw`):** `UserPromptSubmit`, `PreToolUse`, `PostToolUseFailure`, `Stop`.
- **Mode 2 (`crash`):** `UserPromptSubmit`, `PreToolUse`, `PostToolUseFailure`, `Stop`.
- **Mode 3 (`never`):** `UserPromptSubmit`, `Stop`.

## Appendix B: `PostToolUseFailure` payload shape (observed vs type)

Type (`sdk.d.ts:1229-1236`):
```ts
type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
}
```

Observed (Mode 1):
```json
{
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "mcp__spike__test_tool",
  "tool_input": { "value": "spike" },
  "tool_use_id": "toolu_01RPohDZcfFPua4KvdZ9d5Cr",
  "error": "MCP error -32000: Spike-induced tool error: validation failed on input.value",
  "is_interrupt": false,
  "session_id": "a22f623b-0a6f-47d4-a076-c58e0cf72321"
}
```

Matches the type-def exactly. `session_id` comes from `BaseHookInput` — needed for the SessionContext lookup in Task 0.

## Appendix C: Caveats / spike limitations

- **`query()` vs persistent SDK session.** The spike used one-shot `query()` calls. The brain uses persistent sessions with `streamMessage` (see `packages/core/src/brain.ts`). `SessionStart` may fire in the persistent-session path. Architect should decide whether a follow-up run exercising `streamMessage` is required before Task 2 — if a `SessionStart` payload contains `mcp_servers`, it becomes a viable Mode-3 detection hook. If `SessionStart` does NOT carry MCP status, the init-message approach above is the fallback either way.
- **Mock server vs real `browser-chrome`.** Safer and deterministic; the JSON-RPC error shapes are part of the MCP protocol, not the server implementation, so results generalize. If the architect wants a corroborating run against real `browser-chrome` + Playwright, that is a day-2 follow-up.
- **Auth channel.** OAuth token used; behavior may differ for API-key auth. No evidence in SDK source that hook firing is auth-dependent, but worth noting.

— Spike author: Dev (fresh session, 2026-04-17). Awaiting architect adjudication per `s12-plan.md` §Day-1 spike gate.

---

## Mini-Spike: streamMessage + SessionStart (2026-04-18)

Follow-up to Appendix C's caveat: the Day-1 spike used one-shot `query({ prompt: <string> })`. The brain's `SessionManager.streamMessage` in `packages/dashboard/src/agent/session-manager.ts:474` uses `query()` with an async-iterable prompt plus `persistSession: true` + `includePartialMessages: true` — the SDK's streaming-input mode. This mini-spike exercises that exact pattern to determine whether `SessionStart` fires there (and if so, whether it carries `mcp_servers[].status`, which would yield a clean single-hook Mode-3 detection path).

### Setup

- **Runner:** `proposals/spike-workdir/spike-runner-stream.mjs` — builds an async-generator prompt that yields one `SDKUserMessage` (mirroring the session-manager's `content`/`streamMessage` path), sets `persistSession: true` + `includePartialMessages: true`, attaches catch-all hooks for every `HookEvent` in `HOOK_EVENTS`, and wires the Mode-3 mock server (`MOCK_MODE=never`) as `mcpServers.spike` (stdio transport).
- **SDK + auth + model:** identical to Day-1 (vendored SDK under `packages/core/node_modules/`, OAuth token from `packages/dashboard/.env`, `claude-sonnet-4-5`).
- **Run command:** `cp proposals/spike-workdir/spike-runner-stream.mjs packages/core/ && cd packages/core && env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT MOCK_MODE=never node ./spike-runner-stream.mjs`
- **Full log:** `proposals/spike-workdir/stream-spike-mode3.log`.

### SessionStart hook: fires in streamMessage?

**no.** Hooks observed in the streamMessage Mode-3 run (in order): `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreToolUse`, `PostToolUse`, `Stop`. Neither `SessionStart` nor `SessionEnd` nor `Setup` nor any of the other 17 `HookEvent` values fired. The catch-all hook attachment was verified in the summary's `hooksFired` array — only the six hook events above were recorded.

(The model-initiated `ToolSearch` calls explain the extra `PreToolUse` / `PostToolUse` pair vs the Day-1 Mode-3 trace: the model searched for `test_tool` via the deferred-tool registry before giving up. The mock MCP server's failure path is identical.)

### SessionStart payload: carries mcp_servers[].status?

**not applicable — SessionStart did not fire.** For reference the SDK type at `sdk.d.ts:2271-2276` is:
```ts
type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
  agent_type?: string;
  model?: string;
}
```
There is no `mcp_servers` field in the type. Even if `SessionStart` had fired, the payload shape alone confirms it could not have carried MCP status.

### Hooks observed for Mode 3 in streamMessage session

| Hook | Payload highlights |
|---|---|
| `UserPromptSubmit` | `prompt: "please use test_tool to process the value 'spike'"`, `session_id: "38d7f4f1-…"`, `cwd`, `permission_mode: "bypassPermissions"`, `transcript_path` |
| `PreToolUse` (×2) | `tool_name: "ToolSearch"` (model searched for the missing MCP tool; not the MCP tool itself) |
| `PostToolUse` (×2) | `tool_name: "ToolSearch"`, `tool_response: { matches: [], query: "test_tool", total_deferred_tools: 17 }` (and on retry `matches: ["CronCreate"]`) |
| `Stop` | `last_assistant_message: "I apologize for the confusion, but I didn't actually find a \"test_tool\"…"`, `stop_hook_active: false` |

As in the Day-1 Mode-3 run, no `PreToolUse` / `PostToolUse` / `PostToolUseFailure` fired for `mcp__spike__test_tool` itself — the SDK never surfaces the missing MCP tool as a hookable event.

### Raw message stream: init frame observed?

**yes** — and it carries the Mode-3 signature.

```json
{
  "subtype": "init",
  "mcp_servers": [{ "name": "spike", "status": "failed" }],
  "tools": ["ToolSearch"],
  "total_tools": 26,
  "session_id": "38d7f4f1-debe-4426-891b-b5ec99e3af36",
  "top_level_keys": ["type","subtype","cwd","session_id","tools","mcp_servers",
                     "model","permissionMode","slash_commands","apiKeySource",
                     "claude_code_version","output_style","agents","skills",
                     "plugins","uuid","fast_mode_state"]
}
```

`q.mcpServerStatus()` called immediately after the init frame returned:
```json
[{ "name": "spike", "status": "failed",
   "error": "MCP error -32000: Connection closed",
   "config": {...}, "scope": "dynamic" }]
```

Exactly the same Mode-3 signature as the Day-1 `query()` run: `mcp_servers[].status === "failed"` in the init message, plus a full error string available via the async RPC. Total tool count `26` (vs `27` on successful Modes 1/2) confirms the MCP tool was omitted from the registered tool set.

### Conclusion

**SessionStart does not fire in streamMessage() either — `processSystemInit()` from the message loop is confirmed as the only viable detection path.**

This eliminates the speculative "SessionStart might carry mcp_servers[].status in a persistent session" hypothesis flagged in Day-1's Appendix C. The detection path from the Day-1 spike's §"Additional hooks / signals needed" §1 ("MCP-init-status detector") is the path forward for Mode 3 in both `query()` (single-shot) and streamMessage (persistent) sessions alike. Both paths emit the same init system frame with `mcp_servers[]`, and both expose `q.mcpServerStatus()` for the enriched error string. The CFR detector's public surface should be:

- `hooks.PostToolUseFailure` — Modes 1 & 2 (per original design §3.1).
- `processSystemInit(systemMessage, queryHandle?)` — plain function the message-consumer loop calls on the first `system/init` frame; iterates `mcp_servers[]`, filters to known capability names via `registry.findByName`, optionally enriches with `q.mcpServerStatus()`, emits one CFR per failed plug (idempotent on `(name, session_id)`).

No additional `HookEvent` wiring required. Scope expansion deviation in `s12-d1-mcp-never-started-detection.md` stands as-is.

### Architect recommendation

_[to be filled in by architect after reading]_

