# M8: Desktop Automation — Design Spec

> **Goal:** Nina can see and interact with GUI applications on the user's desktop.
> **Date:** 2026-03-29
> **Status:** Draft

---

## Context

Nina already has Playwright for browser automation (protocol-level, via MCP) and Bash for CLI operations. Desktop automation fills the remaining gap: native GUI applications that have no CLI or API — Photoshop, file managers, iOS simulators, proprietary tools, and apps where the user needs visual assistance.

Claude Code Desktop launched computer use (macOS, research preview), but it's tightly coupled to the Desktop app. We need our own implementation that works within the agent framework, runs on Linux (X11 now, Wayland later) and macOS, and integrates with the existing automation/job pipeline.

### Design Decisions from Brainstorming

1. **No dedicated Computer Use Agent.** Desktop control tools go directly on Working Nina, like Bash. Safety is enforced through hooks + autonomy levels + HITL escalation — the same pattern used for all other tools.

2. **Trust rule:** User-initiated actions ("open Photoshop, remove the background") = implicit permission. Agent-initiated actions (Nina decides she needs an app) = must state which app + why, wait for approval.

3. **VisualActionService is shared infrastructure.** Desktop screenshots, Playwright screenshots, and future rich visual output all flow through the same pipeline: capture → store → serve → render in dashboard. M8 builds the pipeline; M9 plugs Playwright and rich I/O into it.

4. **Dependency management via hatching + settings.** Auto-detect available tools at startup, show capabilities in settings, provide guided install for missing dependencies. Graceful degradation — no desktop tools means desktop control is unavailable, everything else works.

5. **Backend abstraction from day one.** X11 has ~6 months before KDE drops it (Plasma 6.8, October 2026). The `DesktopBackend` interface must be swappable: X11 backend for S1, Wayland/macOS backends later.

---

## Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Dashboard UI                          │
│  (screenshot viewer, timeline assets, settings panel)    │
├─────────────────────────────────────────────────────────┤
│                Asset Serving (Fastify)                    │
│  /api/assets/{jobId}/{filename}                          │
│  /api/assets/live/{sessionId}                            │
├─────────────────────────────────────────────────────────┤
│              VisualActionService (core)                   │
│  capture() → store() → publish event → serve             │
├──────────────────┬──────────────────────────────────────┤
│  DesktopBackend  │  (future: PlaywrightBridge,          │
│  ┌────────────┐  │   RichOutputRenderer)                │
│  │ X11Backend │  │                                      │
│  └────────────┘  │                                      │
│  ┌────────────┐  │                                      │
│  │ MacBackend │  │                                      │
│  └────────────┘  │                                      │
│  ┌────────────┐  │                                      │
│  │WaylandBack.│  │                                      │
│  └────────────┘  │                                      │
├──────────────────┴──────────────────────────────────────┤
│              MCP Tools (exposed to agents)                │
│  desktop_task · desktop_screenshot · desktop_info        │
├─────────────────────────────────────────────────────────┤
│              Safety Layer                                 │
│  PostToolUse hooks · audit log · rate limiting           │
└─────────────────────────────────────────────────────────┘
```

---

## VisualActionService

The shared pipeline for all visual actions across the framework. Any agent action that produces or consumes screenshots flows through here.

### Interface

```typescript
interface VisualActionService {
  // Capture and store a screenshot
  capture(options: CaptureOptions): Promise<Screenshot>

  // Store an externally-produced screenshot (e.g., from Playwright)
  store(image: Buffer, metadata: ScreenshotMetadata): Promise<Screenshot>

  // Retrieve screenshots for a context (job, conversation, session)
  list(context: AssetContext): Promise<Screenshot[]>

  // Get the serving URL for a screenshot
  url(screenshot: Screenshot): string

  // Publish a screenshot event to dashboard
  publish(screenshot: Screenshot): void
}

interface CaptureOptions {
  source: 'desktop' | 'window' | 'region'
  windowId?: string          // Specific window (desktop_info provides these)
  region?: { x: number, y: number, width: number, height: number }
  context: AssetContext       // Where this screenshot belongs
  description?: string        // Why it was taken
}

interface AssetContext {
  type: 'job' | 'conversation' | 'session'
  id: string                  // jobId, conversationId, or sessionId
  automationId?: string       // For job context
}

interface Screenshot {
  id: string                  // uuid
  path: string                // Absolute path on disk
  timestamp: string           // ISO 8601
  context: AssetContext
  description?: string
  width: number
  height: number
  sizeBytes: number
}

