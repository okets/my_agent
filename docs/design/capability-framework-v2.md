# Capability Framework v2 — Design Spec

> **Status:** Approved
> **Created:** 2026-04-11
> **Milestone:** M9.5 — Capability Framework v2
> **Scope:** Extend capability framework to support MCP-based capabilities, extract desktop control, add settings UI toggles
> **Supersedes:** Parts of [capability-system.md](capability-system.md) (interface types, well-known types). The original spec remains valid for discovery, registry, scripts, secrets, and brainstorming flow.

---

## Problem

The capability framework (M9) supports one socket shape: `interface: script`. This works for stateless request-response capabilities (voice, image generation) where the framework calls a shell script.

Desktop control doesn't fit this shape. It's a stateful MCP server with multiple tools that the brain calls directly. Today, desktop control is hardwired into the dashboard package — platform detection, X11 backend, MCP servers, setup scripts all live in framework code. This means:

1. Adding macOS or Wayland support requires framework changes.
2. The agent can't build a desktop control capability the way it builds voice.
3. There's no unified settings UI for enabling/disabling capabilities.

## Goal

Make desktop control a pluggable capability with the same lifecycle as voice: the framework defines the socket (UI reactions, tool contracts, lifecycle management), the agent builds the plug (platform-specific implementation). Extend the capability framework so `mcp` interface capabilities are first-class citizens alongside `script` capabilities.

---

## Design Principles

All principles from [capability-system.md](capability-system.md) remain. Additional:

1. **The framework is platform-ignorant.** No X11, Wayland, or macOS code in framework packages. Platform knowledge lives entirely in capability implementations.
2. **Two socket shapes, one registry.** `script` and `mcp` capabilities share the same discovery, lifecycle, settings, and health infrastructure. The difference is only in execution model.
3. **Three-tier tool contracts.** Capability templates define required, optional, and custom tool tiers. This gives implementations flexibility while maintaining a testable contract.
4. **The test harness is the acceptance gate.** A capability is not done until the harness passes. The agent builder iterates until it does.

---

## Socket Shapes

### Who Calls What

The socket shape maps to who invokes the capability:

| Caller | Socket | Execution Model | Examples |
|--------|--------|-----------------|----------|
| Framework (automatic) | `script` | Stateless, invoke per request | STT, TTS, image generation |
| Brain (tool use) | `mcp` | Stateful server, persistent connection | Desktop control |

**`script`** — the framework calls a shell script with arguments, reads JSON from stdout. The brain never sees the invocation. Audio arrives → framework runs `transcribe.sh` → brain receives text.

**`mcp`** — the framework spawns an MCP server as an **out-of-process child process**, connects via stdio transport. The brain discovers tools via MCP protocol and calls them directly. The framework manages server lifecycle and wraps the connection with middleware (see Server Lifecycle and Framework Middleware sections).

### CAPABILITY.md for MCP Interface

```yaml
---
name: Desktop Control (X11)
provides: desktop-control
interface: mcp
entrypoint: npx tsx src/server.ts
requires:
  env: []
  system:
    - xdotool
    - maim
    - wmctrl
---

Desktop control capability for X11-based Linux systems.
Uses xdotool for mouse/keyboard, maim for screenshots, wmctrl for window management.
```

**New fields:**

| Field | Required for | Description |
|-------|-------------|-------------|
| `entrypoint` | `mcp` interface | Command to start the MCP server. Framework spawns this as a child process and connects via stdio. |
| `requires.system` | Optional | CLI tools that must be present. Scanner probes for these during discovery (parallel to `requires.env` for secrets). |

### Language-Agnostic Entrypoints

The `entrypoint` is a command, not a file path. The framework doesn't care what language the MCP server is written in:

```yaml
# TypeScript capability
entrypoint: npx tsx src/server.ts

# Python capability
entrypoint: uv run src/server.py

# Pre-compiled binary
entrypoint: ./bin/server

# Shell wrapper that handles its own runtime
entrypoint: scripts/start-server.sh
```

The capability's `scripts/detect.sh` checks that the runtime is available. `scripts/setup.sh` installs it if needed.

