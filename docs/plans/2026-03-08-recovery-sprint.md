# Recovery Sprint — New Machine Setup

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Get Nina fully operational on the new OVH VPS — auth via UI, secrets protection, personality review, dashboard running.

**Architecture:** `.env` becomes the single source of truth for all secrets. Auth gate on WebSocket blocks UI until credentials are configured. Auto-guardrails protect `.env` values from leaking into LLM context.

**Tech Stack:** Node.js, Fastify, Alpine.js, WebSocket, better-sqlite3

---

### Task 1: `.env` Read/Write Utility

**Files:**
- Create: `packages/core/src/env.ts`
- Modify: `packages/core/src/lib.ts` (add export)
- Test: `packages/core/tests/env.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/env.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { getEnvValue, setEnvValue, removeEnvValue, getAllSecrets } from "../src/env.js";

describe("env utility", () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "env-test-"));
    envPath = join(dir, ".env");
  });

  it("reads existing value", () => {
    writeFileSync(envPath, "FOO=bar\nBAZ=qux\n");
    expect(getEnvValue(envPath, "FOO")).toBe("bar");
    expect(getEnvValue(envPath, "BAZ")).toBe("qux");
  });

  it("returns null for missing key", () => {
    writeFileSync(envPath, "FOO=bar\n");
    expect(getEnvValue(envPath, "MISSING")).toBeNull();
  });

  it("returns null for missing file", () => {
    expect(getEnvValue(join(dir, "nope"), "FOO")).toBeNull();
  });

  it("sets new value", () => {
    writeFileSync(envPath, "PORT=4321\n");
    setEnvValue(envPath, "API_KEY", "sk-123");
    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("API_KEY=sk-123");
    expect(content).toContain("PORT=4321");
  });

  it("updates existing value", () => {
    writeFileSync(envPath, "API_KEY=old\nPORT=4321\n");
    setEnvValue(envPath, "API_KEY", "new");
    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("API_KEY=new");
    expect(content).not.toContain("old");
    expect(content).toContain("PORT=4321");
  });

  it("removes value", () => {
    writeFileSync(envPath, "API_KEY=secret\nPORT=4321\n");
    removeEnvValue(envPath, "API_KEY");
    const content = readFileSync(envPath, "utf-8");
    expect(content).not.toContain("API_KEY");
    expect(content).toContain("PORT=4321");
  });

  it("skips comments and blank lines", () => {
    writeFileSync(envPath, "# comment\n\nFOO=bar\n# HIDDEN=x\n");
    expect(getEnvValue(envPath, "FOO")).toBe("bar");
    expect(getEnvValue(envPath, "HIDDEN")).toBeNull();
  });

  it("getAllSecrets returns non-config values", () => {
    writeFileSync(envPath, "PORT=4321\nANTHROPIC_API_KEY=sk-123\nHOST=0.0.0.0\n");
    const secrets = getAllSecrets(envPath);
    expect(secrets).toContain("sk-123");
    expect(secrets).not.toContain("4321");
    expect(secrets).not.toContain("0.0.0.0");
  });

  it("handles commented-out keys", () => {
    writeFileSync(envPath, "# ANTHROPIC_API_KEY=sk-old\nPORT=4321\n");
    expect(getEnvValue(envPath, "ANTHROPIC_API_KEY")).toBeNull();
  });

  it("creates file if missing on set", () => {
    const newPath = join(dir, "new.env");
    setEnvValue(newPath, "KEY", "val");
    expect(readFileSync(newPath, "utf-8")).toContain("KEY=val");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/env.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/env.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Keys that are config, not secrets — excluded from getAllSecrets()
const CONFIG_KEYS = new Set(["PORT", "HOST", "NODE_ENV"]);

export function getEnvValue(envPath: string, key: string): string | null {
  if (!existsSync(envPath)) return null;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === key) {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}

export function setEnvValue(envPath: string, key: string, value: string): void {
  let lines: string[] = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, "utf-8").split("\n");
  }

  let found = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    if (trimmed.slice(0, eq) === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${key}=${value}`);
  }

  writeFileSync(envPath, updated.join("\n"), { encoding: "utf-8", mode: 0o600 });
}

export function removeEnvValue(envPath: string, key: string): void {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return true;
    return trimmed.slice(0, eq) !== key;
  });
  writeFileSync(envPath, filtered.join("\n"), { encoding: "utf-8", mode: 0o600 });
}

export function getAllSecrets(envPath: string): string[] {
  if (!existsSync(envPath)) return [];
  const lines = readFileSync(envPath, "utf-8").split("\n");
  const secrets: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!CONFIG_KEYS.has(key) && value) {
      secrets.push(value);
    }
  }
  return secrets;
}
```

**Step 4: Export from lib.ts**

Add to `packages/core/src/lib.ts`:
```typescript
export { getEnvValue, setEnvValue, removeEnvValue, getAllSecrets } from './env.js'
```

**Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/env.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat(core): add .env read/write utility

Source of truth for secrets. Supports get/set/remove individual
keys and extracting all secret values for guardrail checks.
```