interface ScreenshotMetadata {
  context: AssetContext
  description?: string
  width: number
  height: number
}
```

### Storage

Screenshots are stored in the asset context's directory:

- **Job screenshots:** `.my_agent/automations/.runs/{automationId}/{jobId}/screenshots/{uuid}.png`
- **Conversation screenshots:** `.my_agent/conversations/{conversationId}/screenshots/{uuid}.png`

A `screenshots.jsonl` index file in each directory tracks metadata including tags (avoids filesystem scans).

### Screenshot Tagging & Retention

During a desktop task, the computer use loop takes many screenshots (one per action). Most are intermediate navigation steps. We tag each screenshot to decide what to keep.

**Primary: agent tagging.** The computer use system prompt instructs Claude to tag each screenshot as `keep` (meaningful progress — new page loaded, target found, task milestone) or `skip` (intermediate — clicked menu, scrolled, waited for load). The model already processes every screenshot for its next action, so this adds near-zero cost.

**Fallback: pixel diff.** If the agent doesn't tag a screenshot, compare it to the previous one. Large visual difference = `keep`. Small difference = `skip`. This is a dumb heuristic but catches cases where the agent forgets to tag.

**Retention policy:**
- `keep`-tagged screenshots are permanent (until the job's run_dir is cleaned up by normal retention)
- `skip`-tagged screenshots are deleted after 24 hours (configurable per-automation)
- Conversation screenshots are always kept (they're conversational turns, not bulk captures)
- Error and escalation screenshots are always kept regardless of tag

**Dashboard display:**
- **Job timeline:** Shows `keep` screenshots as thumbnails. "Show all N screenshots" expander for full sequence.
- **Chat (desktop_task result):** Final screenshot + summary. Progress indicator while task runs.
- **Chat (interactive):** Every screenshot shows inline — they're conversational turns.
- **HITL review:** Escalation screenshot shown prominently with surrounding context.
- **Debrief:** Model selects which `keep` screenshots to include in summary.

### Serving

New Fastify route: `/api/assets/{contextType}/{contextId}/screenshots/{filename}`

Serves files from the appropriate directory. No auth beyond existing dashboard auth (Tailscale-protected).

### Events

New StatePublisher event: `state:screenshot` — broadcast when a new screenshot is captured/stored. Payload includes the screenshot metadata, tag, and serving URL. Dashboard renders inline for `keep`-tagged screenshots.

---

## DesktopBackend Interface

```typescript
interface DesktopBackend {
  // Identity
  readonly platform: 'x11' | 'wayland' | 'macos'

  // Capabilities (detected at startup)
  capabilities(): DesktopCapabilities

