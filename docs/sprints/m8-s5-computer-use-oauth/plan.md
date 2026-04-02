# M8-S5: Computer Use OAuth Fix — Implementation Plan

> **Goal:** Route desktop computer use through the Agent SDK instead of the raw Anthropic API, enabling Max subscription (OAuth) support.
> **Design spec:** [`2026-04-02-agent-sdk-computer-use-design.md`](../../superpowers/specs/2026-04-02-agent-sdk-computer-use-design.md)
> **Issue:** [#1](https://github.com/Nina-VanKhan/my_agent/issues/1)

---

## Problem

`ComputerUseService` (M8-S2) uses `client.beta.messages.create()` with the `computer_20251124` beta tool. This requires a prepaid API key. On Max subscription (OAuth only), the raw Messages API rejects OAuth tokens with `401: OAuth authentication is currently not supported`.

## Tasks

- [x] **Task 1: Research** — Verify Agent SDK `authToken` support, test OAuth with raw API (confirmed: raw API rejects OAuth)
- [x] **Task 2: Implement AgentComputerUseService** — New service using Agent SDK `query()` with 6 custom MCP tools (screenshot, click, type_text, key_press, scroll, wait) wrapping X11Backend
- [x] **Task 3: Wire up in app.ts** — Replace raw Anthropic client init, remove API key requirement
- [x] **Task 4: Fix DISPLAY environment** — Set DISPLAY=:10 and XAUTHORITY in systemd service for XRDP session
- [x] **Task 5: Fix MCP image format** — Use MCP `{type:"image", data, mimeType}` format instead of Anthropic API `{source:{...}}` format
- [x] **Task 6: Add screenshot URLs to desktop_task result** — Include `screenshotUrls` array + inline image for brain to share with user
- [x] **Task 7: Update desktop skill** — Instruct Nina to include screenshot URL as markdown image
- [x] **Task 8: E2E browser verification** — Ask Nina via dashboard chat to screenshot VS Code ROADMAP.md, verify inline image display

## Verification

Sprint verified when: user asks Nina via dashboard chat to screenshot VS Code with ROADMAP.md → Nina uses desktop_task → screenshot displays inline in chat → all on OAuth, no API key.

---

*Plan written: 2026-04-02*
