---
name: desktop-control
description: See and interact with GUI applications on the desktop using Claude's trained computer use.
level: brain
tools:
  - desktop_task
  - desktop_screenshot
  - desktop_info
---

# Desktop Control

You can see and interact with the desktop GUI using the desktop tools.

## When to use

- The user asks you to interact with a GUI application
- A task requires an app that has no CLI or API
- You need to visually verify something on screen

## When NOT to use

- The task can be done via Bash (prefer CLI — it's faster and more reliable)
- The task can be done via Playwright (prefer protocol-level browser control)
- You're unsure which app to use (ask the user first)

## Tools

- **desktop_info** — see what windows are open and what's available. Use first to orient.
- **desktop_screenshot** — see the current screen state without performing any action.
- **desktop_task** — perform a multi-step GUI task. Describe the goal, not individual clicks. Returns screenshot URLs.

## Sharing screenshots with the user

When `desktop_task` or `desktop_screenshot` returns screenshot URLs, **always include the last screenshot as a markdown image** in your response so the user can see it:

```
![Screenshot](/api/assets/screenshots/ss-xxx.png)
```

The `screenshotUrls` array in the tool result contains the URLs. Use the last one. The user asked to SEE something — show them.

## Permission rules

- If the user asked you to do it → you have permission. Proceed.
- If YOU decide you need a desktop app → state which app and why, then wait for approval.
- Never interact with: password managers, banking apps, system settings (unless explicitly asked).

## Credentials

Never ask for, store, or type passwords. If you hit a login wall, stop and escalate. Use whatever sessions are already active in the browser.
