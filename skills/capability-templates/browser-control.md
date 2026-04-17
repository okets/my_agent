---
template_version: 2
type: browser-control
provides: browser-control
interface: mcp
multi_instance: true
fallback_action: "try again in a moment"
---

# Browser Control Capability Template

Framework-authored contract for browser-control MCP capabilities. This is the
**first multi-instance capability type** — a user can install Chrome, Edge,
Firefox, and more side-by-side, each as its own capability folder.

## Overview

Browser-control capabilities wrap `@playwright/mcp`, a Microsoft-maintained MCP
server that drives a real browser. Each capability corresponds to exactly one
browser profile (Chrome, Edge, Firefox, WebKit) with a dedicated
`user-data-dir` so logins, cookies, and extensions are kept separate.

The framework spawns the capability as a child process, connects via stdio
transport, and wraps the resulting tools with middleware (audit logging,
screenshot interception).

## Interface: MCP

**Execution model:** Stateful server, persistent connection per session.

Tool names are framework-prefixed by the capability's `name`:
`mcp__browser-chrome__browser_navigate`, `mcp__browser-edge__browser_click`,
etc. The brain sees multiple browser tool families when multiple browser
capabilities are enabled, and standing orders tell it which to pick.

## Multi-instance model

One folder = one browser. Unique `name:` per folder — used as the MCP server
key, the profile directory name, and the settings card label.

```
.my_agent/capabilities/browser-chrome/     # the plug (disposable)
.my_agent/browser-profiles/browser-chrome/ # user state (persists across reinstall)
```

**The profile folder lives OUTSIDE the capability folder.** This is load-bearing:

- Removing the capability (`capabilities/browser-chrome/`) never deletes saved
  logins. Reinstalling the same browser picks up the same profile.
- Profile deletion requires an explicit opt-in from the user (UI checkbox).
- Every capability's profile is at the **absolute** path
  `<project>/.my_agent/browser-profiles/<capability-name>/`. The wrapper resolves
  this path at startup.

## CAPABILITY.md Frontmatter

```yaml
---
name: $CAPABILITY_NAME                  # e.g. browser-chrome, browser-edge
provides: browser-control               # well-known type — must be exactly this
interface: mcp                          # MCP socket shape
entrypoint: npx tsx src/server.ts       # Command to start the MCP server
icon: $ICON_SLUG                        # simple-icons slug — see allowlist below
requires:
  system:
    - npx                               # @playwright/mcp is invoked via npx
---
```

`icon` must be one of: `googlechrome`, `microsoftedge`, `firefox`, `safari`,
`brave`, `generic`. The dashboard renders the matching SVG from
`packages/dashboard/public/icons/browsers/`. Unknown slugs fall back to
`generic`.

## Required config.yaml

```yaml
browser: $BROWSER            # one of: chrome, msedge, firefox, webkit
headless: false              # optional, default false
executablePath: ""           # optional — for Chromium forks (Brave, Vivaldi, Arc)
userDataDir: ""              # optional — override profile path. Empty = default
                             # (.my_agent/browser-profiles/<capability-name>/)
```

**Required field:** `browser`. Must match `@playwright/mcp` 0.0.68's
`--browser` enum exactly. Note: `chromium` is **not** in that enum — use
`chrome` for Chrome/Chromium, `msedge` for Edge.

**`userDataDir` must resolve to a non-empty absolute path.** When empty, the
wrapper computes `<project>/.my_agent/browser-profiles/<capability-name>/` and
creates the directory if it does not exist. An empty literal in the final
spawn argv is a bug — the wrapper must fail fast in that case.

## Required Scripts

### scripts/detect.sh

Exits 0 if the target browser binary is present, exits 1 with JSON error
otherwise.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Replace $BROWSER and $EXECUTABLE_PATH when instantiating.
BROWSER="$BROWSER"
EXECUTABLE_PATH="$EXECUTABLE_PATH"  # leave as literal "" if not set

MISSING=()

if ! command -v npx &>/dev/null; then
  MISSING+=("npx")
fi

# Prefer explicit executablePath if provided
if [ -n "$EXECUTABLE_PATH" ]; then
  if [ ! -x "$EXECUTABLE_PATH" ]; then
    MISSING+=("executable at $EXECUTABLE_PATH")
  fi
