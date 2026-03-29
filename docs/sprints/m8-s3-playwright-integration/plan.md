# M8-S3: Playwright Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Playwright browser screenshots into the VisualActionService pipeline so they appear in the dashboard timeline and chat — unified visual audit trail across desktop control and browser automation. Add hatching + settings for Playwright browser installation.

**Architecture:** Playwright MCP is already registered (stdio transport, `@playwright/mcp`). Browser binaries need installation (`npx playwright install`). Screenshots from `browser_take_screenshot` are intercepted and stored via VisualActionService. Hatching and settings follow the S2 desktop control pattern (silent check + guided install + toggle).

**Tech Stack:** TypeScript, `@playwright/mcp` (already installed), Fastify, Alpine.js, vitest

**Design spec:** `docs/superpowers/specs/2026-03-29-m8-desktop-automation-design.md`
**Depends on:** M8-S1 (VisualActionService), M8-S2 (patterns for hatching + settings)

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/dashboard/src/playwright/playwright-status.ts` | Detect installed browsers, check Playwright readiness |
| `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts` | Intercept Playwright screenshots, store via VAS |
| `packages/dashboard/src/routes/playwright-routes.ts` | API endpoints: status, install, toggle |
| `packages/dashboard/tests/unit/playwright/playwright-status.test.ts` | Status detection tests |
| `packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts` | Screenshot bridge tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/dashboard/src/hatching/hatching-tools.ts` | Add `get_playwright_status` tool |
| `packages/dashboard/src/hatching/hatching-prompt.ts` | Add Playwright setup step (step 8) |
| `packages/dashboard/src/agent/session-manager.ts` | Conditionally register Playwright MCP based on browser availability |
| `packages/dashboard/src/app.ts` | Wire Playwright status + screenshot bridge |
| `packages/dashboard/src/server.ts` | Register Playwright routes |
| `packages/dashboard/public/index.html` | Add Playwright settings section |

---

## Task 1: Playwright Status Detection

**Files:**
- Create: `packages/dashboard/src/playwright/playwright-status.ts`
- Create: `packages/dashboard/tests/unit/playwright/playwright-status.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/playwright/playwright-status.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectPlaywrightStatus } from "../../../src/playwright/playwright-status.js";

// We can't easily mock the filesystem for browser detection,
// but we can test the interface and logic.
describe("detectPlaywrightStatus", () => {
  it("returns a PlaywrightStatus object", async () => {
    const status = await detectPlaywrightStatus();

    expect(status).toHaveProperty("installed");
    expect(status).toHaveProperty("browsers");
    expect(status).toHaveProperty("setupNeeded");
    expect(typeof status.installed).toBe("boolean");
    expect(Array.isArray(status.browsers)).toBe(true);
    expect(Array.isArray(status.setupNeeded)).toBe(true);
  });

  it("browsers array contains objects with name and installed", async () => {
    const status = await detectPlaywrightStatus();

    for (const browser of status.browsers) {
      expect(browser).toHaveProperty("name");
      expect(browser).toHaveProperty("installed");
      expect(typeof browser.name).toBe("string");
      expect(typeof browser.installed).toBe("boolean");
    }
  });

  it("setupNeeded is non-empty when browsers are missing", async () => {
    const status = await detectPlaywrightStatus();

    const anyMissing = status.browsers.some((b) => !b.installed);
    if (anyMissing) {
      expect(status.setupNeeded.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/playwright/playwright-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Playwright status detection**

```typescript
// packages/dashboard/src/playwright/playwright-status.ts
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface BrowserStatus {
  name: string;
  installed: boolean;
}

export interface PlaywrightStatus {
  /** Whether @playwright/mcp package is available */
  installed: boolean;
  /** Whether at least one browser is installed and ready */
  ready: boolean;
  /** Per-browser installation status */
  browsers: BrowserStatus[];
  /** Human-readable setup instructions if something is missing */
  setupNeeded: string[];
  /** Whether Playwright is enabled in settings (user can toggle off) */
  enabled: boolean;
}

/**
 * Detect Playwright installation status by checking the browser cache directory.
 * Playwright stores browsers in ~/.cache/ms-playwright/ on Linux.
 */
