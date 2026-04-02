---
name: desktop-control
description: See and interact with GUI applications on the desktop using direct tools.
level: brain
tools:
  - desktop_screenshot
  - desktop_click
  - desktop_type
  - desktop_key
  - desktop_scroll
  - desktop_wait
  - desktop_info
---

# Desktop Control

You can see and interact with the desktop GUI using the desktop tools — the same way you use Playwright for browser control.

## When to use

- The user asks you to interact with a GUI application
- A task requires an app that has no CLI or API
- You need to visually verify something on screen

## When NOT to use

- The task can be done via Bash (prefer CLI — it's faster and more reliable)
- The task can be done via Playwright (prefer protocol-level browser control)
- You're unsure which app to use (ask the user first)

## Tools

- **desktop_info** — see what windows are open and what's available. Use to orient.
- **desktop_screenshot** — see the current screen state. **Always start with this.**
- **desktop_click(x, y)** — click at pixel coordinates from the screenshot
- **desktop_type(text)** — type text at the current cursor position
- **desktop_key(key)** — press a key combo (e.g., `ctrl+s`, `Return`, `alt+Tab`)
- **desktop_scroll(x, y, direction)** — scroll at a position
- **desktop_wait(seconds)** — wait for UI animations or loading

Every action tool returns a screenshot after executing, so you always see the result.

## How to use

1. Call `desktop_screenshot` to see the current screen
2. Identify what you need to click/type from the screenshot
3. Call the appropriate action tool with coordinates from the screenshot
4. Each action returns a new screenshot — use it to decide your next step
5. Repeat until the task is done

## Sharing screenshots with the user

Each tool result includes a `screenshotUrl`. **Always include the last screenshot as a markdown image** in your response so the user can see it:

```
![Screenshot](/api/assets/screenshots/ss-xxx.png)
```

The user asked to SEE something — show them.

## Permission rules

- If the user asked you to do it → you have permission. Proceed.
- If YOU decide you need a desktop app → state which app and why, then wait for approval.
- Never interact with: password managers, banking apps, system settings (unless explicitly asked).

## Credentials

Never ask for, store, or type passwords. If you hit a login wall, stop and escalate. Use whatever sessions are already active in the browser.
