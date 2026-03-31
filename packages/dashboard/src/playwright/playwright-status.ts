import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

  const browserDirs = [
    { name: "Chromium", pattern: "chromium-" },
    { name: "Firefox", pattern: "firefox-" },
  ];

  for (const { name, pattern } of browserDirs) {
    let found = false;
    if (existsSync(cacheDir)) {
      try {
        const entries = readdirSync(cacheDir);
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
 * Install Playwright browsers asynchronously using child_process.spawn.
 * Does NOT block the event loop.
 */
export function installPlaywrightBrowsers(): Promise<{
  success: boolean;
  output: string;
}> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["playwright", "install"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code: number | null) => {
      resolve({
        success: code === 0,
        output: code === 0 ? stdout : stderr || stdout,
      });
    });

    proc.on("error", (err: Error) => {
      resolve({ success: false, output: err.message });
    });
  });
}