export async function detectPlaywrightStatus(
  enabled = true,
): Promise<PlaywrightStatus> {
  // Check if @playwright/mcp is importable
  let packageInstalled = false;
  try {
    require.resolve("@playwright/mcp");
    packageInstalled = true;
  } catch {
    // Package not installed
  }

  if (!packageInstalled) {
    return {
      installed: false,
      ready: false,
      browsers: [],
      setupNeeded: ["Install @playwright/mcp: npm install @playwright/mcp"],
      enabled,
    };
  }

  // Check browser cache directory
  const cacheDir = join(homedir(), ".cache", "ms-playwright");
  const browserChecks: BrowserStatus[] = [];

  // Check for common browser directories
  const browserDirs = [
    { name: "Chromium", pattern: "chromium-" },
    { name: "Firefox", pattern: "firefox-" },
  ];

  for (const { name, pattern } of browserDirs) {
    let found = false;
    if (existsSync(cacheDir)) {
      try {
        const entries = require("fs").readdirSync(cacheDir);
        found = entries.some((e: string) => e.startsWith(pattern));
      } catch {
        // Can't read cache dir
      }
    }
    browserChecks.push({ name, installed: found });
  }

  const anyInstalled = browserChecks.some((b) => b.installed);
  const setupNeeded: string[] = [];

  if (!anyInstalled) {
    setupNeeded.push("Install Playwright browsers: npx playwright install");
  } else {
    const missing = browserChecks.filter((b) => !b.installed);
    for (const b of missing) {
      setupNeeded.push(
        `Install ${b.name}: npx playwright install ${b.name.toLowerCase()}`,
      );
    }
  }

  return {
    installed: true,
    ready: anyInstalled,
    browsers: browserChecks,
    setupNeeded,
    enabled,
  };
}

/**
 * Install Playwright browsers by running npx playwright install.
 * Returns stdout/stderr from the install process.
 */
export function installPlaywrightBrowsers(): {
  success: boolean;
  output: string;
} {
  try {
    const output = execFileSync("npx", ["playwright", "install"], {
      encoding: "utf-8",
      timeout: 300_000, // 5 minute timeout for downloads
    });
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/playwright/playwright-status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/playwright/playwright-status.ts packages/dashboard/tests/unit/playwright/playwright-status.test.ts
git commit -m "feat(dashboard): Playwright status detection — browser install checks"
```

---

## Task 2: Playwright API Routes

**Files:**
- Create: `packages/dashboard/src/routes/playwright-routes.ts`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Implement the routes**

```typescript
// packages/dashboard/src/routes/playwright-routes.ts
import type { FastifyInstance } from "fastify";
import {
  detectPlaywrightStatus,
  installPlaywrightBrowsers,
} from "../playwright/playwright-status.js";

/** Persistent enabled state — toggled by user in settings. */
let playwrightEnabled = true;

export function isPlaywrightEnabled(): boolean {
  return playwrightEnabled;
}

export async function registerPlaywrightRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/api/debug/playwright-status", async () => {
    return detectPlaywrightStatus(playwrightEnabled);
  });

  fastify.post("/api/debug/playwright-toggle", async () => {
    playwrightEnabled = !playwrightEnabled;
    return { enabled: playwrightEnabled };
  });

  fastify.post("/api/debug/playwright-install", async () => {
    const result = installPlaywrightBrowsers();
    return result;
  });
}
```

- [ ] **Step 2: Register routes in server.ts**

In `packages/dashboard/src/server.ts`, add the import:

```typescript
import { registerPlaywrightRoutes } from "./routes/playwright-routes.js";
```

And register in the route section:

```typescript
await registerPlaywrightRoutes(fastify);
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/routes/playwright-routes.ts packages/dashboard/src/server.ts
git commit -m "feat(dashboard): Playwright API routes — status, toggle, install"
```

---

## Task 3: Playwright Screenshot Bridge

**Files:**
- Create: `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts`
- Create: `packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts`

The bridge intercepts Playwright screenshot results and stores them via VisualActionService. Since Playwright MCP runs as a stdio subprocess, we can't directly hook into its tool results. Instead, we watch for screenshot files in the working directory and capture them.

Alternative approach: The brain already receives Playwright screenshots as base64 image content blocks in tool results. We can intercept at the Agent SDK response level — when the brain processes a `browser_take_screenshot` result, the bridge extracts the image and stores it.

The simplest approach: provide a utility that the brain's post-response processing can call.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PlaywrightScreenshotBridge } from "../../../src/playwright/playwright-screenshot-bridge.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { AssetContext } from "@my-agent/core";

describe("PlaywrightScreenshotBridge", () => {
  let vas: VisualActionService;
  let bridge: PlaywrightScreenshotBridge;
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pw-bridge-"));
    mkdirSync(join(agentDir, "conversations", "conv-1"), { recursive: true });
    vas = new VisualActionService(agentDir);
    bridge = new PlaywrightScreenshotBridge(vas);
  });

  it("stores a base64 screenshot via VisualActionService", () => {
    const base64 = Buffer.from("fake-png-data").toString("base64");
    const context: AssetContext = { type: "conversation", id: "conv-1" };

    const screenshot = bridge.captureFromBase64(base64, {
      context,
      description: "Playwright: navigated to google.com",
    });

    expect(screenshot.id).toMatch(/^ss-/);
    expect(screenshot.context).toEqual(context);
    expect(screenshot.description).toBe(
      "Playwright: navigated to google.com",
    );
    expect(screenshot.tag).toBe("keep");
  });

  it("stores with job context", () => {
    mkdirSync(
      join(agentDir, "automations", ".runs", "auto-1", "job-1"),
      { recursive: true },
    );
    const base64 = Buffer.from("fake-png-data").toString("base64");
    const context: AssetContext = {
      type: "job",
      id: "job-1",
      automationId: "auto-1",
    };

    const screenshot = bridge.captureFromBase64(base64, { context });
    expect(screenshot.context.type).toBe("job");
  });

  it("lists stored screenshots", () => {
    const base64 = Buffer.from("data").toString("base64");
    const context: AssetContext = { type: "conversation", id: "conv-1" };

    bridge.captureFromBase64(base64, { context, description: "first" });
    bridge.captureFromBase64(base64, { context, description: "second" });

    const screenshots = vas.list(context);
    expect(screenshots).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/playwright/playwright-screenshot-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bridge**

```typescript
// packages/dashboard/src/playwright/playwright-screenshot-bridge.ts
import type { AssetContext, Screenshot, ScreenshotTag } from "@my-agent/core";
import type { VisualActionService } from "../visual/visual-action-service.js";