else
  case "$BROWSER" in
    chrome)   command -v google-chrome &>/dev/null || command -v chromium &>/dev/null || MISSING+=("google-chrome or chromium") ;;
    msedge)   command -v microsoft-edge &>/dev/null || MISSING+=("microsoft-edge") ;;
    firefox)  command -v firefox &>/dev/null || MISSING+=("firefox") ;;
    webkit)   : ;; # playwright installs its own webkit
    *) MISSING+=("unknown browser: $BROWSER") ;;
  esac
fi

if [ ${#MISSING[@]} -gt 0 ]; then
  printf '{"missing": %s, "message": "Missing dependencies"}' \
    "$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s .)"
  exit 1
fi
exit 0
```

### scripts/setup.sh

Idempotent install. Runs `npm install` and `npx playwright install <browser>`
if applicable.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

npm install

# Install the Playwright-managed browser binary if needed.
case "$BROWSER" in
  chrome|msedge|firefox|webkit) npx playwright install "$BROWSER" ;;
esac
```

## Verbatim wrapper body

**Copy this file verbatim to `src/server.ts`.** Replace only
`$CAPABILITY_NAME`. All other behaviour is driven by `config.yaml` at runtime —
do not bake the browser name or profile path into the wrapper.

The wrapper is deliberately dumb: read config, resolve the absolute profile
path, `spawn('npx', ...)`, pipe stdio, exit with the child's exit code.
Nothing else. Do not import the MCP SDK here. Do not add retries, reconnect
logic, or health checks — the framework owns all of that.

```typescript
// src/server.ts — Browser Control thin wrapper
// Spawns @playwright/mcp with flags derived from config.yaml + capability name.
// Stdio is piped to the parent (the framework MCP transport).
//
// Replace $CAPABILITY_NAME below when instantiating this template.

import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const CAPABILITY_NAME = '$CAPABILITY_NAME'

const __dirname = dirname(fileURLToPath(import.meta.url))
const capabilityRoot = resolve(__dirname, '..')
// capabilities/<name>/  →  ../..  →  .my_agent/
const myAgentRoot = resolve(capabilityRoot, '..', '..')

const configPath = join(capabilityRoot, 'config.yaml')
if (!existsSync(configPath)) {
  process.stderr.write(`[${CAPABILITY_NAME}] missing config.yaml at ${configPath}\n`)
  process.exit(2)
}

type Config = {
  browser?: string
  headless?: boolean
  executablePath?: string
  userDataDir?: string
}
const config = (parseYaml(readFileSync(configPath, 'utf-8')) ?? {}) as Config

const browser = (config.browser ?? '').trim()
const allowedBrowsers = new Set(['chrome', 'msedge', 'firefox', 'webkit'])
if (!allowedBrowsers.has(browser)) {
  process.stderr.write(
    `[${CAPABILITY_NAME}] config.yaml: browser must be one of chrome|msedge|firefox|webkit (got ${JSON.stringify(browser)})\n`,
  )
  process.exit(2)
}

const userDataDir = (config.userDataDir && config.userDataDir.trim().length > 0)
  ? resolve(config.userDataDir)
  : join(myAgentRoot, 'browser-profiles', CAPABILITY_NAME)

if (!userDataDir || userDataDir.trim().length === 0) {
  process.stderr.write(`[${CAPABILITY_NAME}] resolved empty userDataDir — aborting\n`)
  process.exit(2)
}
mkdirSync(userDataDir, { recursive: true })

const args: string[] = ['@playwright/mcp', '--browser', browser, '--user-data-dir', userDataDir]
if (config.headless === true) args.push('--headless')
if (config.executablePath && config.executablePath.trim().length > 0) {
  args.push('--executable-path', config.executablePath.trim())
}

const child = spawn('npx', args, { stdio: 'inherit' })

child.on('error', (err) => {
  process.stderr.write(`[${CAPABILITY_NAME}] failed to spawn @playwright/mcp: ${err.message}\n`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

// Forward termination signals to the child.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => { try { child.kill(sig) } catch { /* ignore */ } })
}
```

## File Structure

```
.my_agent/capabilities/$CAPABILITY_NAME/
  CAPABILITY.md           # Frontmatter + description
  config.yaml             # browser, headless, executablePath, userDataDir
  package.json            # deps: yaml (for config parsing), tsx
  src/
    server.ts             # Verbatim wrapper above
  scripts/
    detect.sh             # Browser-presence check
    setup.sh              # npm install + playwright install
  references/
```

## package.json

```json
{
  "name": "$CAPABILITY_NAME",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@playwright/mcp": "0.0.68",
    "tsx": "^4.0.0",
    "yaml": "^2.8.2"
  }
}
```

**Pin `@playwright/mcp` exactly** (not a range) — each browser capability is
frozen against a verified MCP server version; upgrading is a per-capability
opt-in. `npx` will resolve the pinned local install first, so there is no
fetch-on-demand at runtime.

## Icon slug allowlist

| Slug | Browser |
|------|---------|
| `googlechrome` | Google Chrome, Chromium |
| `microsoftedge` | Microsoft Edge |
| `firefox` | Firefox |
| `safari` | Safari / WebKit |
| `brave` | Brave |
| `generic` | Fallback (unknown browser) |

Use exactly one of these in the `icon:` frontmatter field.

## Standing-orders snippet

Ship this snippet in `references/standing-orders.md` so users know how to pick
between installed browsers. Customize agent name as appropriate.

```markdown
## Browser selection

You have these browser capabilities installed:

- `$CAPABILITY_NAME` — use for …

To route a task to a specific browser, add a rule like:

> "Use browser-chrome for banking. Use browser-edge for work intranet."

If only one browser is installed there is nothing to pick.
```

## Test Contract

The test harness validates this capability in 3 stages:

1. **Environment check** — `scripts/detect.sh` exits 0.
2. **Schema validation** — `@playwright/mcp` exposes its standard
   `browser_*` tools; the harness lists them and checks for at least
   `browser_navigate`, `browser_click`, `browser_snapshot`,
   `browser_take_screenshot`.
3. **Functional test** — `browser_navigate` to `about:blank` succeeds and
   `browser_take_screenshot` returns a valid PNG.

A capability is not done until the harness passes all 3 stages.

## Security

- Profile is stored under `.my_agent/` — never commit it.
- Never log cookies or localStorage to files the user cannot see.
- `executablePath` must resolve to a user-owned binary — do not accept
  world-writable paths.
- Rate limiting and audit logging are framework-enforced, not capability-enforced.

## Known Browsers

| `browser:` value | Description | Typical `executablePath` |
|------------------|-------------|--------------------------|
| `chrome` | Google Chrome / Chromium | (auto-detected) |
| `msedge` | Microsoft Edge | (auto-detected) |
| `firefox` | Firefox | (auto-detected) |
| `webkit` | Playwright WebKit build | (bundled) |

Chromium forks (Brave, Vivaldi, Arc) use `browser: chrome` + explicit
`executablePath`. The framework does not special-case them.

## Smoke Fixture

Every browser-control capability MUST ship `scripts/smoke.sh`. The reverify dispatcher
calls this as a fresh out-of-session subprocess (exit 0 = healthy, non-zero = broken).

**Contract (full — reference implementation ships in S14):**
1. Run `detect.sh` — confirms the browser binary is present.
2. Spawn the MCP server (`npx tsx src/server.ts`).
3. Connect an MCP client, call `browser_navigate` with `about:blank`, check the response is well-formed.
4. Tear down the server cleanly.
5. Exit 0 on success, non-zero on any failure.

**Minimal stub for S11** (copy to `scripts/smoke.sh`, make executable — replace with full version in S14):

~~~bash
#!/usr/bin/env bash
# Minimal smoke stub — full MCP tool-invocation version ships in S14.
# Confirms: (1) environment healthy, (2) MCP server starts without crashing.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

# Step 1: environment check (browser binary present)
"$DIR/detect.sh"

# Step 2: MCP server starts cleanly (wait 2s, then kill)
cd "$DIR/.."
timeout 10s npx tsx src/server.ts &>/dev/null &  # suppress startup noise; exit code still propagates
SERVER_PID=$!
sleep 3
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "MCP server exited immediately — check entrypoint or config.yaml" >&2
  exit 1
fi
kill "$SERVER_PID" 2>/dev/null || true
# Reap the server; ignore its exit code (killed by us, so always non-zero).
wait "$SERVER_PID" 2>/dev/null || true
~~~

Replace this stub with the full S14 implementation once it ships. The stub provides
meaningful liveness coverage (environment + server startup) but does not exercise any
MCP tools.