---

### Task 2: Rewrite `resolveAuth()` — `.env` First, No `auth.json`

**Files:**
- Modify: `packages/core/src/auth.ts` — flip resolution order, read from `.env`
- Modify: `packages/core/src/lib.ts` — export `getEnvPath`
- Test: `packages/core/tests/auth.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/auth.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

// We test resolveAuth indirectly by setting process.env
// The real test is that .env file values are picked up

describe("resolveAuth", () => {
  let originalApiKey: string | undefined;
  let originalOAuth: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    originalOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  afterEach(() => {
    if (originalApiKey) process.env.ANTHROPIC_API_KEY = originalApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalOAuth) process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuth;
    else delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  it("resolves from process.env when set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { resolveAuth } = await import("../src/auth.js");
    const result = resolveAuth("/tmp/fake-agent-dir");
    expect(result.type).toBe("api_key");
    expect(result.source).toBe("env");
  });

  it("throws when nothing configured", async () => {
    const { resolveAuth } = await import("../src/auth.js");
    expect(() => resolveAuth("/tmp/nonexistent")).toThrow();
  });
});
```

**Step 2: Run test to verify baseline**

Run: `cd packages/core && npx vitest run tests/auth.test.ts`

**Step 3: Rewrite `resolveAuth()`**

In `packages/core/src/auth.ts`:
- Remove `readAuthFile()` and `writeAuthFile()` (keep `validateSetupToken`)
- Simplify `resolveAuth()` to only check `process.env` (the `.env` file is loaded at process start by `node --env-file`)
- Add `clearAuth()` that removes keys from `process.env`

```typescript
// Simplified resolveAuth — .env is loaded by node --env-file at startup
// No auth.json, no file reading at runtime
export function resolveAuth(agentDir: string): ResolvedAuth {
  if (process.env.ANTHROPIC_API_KEY) {
    return { type: 'api_key', source: 'env' }
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { type: 'setup_token', source: 'env' }
  }
  throw new Error(
    'No Anthropic authentication configured. Use the dashboard to set up authentication.',
  )
}

export function isAuthenticated(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN)
}

export function clearAuth(): void {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
}
```

**Step 4: Update `ScriptedHatchingEngine` to save to `.env`**

In `packages/dashboard/src/hatching/scripted-engine.ts`:
- Import `setEnvValue` from `@my-agent/core`
- Replace `saveAuth()` call with `setEnvValue(envPath, key, token)` + `process.env[key] = token`
- Remove `createDirectoryStructure()` and `writeMinimalConfig()` from `finalize()` — directory setup should not be coupled to auth

**Step 5: Update imports across codebase**

Remove `readAuthFile`/`writeAuthFile` imports from:
- `packages/core/src/lib.ts`
- `packages/core/src/hatching/logic.ts`
- `packages/dashboard/src/routes/admin.ts`

Add `isAuthenticated`, `clearAuth` exports.

**Step 6: Run tests**

Run: `cd packages/core && npx vitest run && cd ../dashboard && npx vitest run`
Expected: All pass (existing tests may need import fixes)

**Step 7: Commit**

```
refactor(auth): .env as single source of truth, remove auth.json

resolveAuth() now only checks process.env. The .env file is loaded
by node --env-file at startup. No more auth.json file reading at
runtime — reduces context leak surface.
```

---

### Task 3: Auth Gate on WebSocket Connect

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts` — add `auth_required` / `auth_ok` message types
- Modify: `packages/dashboard/src/ws/chat-handler.ts` — auth check before hatching check
- Modify: `packages/dashboard/src/hatching/scripted-engine.ts` — decouple from hatching
- Modify: `packages/dashboard/public/js/app.js` — handle `auth_required` blocking state

**Step 1: Add protocol messages**

In `packages/dashboard/src/ws/protocol.ts`, add to `ServerMessage`:
```typescript
  | { type: "auth_required" }
  | { type: "auth_ok" }
```

**Step 2: Add auth check in chat-handler.ts**

At the top of the WebSocket connection handler (before hatching check):

```typescript
// Auth gate — check before anything else
const authenticated = isAuthenticated();
if (!authenticated) {
  send({ type: "auth_required" });
  // Start auth flow (reuse ScriptedHatchingEngine in auth-only mode)
  scriptedEngine = new ScriptedHatchingEngine(fastify.agentDir, {
    send,
    onComplete: () => {
      scriptedEngine = null;
      send({ type: "auth_ok" });
      // If not hatched, continue to Phase 2
      if (!fastify.isHatched) {
        // ... existing Phase 2 hatching code ...
      }
    },
  });
  scriptedEngine.start();
  return; // Don't proceed to conversation loading
}

