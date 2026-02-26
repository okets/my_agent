# M6.5-S1: SDK Enhancement — Sprint Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. MUST invoke claude-developer-platform skill before any Agent SDK work.

> **Milestone:** M6.5 Agent SDK Alignment
> **Sprint:** S1 — SDK Enhancement (Additive)
> **Status:** Planned
> **Design Spec:** [Agent SDK TS README](https://github.com/anthropics/claude-agent-sdk-typescript), Agent SDK plugin docs

---

## Goal

Enhance the brain with native Agent SDK features: custom MCP tools, subagents, programmatic hooks, settingSources evaluation, and a CLAUDE.md guardrail for future sessions. All changes are **additive** — they extend brain.ts without breaking existing flows.

## Architecture

The brain currently uses only built-in file system tools (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`). This sprint wires in the SDK's MCP server pattern for custom tools, `agents` option for subagent delegation, programmatic `hooks` for runtime safety, and evaluates `settingSources` for native prompt/settings loading. The existing `createBrainQuery()` function becomes the central point where all these options converge.

## Tech Stack

- `@anthropic-ai/claude-agent-sdk` (existing dependency)
- `createSdkMcpServer`, `tool()` from SDK
- `zod` for tool input schemas
- Existing `packages/core/src/memory/tools.ts` (memory tool implementations)

---

## Scope

**In Scope:**
- MCP server pattern with memory tools live, channel + task tools as stubs
- Domain-separated MCP servers (memory, channels, tasks)
- Subagent definitions (research, execute, review) wired into brain
- Trust-tiered hook factory (`brain`, `task`, `subagent` levels)
- `settingSources` evaluation and prompt.ts simplification assessment
- CLAUDE.md rule for Agent SDK skill usage

**Out of Scope:**
- Session management rewrite (S2)
- Channel tool implementation (M9/M10)
- Full task tool implementation (future)
- Skills ecosystem installation (separate work)

---

## Tasks

### T1: MCP Tool Infrastructure + Memory Server

**Owner:** Backend Dev
**Files:**
- Create: `packages/core/src/mcp/memory-server.ts`
- Create: `packages/core/src/mcp/types.ts`
- Create: `packages/core/src/mcp/index.ts`
- Modify: `packages/core/src/brain.ts` — add `mcpServers` to query options
- Modify: `packages/core/src/lib.ts` — export new modules
- Test: `packages/core/tests/mcp-memory.test.ts`

**Step 1: Define MCP types and server factory**

Create `packages/core/src/mcp/types.ts`:
```typescript
import type { z } from 'zod'

export interface MCPServerConfig {
  name: string
  tools: MCPToolDefinition[]
}

export type MCPToolDefinition = ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').tool>
```

Create `packages/core/src/mcp/index.ts` to export all MCP modules.

**Step 2: Wrap existing memory tools as MCP tools**

Create `packages/core/src/mcp/memory-server.ts`:
- Import `tool`, `createSdkMcpServer` from Agent SDK
- Import existing memory functions from `packages/core/src/memory/tools.ts`
- Define 5 tools: `remember`, `recall`, `daily_log`, `notebook_read`, `notebook_write`
- Each tool wraps the existing implementation with zod input schema
- Return `createSdkMcpServer("memory", { tools: [...] })`

**Step 3: Wire MCP server into brain.ts**

Modify `createBrainQuery()` to accept `mcpServers` option:
```typescript
const queryOptions: Options = {
  // ...existing options
  mcpServers: {
    memory: createMemoryServer(memoryService),
  }
}
```

**Step 4: Create stub servers for channels and tasks**

Create `packages/core/src/mcp/channel-server.ts` — exports `createChannelServer()` returning server with stub tools (`send_whatsapp`, `send_email`) that return "Not implemented yet".

Create `packages/core/src/mcp/task-server.ts` — exports `createTaskServer()` with stub tools (`create_task`, `update_task`).

**Step 5: Write tests**

Test that:
- Memory MCP server creates successfully
- `remember` tool accepts topic + content, calls through to memory service
- `recall` tool accepts query, returns search results
- Stub servers create without error, return "Not implemented" messages

**Step 6: Run tests, commit**

---

### T2: Subagent Definitions

**Owner:** Backend Dev
**Files:**
- Create: `packages/core/src/agents/definitions.ts`
- Create: `packages/core/src/agents/index.ts`
- Modify: `packages/core/src/brain.ts` — add `agents` to query options
- Test: `packages/core/tests/agents.test.ts`

**Step 1: Define core agent types**

Create `packages/core/src/agents/definitions.ts`:
```typescript
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'

export const coreAgents: Record<string, AgentDefinition> = {
  'researcher': {
    description: 'Investigates issues, searches codebases, gathers information. Read-only.',
    prompt: 'You are a research specialist. Gather information thoroughly and return a concise summary of findings. Do not make changes.',
    tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
  },
  'executor': {
    description: 'Implements changes, writes code, runs commands.',
    prompt: 'You are an implementation specialist. Make the requested changes precisely. Run tests after changes.',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  },
  'reviewer': {
    description: 'Reviews code and output for quality, security, and correctness.',
    prompt: 'You are a code reviewer focused on security vulnerabilities, logic errors, and code quality. Provide specific line-level feedback.',
    tools: ['Read', 'Glob', 'Grep'],
  },
}
```

**Step 2: Wire into brain.ts**

Add `agents` and `Task` tool to query options:
```typescript
const queryOptions: Options = {
  // ...existing options
  allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Task'],
  agents: coreAgents,
}
```

**Step 3: Write tests**

Test that:
- `coreAgents` object has expected keys
- Each agent has description, prompt, and tools array
- Tools arrays contain only valid built-in tool names

**Step 4: Commit**

---

### T3: Trust-Tiered Hook Factory

**Owner:** Backend Dev
**Files:**
- Create: `packages/core/src/hooks/factory.ts`
- Create: `packages/core/src/hooks/audit.ts`
- Create: `packages/core/src/hooks/safety.ts`
- Create: `packages/core/src/hooks/types.ts`
- Create: `packages/core/src/hooks/index.ts`
- Modify: `packages/core/src/brain.ts` — add `hooks` to query options
- Test: `packages/core/tests/hooks.test.ts`

**Step 1: Define hook types**

Create `packages/core/src/hooks/types.ts`:
```typescript
export type TrustLevel = 'brain' | 'task' | 'subagent'
```

**Step 2: Implement audit hook**

Create `packages/core/src/hooks/audit.ts`:
- `createAuditHook()` — PostToolUse callback that logs tool name, input summary, timestamp to audit file
- Log path: `{agentDir}/logs/audit.jsonl`
- Applied at all trust levels

**Step 3: Implement safety hooks**

Create `packages/core/src/hooks/safety.ts`:
- `createBashBlocker()` — PreToolUse for Bash, blocks patterns: `rm -rf /`, `git push --force`, `DROP TABLE`, etc. Returns `{ decision: 'block', message }` on match.
- `createPathRestrictor(allowedPaths)` — PreToolUse for Write/Edit, blocks writes outside allowed paths.

**Step 4: Implement hook factory**

Create `packages/core/src/hooks/factory.ts`:
```typescript
export function createHooks(trustLevel: TrustLevel, options?: { agentDir?: string, allowedPaths?: string[] }) {
  const hooks = {
    PostToolUse: [{ matcher: '.*', hooks: [createAuditHook(options?.agentDir)] }],
  }

  if (trustLevel === 'task' || trustLevel === 'subagent') {
    hooks.PreToolUse = [{ matcher: 'Bash', hooks: [createBashBlocker()] }]
  }

  if (trustLevel === 'subagent') {
    hooks.PreToolUse.push({ matcher: 'Write|Edit', hooks: [createPathRestrictor(options?.allowedPaths)] })
  }

  return hooks
}
```

**Step 5: Wire into brain.ts**

```typescript
const queryOptions: Options = {
  // ...existing options
  hooks: createHooks('brain', { agentDir }),
}
```

**Step 6: Write tests**

Test that:
- `createHooks('brain')` returns only PostToolUse (audit)
- `createHooks('task')` returns PostToolUse + PreToolUse Bash blocker
- `createHooks('subagent')` returns all three hook types
- Bash blocker blocks `rm -rf /`, allows `ls -la`
- Path restrictor blocks `/etc/passwd`, allows project paths
- Audit hook writes JSONL entry

**Step 7: Commit**

---

### T4: settingSources Evaluation

**Owner:** Backend Dev (research task)
**Files:**
- Modify: `packages/core/src/prompt.ts` (assessment only, changes TBD)
- Create: `docs/design/settings-sources-evaluation.md` (findings)

**Step 1: Read current prompt.ts thoroughly**

Document what `assembleSystemPrompt()` currently does:
- What files it reads
- How it assembles the prompt
- What order things are injected
- What's hardcoded vs dynamic

**Step 2: Test settingSources behavior**

Create a test script that calls `query()` with `settingSources: ['project']` from a directory with a `.claude/` folder containing:
- CLAUDE.md
- A skill file
- settings.json

Observe what gets loaded automatically.

**Step 3: Document overlap**

Write `docs/design/settings-sources-evaluation.md`:
- What settingSources handles natively
- What prompt.ts does that overlaps
- What prompt.ts does that settingSources can't replace
- Recommended simplification plan for S2

**Step 4: Commit findings**

---

### T5: CLAUDE.md Agent SDK Rule

**Owner:** Any
**Files:**
- Modify: `/home/nina/my_agent/CLAUDE.md`

**Step 1: Add rule to CLAUDE.md**

Add to the References section or a new "SDK Rules" section:

```markdown
## Agent SDK Development Rule

**Any work touching the following MUST invoke the `claude-developer-platform` skill first:**
- `packages/core/src/brain.ts` or any file importing from it
- Agent SDK query options (`mcpServers`, `agents`, `hooks`, `settingSources`, `resume`, `betas`)
- MCP tool definitions (`packages/core/src/mcp/`)
- Subagent definitions (`packages/core/src/agents/`)
- Hook implementations (`packages/core/src/hooks/`)
- Session management (`packages/dashboard/src/agent/`)

This ensures SDK features are used correctly per current documentation. The SDK evolves — always check latest patterns before implementing.
```

**Step 2: Commit**

---

## Verification

After all tasks complete:

1. Brain queries include `mcpServers.memory` with 5 live tools
2. Brain queries include `agents` with 3 core subagent definitions
3. Brain queries include `hooks` with audit logging
4. `settingSources` evaluation document exists with clear findings
5. CLAUDE.md contains the Agent SDK rule
6. All unit tests pass
7. Dashboard chat still works (regression check)
8. Task execution still works (regression check)

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | CTO | Architecture decisions, SDK guidance |
| Backend Dev | Sonnet | T1-T4 implementation |
| Reviewer | Opus | Plan↔execution match, SDK correctness |

## Sprint Mode

**Normal sprint** — CTO available for SDK decisions. Reviewer must invoke `claude-developer-platform` skill during review to verify SDK usage.