### Coexistence with `.mcp.json` Pattern

The original [capability-system.md](capability-system.md) defines two MCP sub-patterns: lifecycle wrapper and `.mcp.json` direct passthrough. Both survive:

| Pattern | When to use | How it works |
|---------|------------|--------------|
| `entrypoint` (new) | Capability provides its own MCP server | Framework spawns process, connects via stdio |
| `.mcp.json` (existing) | Capability wraps an external MCP server | Framework registers config with Agent SDK directly |

Scanner priority: if `entrypoint` exists in frontmatter → use entrypoint spawning. Else if `.mcp.json` exists in capability folder → use direct passthrough. The two patterns are mutually exclusive per capability.

### Server Lifecycle

MCP capabilities run as out-of-process child processes. The framework manages the full lifecycle:

**Spawning:**
- Server is spawned when the capability is both `available` and `enabled`, at dashboard startup or when toggled on.
- Working directory is the capability folder (so relative paths in `entrypoint` resolve correctly).
- Environment: inherits process env + variables from `.env` declared in `requires.env`.

**Per-session instances (factory pattern):**
- Each brain session gets its own server process. The framework spawns a new child process per session via the `entrypoint` command.
- This matches the current `addMcpServerFactory()` pattern — MCP servers can only bind to one transport at a time.
- On session end, the corresponding server process is terminated.

**Crash recovery:**
- If the server process exits unexpectedly, the framework logs the event and marks health as `degraded`.
- The server is respawned on the next session (not immediately — no retry loop).
- In-flight tool calls receive an error response: `"Desktop control capability unavailable — server exited unexpectedly."`

**Shutdown:**
- On dashboard shutdown: send SIGTERM to all capability server processes, wait 5 seconds, SIGKILL survivors.
- On capability toggle off: same SIGTERM → SIGKILL sequence for that capability's processes.
- On session end: terminate that session's server process.

