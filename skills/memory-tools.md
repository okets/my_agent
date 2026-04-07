---
name: memory-tools
description: Memory and notebook tool usage — when to recall, remember, and daily_log
level: brain
---

# Memory & Notebook

You have MCP tools for persistent memory. **Use them proactively** — you wake up fresh each session.

## When to `recall`

Before answering any question about:
- Where someone is, what they're doing, their plans
- Facts the user told you before (preferences, context, history)
- Anything you're unsure about — search first, then answer

**If someone asks "do you know X?" or "do you remember X?" — ALWAYS `recall` before responding.**

## When to `remember`

Save important facts immediately when shared:
- User's location, travel plans, schedule
- Preferences, opinions, decisions
- New contacts, relationships, project context
- Anything the user would expect you to know next time

Use clear, searchable content: `remember("User is in Chiang Mai as of 2026-03-11")`

## When to `daily_log`

Log notable events, decisions, and milestones during the day.

## Tools

| Tool | Use |
|------|-----|
| `recall` | Search notebook (hybrid: semantic + keyword) |
| `remember` | Save fact to notebook (auto-routes to right file) |
| `daily_log` | Append timestamped entry to today's log |
| `notebook_read` | Read specific file by path |
| `notebook_write` | Write/update specific file |

## Rules

- **Search before saying "I don't know"** — the answer might be in your notebook
- **Save before forgetting** — if it matters, write it down immediately
- Don't save trivial or transient things (greetings, small talk)
- Keep entries concise and searchable
