# M6.9-S5 Post-Merge Refinements

**Date:** 2026-03-16
**Context:** After merging S5 to master, live testing revealed gaps in the tool separation model. These were fixed in 3 commits on master.

---

## 1. Subagent Bypass (fix: a773f34 → amended to read-only researcher)

**Problem:** S5 restricted conversation Nina to `tools: ["WebSearch", "WebFetch"]`, but the Agent SDK allows spawning subagents that inherit *default* tool access. In a live conversation, Nina spawned a general-purpose Agent subprocess with Read access to bypass the restriction — she read the roadmap file through a subagent instead of using her MCP tools.

**Initial fix:** `agents: {}` — disable all subagents.

**Revised fix:** After discussion, we realized reading files is not "work" — it's context gathering. Forcing file reads through `create_task` would be unnecessarily friction. The final fix defines a single named subagent:

```typescript
agents: {
  researcher: {
    description: "Read-only helper for quick lookups...",
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
    model: "haiku",
  },
}
```

This gives Nina fast, cheap context gathering (Haiku) while preventing writes, edits, bash, or browser automation. The delegation model stays intact: anything that produces artifacts goes through `create_task`.

**Design principle:** The line between "context" and "work" is: read-only = context, mutation/creation = work.

---

## 2. Conversation Role Definition (feat: 220cd84)

**Problem:** Standing orders told Nina *what tools she has* and *how to delegate*, but never explained *why*. She didn't know she was the conversation layer by design. Without this framing, the tool restriction feels like a limitation to work around rather than an architectural choice.

**Fix:** Created `packages/core/skills/conversation-role.md` — a framework-level file included in every conversation Nina's system prompt via `SKILL_CONTENT_FILES`. It explains:
- You are the conversation layer (discuss, plan, brainstorm, advise)
- Working agents do the work (research, code, analysis, artifacts)
- This is by design, not a limitation

**Why framework-level:** This ships with the framework. Future users get it without hatching. It's not personality or preferences — it's the agent's operational architecture.

---

## 3. Framework vs Private Rule Split (feat: b817eae)

**Problem:** Standing orders (`.my_agent/notebook/reference/standing-orders.md`) mixed universal rules with user-specific config. Task delegation mechanics, autonomy boundaries, and group chat behavior are the same for every agent. Escalation contacts, trust tier names, and public identity are per-instance.

**Fix:** Moved universal rules to `conversation-role.md` (framework), kept private config in standing orders:

| Moved to Framework | Kept Private |
|---|---|
| Role definition | Escalation contacts |
| Task delegation mechanics | Trust tier names |
| WebSearch vs create_task guidance | Public identity |
| Autonomy (internal vs external) | GitHub collaborator |
| Group chat behavior | Safety anecdotes |
| Delivery actions | |

**Why this matters:** A new user who installs the framework and runs hatching gets a conversation Nina that already knows her role, knows how to delegate, and knows when to stay quiet in group chats — without any of that being in the hatching wizard.