send({ type: "auth_ok" });
```

**Step 3: Decouple ScriptedHatchingEngine from hatching**

In `scripted-engine.ts`, remove from `finalize()`:
- `createDirectoryStructure()` — already done during initial setup
- `writeMinimalConfig()` — already exists
- Change bridge message from "Now let me get to know you..." to just "Credentials saved." (the caller decides what happens next)

Save to `.env` instead of `auth.json`:
```typescript
import { setEnvValue } from "@my-agent/core";
import { join } from "node:path";

// In finalize():
if (!this.useEnvAuth && this.authToken) {
  const envPath = join(this.agentDir, "../packages/dashboard/.env");
  const key = this.authMethod === "subscription"
    ? "CLAUDE_CODE_OAUTH_TOKEN"
    : "ANTHROPIC_API_KEY";
  setEnvValue(envPath, key, this.authToken);
  process.env[key] = this.authToken;
}
```

Note: The `envPath` needs to resolve to the dashboard `.env`. The engine receives a callback — the dashboard `chat-handler.ts` should pass the correct `.env` path rather than having the engine guess. Add `envPath` to the constructor options.

**Step 4: Handle `auth_required` in frontend**

In `packages/dashboard/public/js/app.js`, add state:
```javascript
needsAuth: false, // True when server says auth_required
```

In the WebSocket message handler, add:
```javascript
case "auth_required":
  this.needsAuth = true;
  break;
case "auth_ok":
  this.needsAuth = false;
  break;
```

In `packages/dashboard/public/index.html`, add a blocking overlay (shown when `needsAuth` is true):
```html
<!-- Auth gate — blocks entire UI -->
<div x-show="needsAuth" x-cloak class="fixed inset-0 z-[9999] bg-[#1a1b26] flex items-center justify-center">
  <!-- Chat messages render here (auth flow uses same message UI) -->
</div>
```

The auth flow messages (buttons, compose hints) already render in the chat area. The blocking overlay just prevents access to the rest of the UI.

**Mobile:** The auth gate must work on mobile viewports (390px+). The overlay is full-screen so it naturally works, but ensure the auth buttons and compose hint input are touch-friendly and properly sized. Follow existing responsive patterns from M2-S7 (breakpoint system, touch targets).

**Step 5: Test manually**

1. Remove `ANTHROPIC_API_KEY` from `.env` → restart dashboard → should see auth gate
2. Enter key → should save to `.env` and proceed
3. Verify `.env` now contains the key
4. Restart dashboard → should load normally (key in `.env`)

**Step 6: Commit**

```
feat(dashboard): auth gate on WebSocket connect

Blocks UI when no API credentials configured. Same auth flow as
hatching wizard. Credentials saved to .env file.
```

---

### Task 4: Logout Endpoint + Settings UI

**Files:**
- Modify: `packages/dashboard/src/routes/admin.ts` — add `POST /auth/logout`
- Modify: `packages/dashboard/src/ws/chat-handler.ts` — broadcast `auth_required` on logout
- Modify: `packages/dashboard/public/js/app.js` — add logout button in settings

**Step 1: Add logout route**

In `packages/dashboard/src/routes/admin.ts`:
```typescript
fastify.post("/auth/logout", async (request, reply) => {
  // Clear from process.env
  clearAuth();

  // Clear from .env file
  const envPath = join(fastify.agentDir, "../packages/dashboard/.env");
  removeEnvValue(envPath, "ANTHROPIC_API_KEY");
  removeEnvValue(envPath, "CLAUDE_CODE_OAUTH_TOKEN");

  // Broadcast auth_required to all connected WebSockets
  connectionRegistry.broadcast({ type: "auth_required" });

  reply.send({ ok: true });
});
```

Note: `connectionRegistry` needs to be accessible from admin routes. Either pass it via Fastify decorator or import the singleton.

**Step 2: Add logout button to settings UI**

In the settings section of `app.js`, add a logout button:
```javascript
// In settings tab, add auth section
async logout() {
  if (!confirm("Log out? You'll need to re-enter credentials.")) return;
  await fetch("/auth/logout", { method: "POST" });
  // auth_required will arrive via WebSocket, triggering the gate
}
```

In `index.html` settings area, add:
```html
<button @click="logout()" class="px-3 py-1.5 rounded text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30">
  Log out
</button>
```

**Step 3: Test manually**

1. Dashboard running with valid key → click Logout
2. Should see auth gate immediately
3. Enter new key → should work

**Step 4: Commit**

```
feat(dashboard): auth logout from settings