  // Actions
  screenshot(options?: ScreenshotOptions): Promise<Buffer>
  click(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void>
  doubleClick(x: number, y: number): Promise<void>
  type(text: string): Promise<void>
  keyPress(keys: string): Promise<void>  // e.g., "ctrl+s", "alt+F4"
  mouseMove(x: number, y: number): Promise<void>
  mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void>
  scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void>

  // Window management
  listWindows(): Promise<WindowInfo[]>
  activeWindow(): Promise<WindowInfo | null>
  focusWindow(windowId: string): Promise<void>
  windowScreenshot(windowId: string): Promise<Buffer>

  // Display info
  displayInfo(): Promise<DisplayInfo>
}

interface DesktopCapabilities {
  screenshot: boolean
  mouse: boolean
  keyboard: boolean
  windowManagement: boolean
  accessibility: boolean     // AT-SPI2 available
}

interface WindowInfo {
  id: string
  title: string
  appName: string
  geometry: { x: number, y: number, width: number, height: number }
  focused: boolean
}

interface DisplayInfo {
  width: number
  height: number
  scaleFactor: number
  displayNumber?: number     // X11
  monitors: MonitorInfo[]
}

interface MonitorInfo {
  name: string
  x: number
  y: number
  width: number
  height: number
  primary: boolean
}

interface ScreenshotOptions {
  region?: { x: number, y: number, width: number, height: number }
  windowId?: string
  format?: 'png' | 'jpeg'
  quality?: number           // JPEG quality 0-100
}
```

### X11Backend (Sprint 1)

Primary implementation using a layered approach:

| Capability | Primary (npm) | Fallback (CLI) |
|---|---|---|
| Mouse/keyboard | `@nut-tree-fork/nut-js` | `xdotool` |
| Screenshots | `@nut-tree-fork/nut-js` | `maim` (not scrot — faster, maintained) |
| Window management | `@nut-tree-fork/nut-js` | `xdotool` + `wmctrl` |
| Display info | Node X11 queries | `xdpyinfo` + `xrandr` |

At startup, the backend probes for available tools and selects the best option per capability. If nut-js native bindings fail to load, it falls back to CLI tools. If neither is available, the capability is reported as unavailable.

### WaylandBackend (Future)

| Capability | Tool |
|---|---|
| Mouse/keyboard | `ydotool` (kernel-level `/dev/uinput`) |
| Screenshots | KDE Spectacle CLI / PipeWire screen capture |
| Window management | `kdotool` / KWin D-Bus (`org.kde.KWin`) |
| Accessibility | AT-SPI2 (works natively on Wayland) |

### MacBackend (Future)

| Capability | Tool |
|---|---|
| Mouse/keyboard | `@nut-tree-fork/nut-js` (native macOS support) |
| Screenshots | `screencapture` CLI |
| Window management | AppleScript / `osascript` |
| Accessibility | macOS Accessibility API |

---

## Native Computer Use API Bridge

The Claude API provides a trained computer use tool type (`computer_20251124`) where the model outputs pixel coordinates and action names. Claude is fine-tuned for this exact tool shape — it produces more accurate GUI interactions than custom tool schemas.

### Why Use the Native API

- **Accuracy:** Claude is specifically trained to interpret screenshots and output coordinates for this tool type. Custom MCP tools require the model to reason about ad-hoc schemas.
- **Rich action vocabulary:** Built-in support for click, drag, scroll, zoom, modifier keys, wait — all with trained understanding of when to use each.
- **Maintained by Anthropic:** As computer use improves, we get the improvements automatically.

### Integration Approach

The native computer use API uses `client.beta.messages.create()`, which is separate from the Agent SDK's session management. We bridge this by wrapping the computer use loop in an MCP tool that Working Nina can call:

```
Working Nina (Agent SDK session)
  └─ calls MCP tool: desktop_task("open Chrome, go to analytics.google.com, screenshot traffic")
      └─ ComputerUseService starts a beta API loop:
          1. Take screenshot via DesktopBackend
          2. Send to Claude beta API with computer_20251124 tool
          3. Model returns action (click, type, etc.)
          4. Execute via DesktopBackend
          5. Take new screenshot
          6. Repeat until model signals completion
          7. Return result (final screenshot + summary) to Working Nina
```

This gives us:
- Native computer use accuracy for GUI interaction
- Integration with the Agent SDK session (Working Nina orchestrates)
- All screenshots flow through VisualActionService (audit trail)
- Safety hooks fire on the MCP tool call (pre-approval), not on individual clicks

### Model Selection

The computer use loop runs a separate Claude session (via beta API, not Agent SDK). The model is configurable:

- **Default: Sonnet** — fast, cheap, good enough for most GUI tasks
- **Opus:** for complex multi-step tasks requiring careful reasoning
- **Configurable:** per-automation via manifest, or per-task via MCP tool parameter

### ComputerUseService

```typescript
interface ComputerUseService {
  execute(task: ComputerUseTask): Promise<ComputerUseResult>
}

interface ComputerUseTask {
  instruction: string          // What to do
  context: AssetContext         // For screenshot storage
  model?: string               // Override model (default: sonnet)
  maxActions?: number           // Safety limit (default: 50)
  timeoutMs?: number            // Safety limit (default: 120000)
  requireApproval?: boolean     // Escalate before starting
}

interface ComputerUseResult {
  success: boolean
  summary: string              // Model's description of what it did
  screenshots: Screenshot[]    // All screenshots taken during execution
  actionsPerformed: number
  error?: string
}
```

### Resolution Handling

The API constrains images to max 1568px on the longest edge and ~1.15 megapixels. We handle this in the bridge:

1. Query `DisplayInfo` from `DesktopBackend`
2. Calculate scale factor: `min(1.0, 1568/longEdge, sqrt(1_150_000/(w*h)))`
3. Resize screenshots before sending to API
4. Scale returned coordinates back to real screen space before executing via `DesktopBackend`

---

## MCP Tools

Exposed to both Conversation Nina and Working Nina via a `desktop-server` MCP server. Both agents can use desktop control — Conversation Nina for interactive help ("what's on my screen?", "click that button"), Working Nina for automated tasks. The same trust rule applies: user-initiated = proceed, agent-initiated = ask first.

These are **high-level orchestration tools**, not raw pixel operations (the native API handles those internally).

### `desktop_task`

Execute a GUI task using native computer use.

```typescript
{
  name: "desktop_task",
  description: "Perform a task on the desktop GUI. Uses Claude's trained computer use to see the screen and interact with applications. Best for: navigating apps, filling forms, clicking buttons, reading on-screen content. The task runs as an autonomous action loop — describe WHAT you want done, not individual clicks.",
  schema: {
    instruction: z.string(),     // "Open Chrome and go to analytics.google.com"
    maxActions: z.number().optional(),
  }
}
```

### `desktop_screenshot`

Capture a screenshot without performing any action.

```typescript
{
  name: "desktop_screenshot",
  description: "Take a screenshot of the desktop, a specific window, or a screen region. Returns the image for analysis.",
  schema: {
    target: z.enum(["screen", "window", "region"]).optional(),
    windowId: z.string().optional(),
    region: z.object({ x, y, width, height }).optional(),
  }
}
```

### `desktop_info`

Get information about the desktop environment.

```typescript
{
  name: "desktop_info",
  description: "List open windows, display information, and desktop capabilities. Use before desktop_task to understand what's available.",
  schema: {
    query: z.enum(["windows", "display", "capabilities"]),
  }
}
```

---

## Safety

### Trust Model

| Trigger | Behavior |
|---|---|
| User says "open Photoshop and remove the background" | Implicit permission. Proceed. |
| User automation with `autonomy: full` | Proceed, log all actions. |
| User automation with `autonomy: cautious` | Proceed for known-safe apps, escalate for unknown. |
| User automation with `autonomy: review` | Always escalate before starting desktop task. |
| Agent decides it needs a desktop app | Must state app name + reason. Escalate via `needs_review`. |

### Safety Hooks

**PreToolUse hook on `desktop_task`:**
- Log the instruction and context
- If autonomy is `review` → block, escalate
- If autonomy is `cautious` → check instruction against app allowlist
- Rate limit: max N desktop tasks per minute (configurable)

**PostToolUse hook on all desktop tools:**
- Log result (screenshots stored via VisualActionService)
- If action count exceeded threshold → flag in timeline

### Action Limits

| Guard | Default | Configurable |
|---|---|---|
| Max actions per task | 50 | Per-automation |
| Task timeout | 120 seconds | Per-automation |
| Max screenshot rate | 1/second | Global |
| Max concurrent desktop tasks | 1 | Global (prevent conflicts) |

### Audit Trail

Every desktop task produces:
- All screenshots (stored via VisualActionService)
- Action log (action type, coordinates, timestamp) in `{run_dir}/desktop-actions.jsonl`
- Summary from the model

Viewable in the job timeline on the dashboard.

---

## Desktop Automation Skill

A brain-level skill that teaches Nina when and how to use desktop control.

```markdown
# Desktop Control

You can see and interact with the desktop GUI using the desktop tools.

## When to use
- The user asks you to interact with a GUI application
- A task requires an app that has no CLI or API
- You need to visually verify something on screen

## When NOT to use
- The task can be done via Bash (prefer CLI)
- The task can be done via Playwright (prefer protocol-level browser control)
- You're unsure which app to use (ask the user first)

## How it works
- `desktop_info` — see what windows are open and what's available
- `desktop_screenshot` — see the current screen state
- `desktop_task` — perform a multi-step GUI task (describe the goal, not individual clicks)

## Permission rules
- If the user asked you to do it → you have permission
- If YOU decide you need a desktop app → state which app and why, then wait for approval
- Never interact with: password managers, banking apps, system settings (unless explicitly asked)
```

---

## Environment Detection & Setup

### Startup Detection

`DesktopCapabilityDetector` runs at startup and produces a `DesktopEnvironment` profile:

```typescript
interface DesktopEnvironment {
  displayServer: 'x11' | 'wayland' | 'macos' | 'none'
  hasDisplay: boolean            // DISPLAY or WAYLAND_DISPLAY set
  backend: 'x11' | 'wayland' | 'macos' | null
  tools: {
    nutJs: boolean               // Native bindings loaded
    xdotool: boolean             // CLI available
    maim: boolean                // CLI available
    wmctrl: boolean              // CLI available
    ydotool: boolean             // CLI available (Wayland)
    kdotool: boolean             // CLI available (KDE Wayland)
    spectacle: boolean           // CLI available (KDE screenshots)
  }
  capabilities: DesktopCapabilities
  setupNeeded: string[]          // What's missing, human-readable
}
```

### Detection Logic

```
1. Check $XDG_SESSION_TYPE → x11 | wayland
2. Check $DISPLAY → X11 available
3. Check $WAYLAND_DISPLAY → Wayland available
4. Check platform → darwin = macOS
5. Try loading nut-js native bindings
6. Probe CLI tools: which xdotool, which maim, etc.
7. Build capability profile
8. If no display → desktop control unavailable (headless server)
```

### Hatching Integration

New optional hatching step: **Desktop Control Setup**

- Shown only if a display is detected
- Shows detected capabilities
- Offers to install missing dependencies:
  - Ubuntu/Debian: `sudo apt install xdotool maim wmctrl`
  - Fedora: `sudo dnf install xdotool maim wmctrl`
  - macOS: nut-js handles it (npm dependency)
- User can skip (desktop control disabled, everything else works)

### Settings UI

New section in Settings: **Desktop Control**

- Status: Enabled / Disabled / Not Available (no display)
- Detected backend: X11 / Wayland / macOS
- Available capabilities: ✓ Screenshots ✓ Mouse ✓ Keyboard ✓ Windows
- Missing tools: list + install button
- Action limits: max actions, timeout, screenshot rate
- App allowlist / blocklist (for `cautious` autonomy)

---

## Sprint Plan

### Reordered Milestone Sequence

The original M8 (Desktop Automation) and M9 (Multimodal) are merged and reordered by dependency:

| Sprint | Name | Scope |
|---|---|---|
| **S1** | **Visual Action Pipeline** | VisualActionService, screenshot storage + tagging + retention, asset serving route, dashboard screenshot rendering (timeline + inline), StatePublisher events |
| **S2** | **Desktop Control — Linux X11** | DesktopBackend interface, X11Backend (nut-js + CLI fallback), ComputerUseService (native API bridge), MCP tools (desktop_task, desktop_screenshot, desktop_info), safety hooks, desktop skill, environment detection, hatching step, settings UI |
| **S3** | **Playwright Integration** | Wire Playwright screenshots into VisualActionService, surface browser automation screenshots in timeline/chat, unified visual audit trail |
| **S4** | **Rich I/O** | Image passthrough (dashboard + WhatsApp), visual output tools, asset rendering in chat |
| **S5** | **Voice** | STT/TTS engine, dashboard audio, WhatsApp voice notes (independent of visual pipeline) |

S1-S2 are the M8 core. S3-S4 bridge the visual pipeline to existing systems. S5 is independent.

**Deferred to release prep milestone (M13: Platform Hardening):**
- **macOS backend** — MacBackend implementation, macOS environment detection. Blocked on hardware availability.
- **Wayland backend** — WaylandBackend (ydotool + kdotool + PipeWire). Needed when KDE drops X11 (Plasma 6.8, October 2026). The backend abstraction built in S2 makes this a swap, not a rewrite.

**Milestone naming:** This spec covers what was previously M8 + M9. The combined milestone is **M8: Visual & Desktop Automation**. The old M8/M9 distinction is retired. The roadmap should be updated to reflect this.

### Success Criteria

- [ ] Nina can take a screenshot of the desktop and describe what she sees
- [ ] Nina can execute a multi-step GUI task ("open Chrome, go to URL, screenshot the page")
- [ ] Screenshots appear in the job timeline on the dashboard
- [ ] Safety hooks prevent agent-initiated desktop access without approval
- [ ] Desktop control degrades gracefully on machines without a display
- [ ] Environment detection correctly identifies available tools
- [ ] Settings UI shows desktop capabilities and allows configuration

---

## Dependencies

- **Claude API beta access** for `computer_20251124` tool type
- **`@nut-tree-fork/nut-js`** npm package (or xdotool + maim as fallback)
- **`@anthropic-ai/sdk`** (lower-level SDK, already a dependency) for beta API calls

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| X11 → Wayland transition (Oct 2026) | High | Backend abstraction from day one; S6 planned |
| Claude beta API changes | Medium | Wrapped in ComputerUseService; single change point |
| nut-js maintenance uncertainty | Medium | CLI fallback always available |
| Screenshot exfiltration via prompt injection | Medium | Hooks + audit log + rate limiting + no sensitive apps by default |
| Wrong-window race conditions on X11 | Medium | Explicit window IDs; 50-150ms settle delay after focus |
| Agent SDK doesn't support computer use | Medium | Bridge via MCP tool → beta API loop |
| Resolution scaling coordinate drift | Low | Scale factor calculation; recommended resolutions in skill |

---

*Spec written: 2026-03-29*
*Milestone: M8 (Desktop Automation) + partial M9 (Visual I/O)*
