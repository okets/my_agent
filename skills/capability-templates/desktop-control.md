---
template_version: 2
type: desktop-control
provides: desktop-control
interface: mcp
fallback_action: "try again in a moment"
---

# Desktop Control Capability Template

Framework-authored contract for desktop control MCP capabilities.

## Overview

Desktop control capabilities provide screen interaction via MCP tools. The framework spawns the capability as a child process, connects via stdio transport, and wraps it with middleware (rate limiting, audit logging, screenshot interception).

The capability is **platform-specific** — each platform (X11, Wayland, macOS) gets its own implementation folder. The framework is platform-ignorant; all platform knowledge lives in the capability.

## Interface: MCP

Unlike script capabilities (called by the framework), MCP capabilities are called by the brain directly. The brain discovers tools via MCP protocol and decides when and how to use them.

**Execution model:** Stateful server, persistent connection per session.

## CAPABILITY.md Frontmatter

```yaml
---
name: Desktop Control (X11)          # Human-readable, platform in parens
provides: desktop-control             # Well-known type — must be exactly this
interface: mcp                        # MCP socket shape
entrypoint: npx tsx src/server.ts     # Command to start the MCP server
requires:
  env: []                             # API keys (if cloud-based)
  system:                             # CLI tools that must be present
    - xdotool                         # X11: mouse/keyboard
    - maim                            # X11: screenshots
    - wmctrl                          # X11: window management
---
```

Adjust `requires.system` for your platform. The `scripts/detect.sh` script validates these.

## Required Tools (8)

Every desktop-control capability MUST expose these tools. The test harness validates their presence and input schemas.

**Every action tool (click, type, key, scroll, wait) MUST return a screenshot in its response.** This eliminates a round trip — the brain sees the result of every action without asking separately.

### desktop_screenshot

Capture the screen or a region.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `region` | object `{ x, y, width, height }` | No | Region to capture. All fields are numbers. Omit for full screen. |

**Returns:** Image content (base64 PNG) + metadata JSON with `width`, `height`, and `scaleFactor`.

```typescript
server.tool(
  'desktop_screenshot',
  'Capture the screen or a region',
  { region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() },
  async ({ region }) => {
    const screenshot = await takeScreenshot(region) // Platform-specific
    return {
      content: [
        { type: 'image', data: screenshot.base64, mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify({ width: screenshot.width, height: screenshot.height, scaleFactor }) },
      ],
    }
  },
)
```

### desktop_click

Click at coordinates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | number | Yes | X coordinate |
| `y` | number | Yes | Y coordinate |
| `button` | string | No | Mouse button: "left" (default), "right", "middle" |
| `double` | boolean | No | Double-click if true |

**Returns:** Screenshot after action.

### desktop_type

Type text at current cursor position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Text to type |

**Returns:** Screenshot after action.

### desktop_key

Press a key or key combo.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | Key name or combo (e.g., "Return", "ctrl+s", "alt+F4") |

**Returns:** Screenshot after action.

### desktop_scroll

Scroll at a position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | number | Yes | X coordinate to scroll at |
| `y` | number | Yes | Y coordinate to scroll at |
| `direction` | string | Yes | One of: "up", "down", "left", "right" |
| `amount` | number | No | Scroll amount in clicks (default: 3) |

**Returns:** Screenshot after action.

### desktop_info

Query display and window state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | One of: "windows" (list windows), "display" (resolution, scaling), "capabilities" (available features) |

**Returns:** JSON with query results.

### desktop_wait

Pause execution for UI settling.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `seconds` | number | Yes | Seconds to wait (max 10) |

**Returns:** Screenshot after waiting.

### desktop_focus_window