**Toggle timing:**
- Toggle OFF takes effect immediately — server processes killed, tools disappear from active sessions on next message.
- Toggle ON takes effect on next session start (SDK limitation — MCP servers can't be added mid-session). The toggle endpoint returns `{ effective: "next_session" }` to inform the UI.

### Framework Middleware

The capability server is a standalone process — it has no access to framework services (VAS, rate limiter, audit logger). The framework wraps the MCP connection with middleware that intercepts tool calls and results at the SDK level.

**Middleware chain (applied to all MCP capability tool calls):**

```
Brain calls tool → [Rate Limiter] → [Audit Logger] → MCP Server → [Screenshot Interceptor] → Brain receives result
```

1. **Rate Limiter** — checks sliding window before forwarding the call to the server. If limit exceeded, returns error without calling the server. Rate limit configurable per capability in `config.yaml` (default: 30/minute for `desktop-control`).

2. **Audit Logger** — logs tool name, timestamp, capability type to the audit JSONL file. Runs on every call, before and after.

3. **Screenshot Interceptor** — inspects tool results for base64 image content. When found, stores the image via Visual Action Service (VAS), replaces the raw base64 with a reference URL. This means:
   - The capability server returns raw screenshots (it doesn't know about VAS).
   - The framework stores them, manages lifecycle, serves them via HTTP.
   - The brain receives the image content for reasoning + a URL for the dashboard to display.

**Implementation:** The Agent SDK's hook system (`PostToolUse` hooks) provides the interception point. The framework registers hooks that fire after any tool call from an MCP capability server, keyed by the server's registered name.

**Framework directive language (learned in S6):** Framework-level behavioral directives to LLM brains (e.g., "include the screenshot URL in your reply") must use prescriptive MUST/NEVER language, include a concrete format example, and list explicit rules. Advisory MAY/SHOULD language consistently loses against other prompt pressures (token cost, brevity, uncertainty). Reserve advisory language for tool descriptions; use prescriptive language for behavior the framework enforces.

### Dependency Management for MCP Capabilities

MCP capabilities that use npm packages need a `package.json`:

```
.my_agent/capabilities/desktop-x11/
  package.json           # declares dependencies
  node_modules/          # installed by setup.sh
  ...
```

The `scripts/setup.sh` script runs `npm install` (or `pip install`, `uv sync`, etc.) as part of setup. The framework does not manage dependencies — the capability's own scripts handle installation.

For the capability template, this means the builder agent must:
1. Write a `package.json` with required dependencies
2. Include `npm install` (or equivalent) in `scripts/setup.sh`
3. Ensure `entrypoint` works after setup completes

---

## Three-Tier Tool Contracts

Capability templates define tools in three tiers:

| Tier | Framework Awareness | Test Harness | Purpose |
|------|-------------------|-------------|---------|
| **Required** | Yes | Must be present, validates schema | Minimum viable capability |
| **Optional** | Yes | Validates schema if present | Enhanced features (e.g., accessibility tree, OCR) |
| **Custom** | No | Ignored | Implementation-specific additions |

### Validation Rules

1. All required tools must be present with correct schemas → fail if missing
2. Optional tools, if present, must match the template schema → fail if schema wrong
3. Custom tools are ignored by the harness, discovered by the brain via MCP tool listing

This three-tier pattern applies to all capability types. For `script` capabilities, output fields can be required or optional (e.g., `language` in STT output is optional — transcription works without it, but the framework uses it for TTS voice matching if present).

---

## Well-Known Type: `desktop-control`

### Framework Reactions

| Reaction | Location | Behavior |
|----------|----------|----------|
| Settings toggle | Dashboard settings | Toggle appears when capability installed |
| System prompt hint | Brain prompt assembly | Tools listed in brain context |
| Rate limiting | Framework middleware | Configurable actions-per-minute (see Framework Middleware) |
| Audit logging | Framework middleware | All tool calls logged (see Framework Middleware) |
| Screenshot lifecycle | Framework middleware | Images stored via VAS, ref-tagged, cleaned up (see Framework Middleware) |
| Coordinate scaling | Capability (plug side) | The capability knows its display resolution and handles scaling internally |

### Tool Contract

**Required tools:**

| Tool | Input | Returns | Purpose |
|------|-------|---------|---------|
| `desktop_screenshot` | `{region?}` | Image (base64) + metadata JSON | Capture screen or region |
| `desktop_click` | `{x, y, button?, double?}` | Screenshot after action | Click at coordinates |
| `desktop_type` | `{text}` | Screenshot after action | Type text |
| `desktop_key` | `{key}` | Screenshot after action | Press key combo |
| `desktop_scroll` | `{x, y, direction, amount?}` | Screenshot after action | Scroll at position |
| `desktop_info` | `{query}` | JSON (windows/display/capabilities) | Query display and window state |
| `desktop_wait` | `{seconds}` | Screenshot after action | Pause for UI settling |
| `desktop_focus_window` | `{windowId}` | Screenshot after action | Bring window to foreground by ID |

**Every action tool must return a screenshot in its response.** This eliminates a round trip — the brain never has to separately ask "what happened?"

**Optional tools:**

| Tool | Input | Returns | Purpose |
|------|-------|---------|---------|
| `desktop_diff_check` | `{}` | JSON (changed: boolean, description) | Cheap text-only change detection — saves tokens |
| `desktop_find_element` | `{query}` | JSON (elements with bounds) | Accessibility tree element query |
| `desktop_ocr` | `{region?}` | JSON (text with bounding boxes) | OCR with coordinates |
| `desktop_window_screenshot` | `{windowId}` | Image + metadata | Capture specific window |
| `desktop_drag` | `{fromX, fromY, toX, toY}` | Screenshot after action | Drag between coordinates |

**Custom tools:** Implementations may expose additional tools. The framework ignores them, the brain discovers them via MCP tool listing.

### Required Scripts

| Script | Contract | Purpose |
|--------|----------|---------|
| `scripts/detect.sh` | Exit 0 if compatible, exit 1 with JSON `{"missing": [...], "message": "..."}` | Environment detection |
| `scripts/setup.sh` | Install missing dependencies (idempotent) | Dependency installation |

---

## Test Harness Extension

### Script Capabilities (existing, unchanged)

1. Run script with test input
2. Parse JSON output
3. Validate required fields present
4. Update health status

### MCP Capabilities (new)

The test harness needs an MCP client to connect to the spawned server. Use `@modelcontextprotocol/sdk`'s `Client` class with stdio transport — same library the Agent SDK uses internally.

**Test sequence:**

1. **Environment check** — run `scripts/detect.sh`, assert exit 0. If detect fails (no display, missing tools), mark health as `untested` and skip remaining steps. This handles headless/CI environments gracefully.
2. **Server startup** — spawn MCP server via `entrypoint` (working directory = capability folder), connect as MCP client via stdio. Timeout: 10 seconds. If server doesn't start, fail with "server startup timeout."
3. **Tool discovery** — call `tools/list`, assert all required tools from the template are present with correct input schemas.
4. **Optional tool validation** — for each optional tool found, validate its schema matches the template. Fail if schema doesn't match (available but non-compliant is worse than absent).
5. **Functional test** — call `desktop_screenshot`, assert response contains valid PNG (check header bytes `\x89PNG`, minimum 1KB). This proves the server can actually interact with the display.
6. **Cleanup** — disconnect MCP client, send SIGTERM to server process, wait 3 seconds, SIGKILL if still alive.

Pass/fail is binary. The builder agent iterates until the harness passes.

**Harness dispatch by interface type:** The existing `TEST_CONTRACTS` map dispatches by well-known type. Extend to also dispatch by interface type — `script` types run shell exec tests, `mcp` types run the MCP client sequence above. This is a new abstraction layer in `test-harness.ts`.

---

## Enabled/Disabled Toggle

### Current State

Voice has no toggle. Desktop uses a raw `.desktop-enabled` file via debug API. No unified view.

### New Design

Every capability has an enabled/disabled state, persisted as a `.enabled` file in the capability folder. `enabled` is a separate dimension from `status`:

| `status` | `enabled` | Meaning | UI | `get()` returns |
|----------|-----------|---------|----|----|
| available | true | Working and active | Green toggle ON | Capability |
| available | false | Working but user turned off | Grey toggle OFF | null |
| unavailable | true | Missing deps but user wants it | Amber, shows missing deps | null |
| unavailable | false | Missing deps, turned off | Grey, shows missing deps | null |
| invalid | * | Broken CAPABILITY.md | Error indicator | null |

`get()` returns the capability only when both `status === 'available'` AND `enabled === true`. This is the single gate — all framework code (script callers, MCP wiring, UI reactions) checks `get()`.

**Registry changes:**

```typescript
interface Capability {
  // ... existing fields (status, health, etc.)
  enabled: boolean           // new — read from .enabled file
}

// get() returns capability only when available AND enabled
registry.get('desktop-control')        // Capability | undefined
registry.isEnabled('desktop-control')  // explicit boolean check
registry.toggle('desktop-control')     // writes/removes .enabled file, emits capability:changed
```

**Migration:** The current `.desktop-enabled` file in agentDir root is removed. Existing desktop enabled state migrates to `.my_agent/capabilities/desktop-x11/.enabled` during S3 extraction.

**Disabling behavior by socket shape:**

| Shape | When enabled | When disabled |
|-------|-------------|---------------|
| `script` | Registry returns it, framework calls scripts | Registry returns null, framework skips |
| `mcp` | Server process running, brain has tools | Server process terminated, tools absent from next session |

Toggle timing for MCP capabilities: OFF is immediate (server killed, in-flight calls get error). ON takes effect on next session (SDK limitation — MCP servers can't be added to a running session).

---

## Settings UI

### Capabilities Section

The settings page renders every well-known type:

| State | UI | Action |
|-------|----|----|
| Installed + healthy | Toggle ON, green indicator | Toggle disables |
| Installed + degraded | Toggle ON, amber indicator | Shows health warning |
| Installed + disabled | Toggle OFF, grey | Toggle enables |
| Not installed | Toggle disabled, greyed out | Hint: "Ask {agent_name} to add {type}" |

**Endpoints:**

- `GET /api/settings/capabilities` — returns all well-known types with status, health, enabled
- `POST /api/settings/capabilities/:type/toggle` — toggles enabled state

**The hint text uses the agent's configured name** (e.g., "Ask Nina to add voice capability").

**Always-shown well-known types:**
- Audio to Text (voice input)
- Text to Audio (voice output)
- Text to Image (image generation)
- Desktop Control

---

## Code Changes: What Moves Where

### Stays in Framework (socket side)

| Code | Package | Reason |
|------|---------|--------|
| `desktop/types.ts` | core | Shared interfaces — the contract |
| Visual action service | dashboard | Screenshot lifecycle (any image-producing capability uses it) |
| Rate limiting + audit logging | dashboard | Safety policy via middleware hooks, generalized for any MCP capability |
| System prompt hints | core | Brain awareness |
| Settings UI + routes | dashboard | Capability state rendering |
| Registry wiring in app.ts | dashboard | Spawns MCP servers from registry, not hardcoded |

### Moves to Capability Folder (plug side)

| Code | Current Location | Destination |
|------|-----------------|-------------|
| `x11-backend.ts` | `dashboard/src/desktop/` | `.my_agent/capabilities/desktop-x11/src/` |
| `desktop-capability-detector.ts` | `dashboard/src/desktop/` | `.my_agent/capabilities/desktop-x11/src/` |
| `desktop-server.ts` | `dashboard/src/mcp/` | `.my_agent/capabilities/desktop-x11/src/` (rewritten as standalone MCP server) |
| `desktop-action-server.ts` | `dashboard/src/mcp/` | `.my_agent/capabilities/desktop-x11/src/` (rewritten as standalone MCP server) |
| Coordinate scaling (`computeScaleFactor`, `toScreenCoord`) | `dashboard/src/mcp/desktop-action-server.ts` | `.my_agent/capabilities/desktop-x11/src/` (capability knows its display) |
| `computer-use-service.ts` | `dashboard/src/desktop/` | **Deleted** (not MCP-based) |
| `setup-desktop.sh` | `scripts/` | `.my_agent/capabilities/desktop-x11/scripts/` |

### Deleted from Framework

| Code | Reason |
|------|--------|
| `dashboard/src/desktop/` | Entire directory — platform code extracted |
| `dashboard/src/mcp/desktop-server.ts` | MCP server extracted |
| `dashboard/src/mcp/desktop-action-server.ts` | MCP server extracted |
| `dashboard/src/routes/desktop.ts` | Replaced by generic capability routes |

### Capability Folder Structure

```
.my_agent/capabilities/desktop-x11/
  CAPABILITY.md
  config.yaml
  package.json         # Dependencies (@modelcontextprotocol/sdk, etc.)
  scripts/
    detect.sh          # Exit 0 if X11 + tools available, exit 1 with JSON
    setup.sh           # apt install xdotool maim wmctrl && npm install
  src/
    server.ts          # MCP server entrypoint (standalone, no framework imports)
    x11-backend.ts     # xdotool/maim wrapper
    scaling.ts         # Coordinate scaling (capability owns its display knowledge)
  references/
    supported-tools.md
  DECISIONS.md
  .enabled             # Presence = enabled (written by registry.toggle())
```

**Key constraint:** The capability server is standalone — it does NOT import from `@my-agent/core` or any framework package. The MCP protocol is the only interface. Type definitions needed by the server (tool schemas, input/output shapes) are defined locally in the capability or provided by the template as inline types.

---

## Impact on M13 (Platform Hardening)

M13-S4 (macOS backend) and M13-S5 (Wayland backend) are **absorbed by the capability model**. Each platform becomes a different capability folder:

- `.my_agent/capabilities/desktop-x11/` — Linux X11
- `.my_agent/capabilities/desktop-macos/` — macOS (Accessibility API + screencapture)
- `.my_agent/capabilities/desktop-wayland/` — Wayland (ydotool + PipeWire)

No framework changes needed per platform. The agent builds each implementation against the `desktop-control` template. M13-S4 and M13-S5 can be removed from the roadmap or converted to "agent builds macOS/Wayland capability" tasks.

---

## Sprint Plan

### M9.5 — Capability Framework v2

**6 sprints. Insert between M9.4 and M10.**

| Sprint | Name | Scope | Verification |
|--------|------|-------|-------------|
| S1 | Framework Extension | Extend types with `entrypoint`, `requires.system`, `enabled`. Extend scanner to probe system tools and read new fields. Extend registry with `isEnabled()`, `toggle()`, `enabled` gate on `get()`. Build MCP capability spawner (child process lifecycle, stdio connect, factory pattern). Build framework middleware chain (rate limiter, audit logger, screenshot interceptor via PostToolUse hooks). Extend test harness with MCP client path (spawn, connect, validate tools, functional test, display-gated). | Smoke-test MCP capability (trivial server): harness connects, validates tool schemas, reports health. Toggle on/off via registry API. Middleware chain intercepts tool calls in test. |
| S2 | Settings UI | Capabilities section in settings. All well-known types rendered with state-appropriate UI (available/enabled, available/disabled, unavailable, not-installed). Toggle on/off. Disabled hint with agent name. Health indicators. `GET /api/settings/capabilities` and `POST /api/settings/capabilities/:type/toggle` endpoints. Remove `routes/desktop.ts` (replaced by generic capability routes). | Browser test: all four well-known types visible. Toggle voice off → mic button disappears. Toggle on → returns. Non-installed capability shows hint. Toggle timing: script immediate, MCP next-session. |
| S3 | Desktop Extraction | Rewrite desktop MCP servers as standalone (no framework imports, no VAS/rate-limiter injection). Move coordinate scaling into capability. Add `package.json` + `scripts/setup.sh` + `scripts/detect.sh`. **Migration sequence:** (1) install capability folder with extracted code, (2) add registry-based wiring in `app.ts` alongside hardcoded path, (3) verify registry path works, (4) remove hardcoded path + delete `dashboard/src/desktop/` + delete desktop MCP servers. Migrate `.desktop-enabled` to `.enabled` in capability folder. **S1 deferred items:** wire middleware chain to PostToolUse hooks in `app.ts`, wire spawner `crash` event to registry health `degraded`, make audit logger writer async-compatible for JSONL file writes, add runtime warning when spawner can't access child process reference. | Desktop control works as before, driven through registry. Screenshots stored via VAS (middleware interceptor). Rate limiting applied (middleware). Toggle off in settings → tools disappear. Toggle on → tools return. Test harness passes. Crash event wired — kill process, verify health becomes `degraded`. |
| S4 | Template & Agent Verification | Write `skills/capability-templates/desktop-control.md` with full MCP contract: required/optional tool schemas, entrypoint examples, `package.json` template, detect/setup script contracts, inline type definitions (no framework imports). Update brainstorming skill with MCP-specific guidance. Build cleanup/reset script. **S1 deferred items:** add tool schema validation against template contract in test harness (required tools present + correct schemas, optional tools validated if present), add functional screenshot test (call `desktop_screenshot`, validate PNG response). **S3 deferred items:** fix dead crash monitoring code in app.ts (remove or implement via SDK lifecycle hooks), add enabled-gate to factory registration (use `registry.get()` instead of `registry.list().find()`), expand test fixture to all 7 required tools. **Build-from-scratch loop:** delete desktop capability → ask agent "I want desktop control" → test harness must pass → tools must work. Iterate template until reliable single-shot. **Acceptance test:** ask Nina to read text from an open Kwrite document on the desktop — proves end-to-end: screenshot, OCR/vision, tool use, response. **User feedback:** after the acceptance test (pass or fail), ask Nina to reflect on the desktop-control tools — which tools she used, which were confusing or unnecessary, what was missing, whether coordinate scaling was intuitive, whether optional tools (OCR, find_element, diff_check) would have helped. Feed insights back into the template. | Delete capability folder → agent builds it → harness passes → tools work → Nina reads Kwrite content → Nina provides tool feedback → template adjusted if needed. |

| S5 | Test Cleanup + UX Fixes | Delete 5 orphaned test files (test deleted S3 modules). Fix 2 stale test files (`capability-system.test.ts` enabled gate, `session-manager-skills.test.ts` mock). Auto-create `.enabled` on first capability build. **Nina's UX feedback action items:** add `desktop_focus_window` as 8th required tool (backend already implements it, missing from MCP registration), include `scaleFactor` in every screenshot response metadata (brain needs it for accurate click coordinates). Update tool-contracts.ts, template, fixture, real server. | All tests green. 8 required tools in contract. Screenshot metadata includes scaleFactor. Nina feedback logged. |
| S6 | Screenshot Pipeline | Complete the Screenshot Interceptor middleware (§Framework Middleware, point 3 — spec designed in S1, detection-only in S3): extract base64 image from MCP tool results → store via `app.visualActionService.store()` → inject VAS URL into conversation turn. Desktop screenshots render inline in chat bubbles. Browser/Playwright screenshots use the same pipeline — generic for any image-producing MCP capability. Reuse existing `screenshotUrlPattern` ref scanner (`app.ts:554`) for lifecycle management. | Desktop screenshot visible inline in conversation. Browser screenshot visible inline. VAS stores and serves images. Ref tagging works. Nina sees her own screenshots in the chat. |

### Dependencies

- **M9.5 depends on:** M9 (capability system), M8 (desktop automation)
- **M10 depends on:** M9.5 (capability registry used by transports for media handling)
- **M13-S4, M13-S5:** Absorbed — become agent-built capabilities against the `desktop-control` template

---

## Audit Resolutions

External audit conducted 2026-04-11. Key findings and resolutions:

| Finding | Resolution | Addressed in |
|---------|-----------|-------------|
| In-process vs out-of-process unspecified | Out-of-process (child process via stdio). Added Server Lifecycle section. | Socket Shapes |
| VAS/rate-limiter/audit-logger can't be injected into separate process | Framework middleware chain using PostToolUse hooks. Added Framework Middleware section. | Socket Shapes |
| Coordinate scaling contradicts extraction (framework can't intercept) | Moved to capability side. Capability owns its display knowledge. | Framework Reactions, Code Changes |
| `.mcp.json` pattern fate unclear | Both patterns survive, mutually exclusive per capability. Added coexistence section. | Socket Shapes |
| `enabled` + `status` interaction undefined | Two separate dimensions. `get()` requires both available AND enabled. Full state matrix documented. | Enabled/Disabled Toggle |
| Toggle while session active undefined | OFF immediate (kill server). ON next session (SDK limitation). Documented. | Enabled/Disabled Toggle, Server Lifecycle |
| MCP test harness needs client library | Use `@modelcontextprotocol/sdk` Client class. Added to harness spec. | Test Harness |
| Screenshot test fails in headless | `detect.sh` gates functional test. Headless → `untested`, not failed. | Test Harness |
| Capability server can't import framework packages | Standalone constraint: no `@my-agent/core` imports. Template provides inline types. | Capability Folder Structure |
| `package.json` / dependency management unaddressed | Added to folder structure + setup.sh contract. | Dependency Management, Folder Structure |
| S3 migration sequencing critical | Dual-path migration: add registry path → verify → remove hardcoded path. | Sprint Plan S3 |
| Agent builder has no MCP guidance | S4 updates brainstorming skill with MCP-specific guidance + comprehensive template. | Sprint Plan S4 |
| Security of arbitrary entrypoint execution | Capability routing hook (existing) blocks unauthorized writes to capability folders. Only the automation system can install capabilities, maintaining the paper trail. Entrypoints run with same permissions as the dashboard process. | Existing trust model (capability-system.md) |

---

## See also

- [Adding a New Multi-Instance Capability Type](adding-a-multi-instance-capability-type.md) — checklist for future multi-instance types (browser-control was the first; next one will need the same brain-layer work — skill triggers, builder prompt mandates, UI hint alignment).

---

*Created: 2026-04-11*
*Approved: 2026-04-11 — CTO architect session*
*Extended: 2026-04-13 — multi-instance-capability checklist added after M9.5-S7 Phase F findings*