interface CaptureOptions {
  context: AssetContext;
  description?: string;
  tag?: ScreenshotTag;
  width?: number;
  height?: number;
}

/**
 * Bridge between Playwright MCP screenshot results and VisualActionService.
 *
 * Playwright MCP's browser_take_screenshot returns base64-encoded images.
 * This bridge takes those base64 strings and stores them through the
 * standard visual pipeline — JSONL index, StatePublisher events, dashboard rendering.
 */
export class PlaywrightScreenshotBridge {
  constructor(private readonly vas: VisualActionService) {}

  /**
   * Capture a Playwright screenshot from a base64-encoded string.
   * Called when the brain receives a browser_take_screenshot tool result.
   */
  captureFromBase64(
    base64Data: string,
    options: CaptureOptions,
  ): Screenshot {
    const image = Buffer.from(base64Data, "base64");

    return this.vas.store(
      image,
      {
        context: options.context,
        description: options.description ?? "Playwright browser screenshot",
        width: options.width ?? 1280,
        height: options.height ?? 720,
      },
      options.tag ?? "keep",
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/playwright/playwright-screenshot-bridge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/playwright/playwright-screenshot-bridge.ts packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts
git commit -m "feat(dashboard): Playwright screenshot bridge — stores browser screenshots via VAS"
```

---

## Task 4: Wire Bridge into Agent Response Processing

**Files:**
- Modify: `packages/dashboard/src/app.ts`
- Modify: `packages/dashboard/src/agent/session-manager.ts`

This is the integration point. When the brain uses `browser_take_screenshot`, the result flows back as a tool_result content block with a base64 image. We need to intercept this and feed it to the bridge.

- [ ] **Step 1: Read how tool results are currently processed**

Read `packages/dashboard/src/agent/session-manager.ts` and the chat handler to understand where tool results from MCP servers are processed. Look for where response content blocks are iterated.

- [ ] **Step 2: Add PlaywrightScreenshotBridge to App**

In `packages/dashboard/src/app.ts`, add:

```typescript
import { PlaywrightScreenshotBridge } from "./playwright/playwright-screenshot-bridge.js";
```

In the App class, add as a property:

```typescript
readonly playwrightBridge: PlaywrightScreenshotBridge;
```

In the constructor, after `visualActionService`:

```typescript
this.playwrightBridge = new PlaywrightScreenshotBridge(this.visualActionService);
```

- [ ] **Step 3: Conditionally register Playwright MCP based on availability**

In `session-manager.ts`, update the Playwright registration to check browser availability:

```typescript
import { detectPlaywrightStatus } from "../playwright/playwright-status.js";
import { isPlaywrightEnabled } from "../routes/playwright-routes.js";

// In initMcpServers():
const pwStatus = await detectPlaywrightStatus();
if (pwStatus.ready && isPlaywrightEnabled()) {
  servers.playwright = {
    type: "stdio" as const,
    command: "npx",
    args: ["@playwright/mcp"],
  };
  console.log("[SessionManager] Playwright MCP registered (browsers available)");
} else {
  console.log(
    `[SessionManager] Playwright MCP not registered: installed=${pwStatus.installed}, ready=${pwStatus.ready}, enabled=${isPlaywrightEnabled()}`,
  );
}
```

- [ ] **Step 4: Wire screenshot interception into response processing**

Find where the brain's response content blocks are processed (likely in the chat service or session iteration). Add a hook that checks for `browser_take_screenshot` tool results:

```typescript
// In the response processing loop (after tool results are received):
// Check if this is a Playwright screenshot result
if (
  toolName === "mcp__playwright__browser_take_screenshot" &&
  contentBlock.type === "image" &&
  contentBlock.source?.type === "base64"
) {
  app.playwrightBridge.captureFromBase64(
    contentBlock.source.data,
    {
      context: currentContext, // conversation or job context
      description: `Playwright: ${toolInput?.filename || "browser screenshot"}`,
    },
  );
}
```

Note: The exact integration point depends on how the existing code processes tool results. Read the code first and follow the existing pattern. The key is finding where image content blocks from MCP tool results are accessible.

- [ ] **Step 5: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/app.ts packages/dashboard/src/agent/session-manager.ts
git commit -m "feat(dashboard): wire Playwright bridge into App + conditional MCP registration"
```

---

## Task 5: Hatching Step — Playwright Setup

**Files:**
- Modify: `packages/dashboard/src/hatching/hatching-tools.ts`
- Modify: `packages/dashboard/src/hatching/hatching-prompt.ts`

- [ ] **Step 1: Read current hatching-tools.ts to find the desktop status tool pattern**

Read `packages/dashboard/src/hatching/hatching-tools.ts` — find the `get_desktop_status` tool definition. S3 follows the same pattern.

- [ ] **Step 2: Add get_playwright_status tool**

After the `get_desktop_status` tool, add:

```typescript
const getPlaywrightStatusTool = tool(
  "get_playwright_status",
  "Check whether Playwright browser automation is available. Returns installation status of browser binaries. Use this silently during hatching to determine if Playwright setup is needed.",
  {},
  async () => {
    const status = await detectPlaywrightStatus();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            installed: status.installed,
            ready: status.ready,
            browsers: status.browsers,
            setupNeeded: status.setupNeeded,
          }),
        },
      ],
    };
  },
);
```

Add the import at the top:

```typescript
import { detectPlaywrightStatus } from "../playwright/playwright-status.js";
```

Add `getPlaywrightStatusTool` to the tools array in `createHatchingTools`.

- [ ] **Step 3: Add Playwright step to hatching prompt**

In `packages/dashboard/src/hatching/hatching-prompt.ts`, after the desktop control step (step 7), add step 8:

```
8. Playwright browser automation (optional, non-blocking):
   - Call get_playwright_status silently
   - IF ready=true → mention briefly ("Browser automation ready — Chromium/Firefox available")
   - IF installed=true but ready=false → present choices:
     * "Install Playwright Browsers" (runs npx playwright install)
     * "Skip for now"
   - IF installed=false → skip entirely (package not available)
   - This step is always skippable — never block hatching
```

- [ ] **Step 4: Verify hatching compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/hatching/hatching-tools.ts packages/dashboard/src/hatching/hatching-prompt.ts
git commit -m "feat(dashboard): Playwright hatching step — guided browser installation"
```

---

## Task 6: Settings UI — Playwright Section

**Files:**
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: Read the desktop control settings section for the pattern**

Read `packages/dashboard/public/index.html` around lines 2915-3008 to see the desktop control UI pattern.

- [ ] **Step 2: Add Playwright settings section after Desktop Control**

Follow the same glass-strong panel pattern:

```html
<!-- Playwright Browser Automation -->
<div class="glass-strong rounded-xl p-5">
  <div
    x-data="{ status: null, installing: false }"
    x-init="
      fetch('/api/debug/playwright-status')
        .then(r => r.json())
        .then(d => status = d)
        .catch(() => {})
    "
  >
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-white/90">Browser Automation</h3>

      <!-- Toggle -->
      <template x-if="status && status.ready">
        <label class="flex items-center gap-2 cursor-pointer">
          <div
            class="relative w-8 h-4 rounded-full transition-colors"
            :class="status.enabled ? 'bg-violet-500/60' : 'bg-white/10'"
            @click="
              fetch('/api/debug/playwright-toggle', { method: 'POST' })
                .then(r => r.json())
                .then(d => status.enabled = d.enabled)
            "
          >
            <div
              class="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform"
              :class="status.enabled ? 'translate-x-4' : ''"
            ></div>
          </div>
        </label>
      </template>
    </div>

    <!-- Status indicator -->
    <template x-if="status && status.ready && status.enabled">
      <span class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-xs text-white/70">Ready</span>
      </span>
    </template>
    <template x-if="status && status.ready && !status.enabled">
      <span class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-white/20"></span>
        <span class="text-xs text-white/40">Disabled</span>
      </span>
    </template>
    <template x-if="status && !status.ready && status.installed">
      <span class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-amber-400"></span>
        <span class="text-xs text-white/50">Browsers not installed</span>
      </span>
    </template>

    <!-- Browser list -->
    <template x-if="status && status.browsers && status.browsers.length > 0">
      <div class="grid grid-cols-2 gap-2 mt-3">
        <template x-for="b in status.browsers" :key="b.name">
          <div class="flex items-center gap-1.5">
            <span
              class="text-xs"
              :class="b.installed ? 'text-emerald-400' : 'text-white/20'"
              x-text="b.installed ? '✓' : '✗'"
            ></span>
            <span class="text-xs text-white/50" x-text="b.name"></span>
          </div>
        </template>
      </div>
    </template>

    <!-- Install button -->
    <template x-if="status && status.setupNeeded && status.setupNeeded.length > 0">
      <div class="mt-3">
        <button
          class="px-3 py-1.5 text-xs rounded bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors"
          :disabled="installing"
          @click="
            installing = true;
            fetch('/api/debug/playwright-install', { method: 'POST' })
              .then(r => r.json())
              .then(() => fetch('/api/debug/playwright-status'))
              .then(r => r.json())
              .then(d => { status = d; installing = false; })
              .catch(() => installing = false)
          "
          x-text="installing ? 'Installing...' : 'Install Playwright Browsers'"
        ></button>
      </div>
    </template>
  </div>
</div>
```

Note: Match the exact design language from the desktop control section. Read the file first and follow the class patterns.

- [ ] **Step 3: Restart dashboard and verify**

Run: `systemctl --user restart nina-dashboard.service`

Open Settings. Verify:
- Playwright section appears below Desktop Control
- Shows browser status (installed/missing)
- Install button works if browsers are missing
- Toggle works if browsers are installed

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): Playwright settings UI — browser status, toggle, install button"
```

---

## Task 7: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full dashboard test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Run TypeScript check**

Run: `cd packages/dashboard && npx tsc --noEmit && cd ../core && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Verify dashboard starts**

Run: `systemctl --user restart nina-dashboard.service && sleep 2 && systemctl --user status nina-dashboard.service`
Expected: Active (running). Logs should show Playwright status.

- [ ] **Step 4: End-to-end smoke test**

If Playwright browsers are installed:
1. Ask Nina in chat: "Take a screenshot of google.com using Playwright"
2. Verify the screenshot appears in the conversation
3. Check the timeline for the screenshot thumbnail

If browsers not installed:
1. Verify the Settings UI shows "Browsers not installed"
2. Click "Install Playwright Browsers"
3. After install, verify status changes to "Ready"

---

## Success Criteria

- [ ] Playwright status detection identifies installed/missing browsers
- [ ] Hatching step guides users through browser installation (matching desktop control pattern)
- [ ] Settings UI shows Playwright status, toggle, and install button
- [ ] Playwright MCP conditionally registered based on browser availability + toggle
- [ ] PlaywrightScreenshotBridge stores browser screenshots via VisualActionService
- [ ] Screenshots from `browser_take_screenshot` appear in dashboard timeline
- [ ] Screenshots from `browser_take_screenshot` render inline in chat
- [ ] Retention/tagging from S1 applies to Playwright screenshots
- [ ] All existing tests still pass