Bring a window to the foreground by its ID (from `desktop_info(windows)`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | Yes | Window ID from `desktop_info` windows query |

**Returns:** Screenshot after focusing the window.

## Optional Tools (5)

These enhance the capability but are not required. The test harness validates their schemas if present.

### desktop_diff_check

Cheap text-only change detection. Returns whether the screen changed since last screenshot — saves tokens when the brain wants to check if an action had visible effect.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | | | |

**Returns:** JSON `{ "changed": boolean, "description": "..." }`.

### desktop_find_element

Query the accessibility tree for elements matching a description.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Element description (e.g., "Save button", "text field") |

**Returns:** JSON array of elements with `{ name, role, bounds: { x, y, width, height } }`.

### desktop_ocr

OCR the screen or a region, returning text with bounding boxes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `region` | object `{ x, y, width, height }` | No | Region to OCR (same format as desktop_screenshot) |

**Returns:** JSON array of `{ text, bounds: { x, y, width, height }, confidence }`.

### desktop_window_screenshot

Capture a specific window by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `windowId` | string | Yes | Window ID (from desktop_info "windows" query) |

**Returns:** Image content + metadata (same format as desktop_screenshot).

### desktop_drag

Drag from one position to another.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromX` | number | Yes | Start X |
| `fromY` | number | Yes | Start Y |
| `toX` | number | Yes | End X |
| `toY` | number | Yes | End Y |

**Returns:** Screenshot after action.

## Required Scripts

### scripts/detect.sh

Environment detection. Exit 0 if the platform is compatible, exit 1 with JSON error if not.

```bash
#!/usr/bin/env bash
set -euo pipefail

MISSING=()

# Check display server
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  MISSING+=("display server (no \$DISPLAY or \$WAYLAND_DISPLAY)")
fi

# Check required CLI tools
for tool in xdotool maim wmctrl; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING+=("$tool")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  printf '{"missing": %s, "message": "Missing dependencies"}' \
    "$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s .)"
  exit 1
fi

exit 0
```

### scripts/setup.sh

Install missing dependencies (idempotent). Runs npm install for the MCP server and installs system packages if needed.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Install npm dependencies
npm install

# Check system deps (Ubuntu/Debian)
MISSING=()
for tool in xdotool maim wmctrl; do
  command -v "$tool" &>/dev/null || MISSING+=("$tool")
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Installing: ${MISSING[*]}"
  sudo apt-get install -y "${MISSING[@]}"
fi
```

## File Structure

```
.my_agent/capabilities/desktop-x11/
  CAPABILITY.md           # Frontmatter + description
  config.yaml             # Non-secret settings (rate limit, display index)
  package.json            # Node.js dependencies (@modelcontextprotocol/sdk, zod)
  src/
    server.ts             # MCP server entry point — tool definitions
    x11-backend.ts        # Platform-specific implementation (xdotool, maim, wmctrl)
    types.ts              # Shared types
    scaling.ts            # Coordinate scaling logic
  scripts/
    detect.sh             # Environment detection
    setup.sh              # Dependency installation
```

## config.yaml

```yaml
rate_limit: 30          # Actions per minute (framework middleware enforces this)
display: ':0'           # X11 display (usually :0)
screenshot_quality: 80  # PNG compression level
```

## package.json

```json
{
  "name": "desktop-x11",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  }
}
```

## Coordinate Scaling

The capability handles coordinate scaling internally. The brain works in the screenshot's coordinate space. If the display uses HiDPI scaling, the capability maps coordinates before passing to system tools. The framework does not handle scaling.

**Every screenshot response includes `scaleFactor` in its metadata.** This tells the brain the ratio between the screenshot's coordinate space and the actual screen coordinates. The brain sends coordinates in screenshot space — the capability's `toScreenCoord()` function handles the conversion internally. The brain does NOT need to scale coordinates itself, but the scaleFactor helps it understand the mapping.

## Server Entry Point Pattern

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'desktop-x11', version: '1.0.0' })

// Define tools here (see Required Tools and Optional Tools above)

const transport = new StdioServerTransport()
await server.connect(transport)
```

The server MUST NOT import from `@my-agent/core` or any framework package. It is a standalone process that communicates only via MCP protocol.

## Test Contract

The test harness validates this capability in 3 stages:

1. **Environment check** — `scripts/detect.sh` exits 0
2. **Schema validation** — all 8 required tools present with correct input schemas (validated against `packages/core/src/capabilities/tool-contracts.ts`)
3. **Functional test** — `desktop_screenshot` returns valid PNG (header bytes `\x89PNG`, minimum 1KB for real screenshots)

A capability is not done until the harness passes all 3 stages.

## Security

- Never log screenshots to disk (the framework handles storage via VAS)
- Sanitize key combos — reject dangerous sequences if appropriate
- The rate limiter is framework-enforced (PreToolUse hook), not capability-enforced
- The audit logger is framework-enforced (PostToolUse hook), not capability-enforced

## Known Platforms

| Platform | System Tools | Status |
|----------|-------------|--------|
| X11 (Linux) | xdotool, maim, wmctrl | Reference implementation |
| Wayland (Linux) | ydotool, grim, wlr-randr | Future |
| macOS | cliclick, screencapture, osascript | Future |

Each platform is a separate capability folder (e.g., `desktop-wayland`, `desktop-macos`). The framework discovers whichever is installed. Only one `desktop-control` provider should be active at a time.

## Smoke Fixture

Every desktop-control capability MUST ship `scripts/smoke.sh`. The reverify dispatcher
calls this as a fresh out-of-session subprocess (exit 0 = healthy, non-zero = broken).

**Contract (full — reference implementation ships in S14):**
1. Run `detect.sh` — confirms display server and required tools are present.
2. Spawn the MCP server (`npx tsx src/server.ts`).
3. Connect an MCP client, call `desktop_screenshot`, check the response contains valid image content.
4. Tear down the server cleanly.
5. Exit 0 on success, non-zero on any failure.

**Minimal stub for S11** (copy to `scripts/smoke.sh`, make executable — replace with full version in S14):

~~~bash
#!/usr/bin/env bash
# Minimal smoke stub — full MCP tool-invocation version ships in S14.
# Confirms: (1) environment healthy, (2) MCP server starts without crashing.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

# Step 1: environment check (display server + system tools present)
"$DIR/detect.sh"

# Step 2: MCP server starts cleanly (wait 2s, then kill)
cd "$DIR/.."
timeout 10s npx tsx src/server.ts &>/dev/null &
SERVER_PID=$!
sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "MCP server exited immediately — check entrypoint or src/server.ts" >&2
  exit 1
fi
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
~~~

Replace this stub with the full S14 implementation once it ships. The stub provides
meaningful liveness coverage (environment + server startup) but does not exercise any
MCP tools.