Clears credentials from .env and process.env, broadcasts
auth_required to all connected clients.
```

---

### Task 5: Auto-Guardrails From `.env` Secrets

**Files:**
- Modify: `.guardrails-hook.sh` (or wherever the PostToolUse hook lives)
- Modify: `.git/hooks/pre-commit` (if it's a shell script)

**Step 1: Find the existing hook implementations**

Check:
- `.claude/hooks.json` — Claude Code PostToolUse hook config
- `.git/hooks/pre-commit` — git pre-commit script
- Any shell scripts referenced by these

**Step 2: Add `.env` value scanning**

In the pre-commit hook, after existing `.guardrails` pattern checks, add:
```bash
# Auto-guardrail: check staged files against .env secret values
ENV_FILE="packages/dashboard/.env"
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    # Skip comments, blank lines, and config keys
    [[ "$key" =~ ^#.*$ || -z "$key" || -z "$value" ]] && continue
    [[ "$key" == "PORT" || "$key" == "HOST" || "$key" == "NODE_ENV" ]] && continue
    # Check if any staged file contains this secret value
    if git diff --cached --diff-filter=d -U0 | grep -qF "$value"; then
      echo "BLOCKED: Staged file contains secret value from .env ($key)"
      exit 1
    fi
  done < "$ENV_FILE"
fi
```

Similarly for the PostToolUse hook (if it's a shell script that checks file contents).

**Step 3: Test**

1. Add a fake secret to `.env`: `TEST_SECRET=supersecretvalue123`
2. Try to commit a file containing `supersecretvalue123` → should be blocked
3. Remove the fake secret

**Step 4: Commit**

```
feat(hooks): auto-guardrail .env secrets in pre-commit

Scans staged files against all non-config values in .env.
No manual pattern maintenance needed for secrets.
```

---

### Task 6: Cleanup — Remove `auth.json` References

**Files:**
- Modify: `packages/core/src/auth.ts` — remove dead code
- Modify: `packages/core/src/hatching/logic.ts` — remove `saveAuth`
- Modify: `packages/core/src/hatching/steps/auth.ts` — update for `.env`
- Modify: `packages/dashboard/src/routes/admin.ts` — remove auth.json unlink
- Modify: `docs/design.md` — update auth section
- Delete: `.my_agent/auth.json` if it exists

**Step 1: Remove dead code**

- `readAuthFile()`, `writeAuthFile()`, `AuthFile` interface from `auth.ts`
- `saveAuth()` from `hatching/logic.ts`
- `auth.json` unlink from `admin.ts` hatching reset

**Step 2: Update design doc**

In `docs/design.md`, update the Authentication section:
- Source of truth: `packages/dashboard/.env`
- Resolution: `process.env` (loaded from `.env` by `node --env-file`)
- No `auth.json`

**Step 3: Run full test suite**

Run: `cd packages/core && npx vitest run && cd ../dashboard && npx vitest run`
Expected: All pass

**Step 4: Commit**

```
refactor: remove auth.json, update docs

.env is now the single source of truth for all secrets.
auth.json was removed from the codebase.
```

---

### Task 7: Review and Update Nina's Personality Files

**Files:**
- Review: `.my_agent/brain/CLAUDE.md`
- Review: `.my_agent/NINA-ESSENCE.md`
- Review: `.my_agent/notebook/reference/standing-orders.md`
- Review: `.my_agent/notebook/reference/contacts.md`

**Step 1: Present files to user for review**

This is a manual step. Show the user each file and ask what to keep, update, or remove. The files were recovered from the OpenClaw workspace and may contain outdated information.

**Step 2: Apply user edits**

Update files based on user feedback.

**Step 3: No commit** (these are in `.my_agent/`, gitignored)

---

### Task 8: Verify Dashboard E2E

**Step 1: Restart dashboard**

```bash
systemctl --user restart nina-dashboard
```

**Step 2: Verify auth gate**

1. Open `http://100.71.154.24:4321` with no API key in `.env`
2. Should see blocking auth screen
3. Enter API key → should proceed to chat

**Step 3: Verify chat works**

Send a test message, verify streaming response.

**Step 4: Verify logout**

Settings → Logout → should return to auth screen.

**Step 5: Verify persistence**

Restart service → should load key from `.env` automatically.

---

## Sprint Summary

| Task | Scope | Risk |
|------|-------|------|
| 1. `.env` utility | Core, additive | Low |
| 2. Rewrite `resolveAuth()` | Core, breaking | Medium — imports change |
| 3. Auth gate | Dashboard, feature | Medium — WebSocket flow change |
| 4. Logout | Dashboard, feature | Low |
| 5. Auto-guardrails | Hooks, additive | Low |
| 6. Cleanup | Core + docs | Low |
| 7. Personality review | Manual | None |
| 8. E2E verification | Manual | None |

**Dependencies:** Task 1 → 2 → 3 → 4 (sequential). Task 5 depends on 1. Task 6 depends on 2-4. Tasks 7-8 are independent.
