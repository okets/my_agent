# M9.6-S11 Template Smoke Fixtures — Dev Sub-Task Tracker

> **NOT THE ARCHITECT PLAN** — this is the dev's sub-task breakdown. The architect plan is `plan-phase2-coverage.md §2.3`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `scripts/smoke.sh` contract + `fallback_action` frontmatter to all 5 capability templates, implement `runSmokeFixture` in `reverify.ts`, and ship unit tests.

**Architecture:** Pure template authoring (markdown edits) + one new exported function in `reverify.ts`. No CFR/orchestrator changes — wiring `runSmokeFixture` into the dispatcher is S14. Templates gain a "Smoke Fixture" section with contract spec and reference `smoke.sh` implementation. Script-plug templates (audio-to-text, text-to-audio, text-to-image) get full working smoke scripts; MCP-plug templates (browser-control, desktop-control) get the contract spec + a minimal stub (full MCP tool-invocation version ships in S14 per plan-universal-coverage.md §4.4).

**Tech Stack:** Node.js/TypeScript, Vitest, bash

---

## File Map

| Action | Path |
|---|---|
| Modify | `skills/capability-templates/audio-to-text.md` |
| Modify | `skills/capability-templates/text-to-audio.md` |
| Modify | `skills/capability-templates/text-to-image.md` |
| Modify | `skills/capability-templates/browser-control.md` |
| Modify | `skills/capability-templates/desktop-control.md` |
| Modify | `packages/core/src/capabilities/reverify.ts` |
| Create | `packages/core/tests/capabilities/run-smoke-fixture.test.ts` |
| Modify | `docs/ROADMAP.md` |

---

## Task 1: Script-plug template updates (audio-to-text, text-to-audio, text-to-image)

Add `fallback_action` frontmatter field and a "Smoke Fixture" section to the three script-interface templates.

**Files:**
- Modify: `skills/capability-templates/audio-to-text.md`
- Modify: `skills/capability-templates/text-to-audio.md`
- Modify: `skills/capability-templates/text-to-image.md`

- [ ] **Step 1: Update `audio-to-text.md` frontmatter**

Change the YAML frontmatter from:
```yaml
---
template_version: 1
type: audio-to-text
provides: audio-to-text
---
```
to:
```yaml
---
template_version: 2
type: audio-to-text
provides: audio-to-text
fallback_action: "could you resend as text"
---
```

- [ ] **Step 2: Add Smoke Fixture section to `audio-to-text.md`**

Append this section after the "Known Providers" table (at the end of the file):

```markdown
## Smoke Fixture

Every audio-to-text capability MUST ship `scripts/smoke.sh`. The reverify dispatcher
calls this as a fresh out-of-session subprocess (exit 0 = healthy, non-zero = broken).

**Contract:**
- Generates a deterministic audio fixture locally (no stored binary needed)
- Calls `transcribe.sh` against the fixture
- Validates the JSON output has a non-null `text` field
- Cleans up temp files on exit
- Network calls to the provider are unavoidable — document the fallback if offline behavior is needed

**Reference implementation** (copy to `scripts/smoke.sh`, make executable):

~~~bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

FIXTURE="/tmp/smoke-stt-$$.wav"
trap 'rm -f "$FIXTURE"' EXIT

# Generate a 2-second test tone (requires ffmpeg — already a transcribe.sh dependency)
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 "$FIXTURE" 2>/dev/null

# Call the script; validate JSON has a 'text' field
OUTPUT="$("$DIR/transcribe.sh" "$FIXTURE")"
echo "$OUTPUT" | jq -e '.text != null' > /dev/null
~~~

A sine wave won't produce meaningful transcription, but the script should return valid JSON
with a `text` field (even if empty). If your provider returns empty text for silence, the smoke
script still exits 0 — smoke checks capability health, not transcription quality.
```

- [ ] **Step 3: Update `text-to-audio.md` frontmatter**

Change YAML frontmatter from:
```yaml
---
template_version: 1
type: text-to-audio
provides: text-to-audio
---
```
to:
```yaml
---
template_version: 2
type: text-to-audio
provides: text-to-audio
fallback_action: "you can read my last reply above"
---
```

- [ ] **Step 4: Add Smoke Fixture section to `text-to-audio.md`**

Append after the "Known Providers" table:

```markdown
## Smoke Fixture

Every text-to-audio capability MUST ship `scripts/smoke.sh`. The reverify dispatcher
calls this as a fresh out-of-session subprocess (exit 0 = healthy, non-zero = broken).

**Contract:**
- Calls `synthesize.sh` with a deterministic phrase
- Validates the JSON output has a `path` field
- Validates the output file exists and exceeds 100 bytes
- Cleans up temp files on exit

**Reference implementation** (copy to `scripts/smoke.sh`, make executable):

~~~bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

OUT="/tmp/smoke-tts-$$.ogg"
trap 'rm -f "$OUT"' EXIT

OUTPUT="$("$DIR/synthesize.sh" "smoke test" "$OUT")"
echo "$OUTPUT" | jq -e '.path != null' > /dev/null

[ -f "$OUT" ] && [ "$(wc -c < "$OUT")" -gt 100 ]
~~~
```

- [ ] **Step 5: Update `text-to-image.md` frontmatter**

Change YAML frontmatter from:
```yaml
---
template_version: 1
type: text-to-image
provides: text-to-image
---
```
to:
```yaml
---
template_version: 2
type: text-to-image
provides: text-to-image
fallback_action: "try again in a moment"
---
```

- [ ] **Step 6: Add Smoke Fixture section to `text-to-image.md`**

Append after the "Known Providers" table:

```markdown
## Smoke Fixture

Every text-to-image capability MUST ship `scripts/smoke.sh`. The reverify dispatcher
calls this as a fresh out-of-session subprocess (exit 0 = healthy, non-zero = broken).

**Contract:**
- Calls `generate.sh` with a deterministic prompt
- Validates the JSON output has a `path` field
- Validates the output file exists and exceeds 1000 bytes
- Cleans up temp files on exit

**Reference implementation** (copy to `scripts/smoke.sh`, make executable):

~~~bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

OUT="/tmp/smoke-image-$$.png"
trap 'rm -f "$OUT"' EXIT

OUTPUT="$("$DIR/generate.sh" "a solid red square" "$OUT")"
echo "$OUTPUT" | jq -e '.path != null' > /dev/null

[ -f "$OUT" ] && [ "$(wc -c < "$OUT")" -gt 1000 ]
~~~
```

- [ ] **Step 7: Commit**

```bash
git add skills/capability-templates/audio-to-text.md \
        skills/capability-templates/text-to-audio.md \
        skills/capability-templates/text-to-image.md
git commit -m "feat(m9.6-s11): add fallback_action + smoke fixture to script-plug templates"
```

---

## Task 2: MCP template updates (browser-control, desktop-control)

Add `fallback_action` frontmatter and a "Smoke Fixture" section to the two MCP-interface templates. The full MCP tool-invocation reference implementation lands in S14; S11 ships the contract + a minimal stub that confirms environment health and server startup.

**Files:**
- Modify: `skills/capability-templates/browser-control.md`
- Modify: `skills/capability-templates/desktop-control.md`

- [ ] **Step 1: Update `browser-control.md` frontmatter**

Change YAML frontmatter from:
```yaml
---
template_version: 1
type: browser-control
provides: browser-control
interface: mcp
multi_instance: true
---
```
to:
```yaml
---
template_version: 2
type: browser-control
provides: browser-control
interface: mcp
multi_instance: true
fallback_action: "try again in a moment"
---
```

- [ ] **Step 2: Add Smoke Fixture section to `browser-control.md`**

Append after the "Known Browsers" table (at the end of the file):

```markdown
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
timeout 10s npx tsx src/server.ts &>/dev/null &
SERVER_PID=$!
sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "MCP server exited immediately — check entrypoint or config.yaml" >&2
  exit 1
fi
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
~~~
```

- [ ] **Step 3: Update `desktop-control.md` frontmatter**

Change YAML frontmatter from:
```yaml
---
template_version: 1
type: desktop-control
provides: desktop-control
interface: mcp
---
```
to:
```yaml
---
template_version: 2
type: desktop-control
provides: desktop-control
interface: mcp
fallback_action: "try again in a moment"
---
```

- [ ] **Step 4: Add Smoke Fixture section to `desktop-control.md`**

Append after the "Known Platforms" table (at the end of the file):

```markdown
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
```

- [ ] **Step 5: Commit**

```bash
git add skills/capability-templates/browser-control.md \
        skills/capability-templates/desktop-control.md
git commit -m "feat(m9.6-s11): add fallback_action + smoke fixture contract to MCP templates"
```

---

## Task 3: Add `runSmokeFixture` to `reverify.ts`

Export a new `runSmokeFixture` function. S14 will wire this into the reverify dispatcher; S11 just ships the function so tests can cover it.

**Files:**
- Modify: `packages/core/src/capabilities/reverify.ts`

- [ ] **Step 1: Add import for `join` (already imported) and `performance` (check)**

Open `packages/core/src/capabilities/reverify.ts`. The file already imports `existsSync` from `node:fs` and `join` from `node:path`. Add `execFile` to the existing `node:child_process` dynamic import pattern — but for `runSmokeFixture` we need it at the top level. Add a top-level import block:

The current top-level imports are:
```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityFailure } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityWatcher } from "./watcher.js";
import type { CapabilityInvoker } from "./invoker.js";
```

Replace with:
```typescript
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CapabilityFailure } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityWatcher } from "./watcher.js";
import type { CapabilityInvoker } from "./invoker.js";

const execFileAsync = promisify(execFile);
```

Note: the existing fallback path in `reverifyAudioToText` dynamically imports `execFile` and `promisify` — leave that as-is (it's the S13-deferred legacy path). The new top-level imports are for `runSmokeFixture` only.

- [ ] **Step 2: Add `SMOKE_TIMEOUT_MS` constant and `runSmokeFixture` function**

Add before the final `sleep` helper at the bottom of the file:

```typescript
/** Maximum time to wait for smoke.sh to complete */
const SMOKE_TIMEOUT_MS = 30_000;

/**
 * Default reverifier for capability types without a per-type reverifier.
 *
 * Runs `<capDir>/scripts/smoke.sh` as a fresh out-of-session subprocess.
 * Exit 0 = pass. Missing smoke.sh = falls back to availability check with
 * a warning (this is a template-gap signal, not a normal path).
 *
 * Wired into the reverify dispatcher in S14. Exported here for unit testing.
 */
export async function runSmokeFixture(
  capDir: string,
  registry: CapabilityRegistry,
  capabilityType: string,
): Promise<ReverifyResult> {
  const smokeScript = join(capDir, "scripts", "smoke.sh");

  if (!existsSync(smokeScript)) {
    // Template gap — smoke.sh missing. Fall back to availability check.
    const cap = registry.get(capabilityType);
    if (cap?.status === "available") {
      console.warn(
        `[runSmokeFixture] no smoke.sh in ${capDir} — template gap; falling back to availability check`,
      );
      return { pass: true };
    }
    return {
      pass: false,
      failureMode: `no smoke.sh found and capability ${capabilityType} not available`,
    };
  }

  try {
    await execFileAsync(smokeScript, [], {
      timeout: SMOKE_TIMEOUT_MS,
      cwd: capDir,
      env: { ...process.env },
    });
    return { pass: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `smoke.sh failed: ${message}` };
  }
}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd /home/nina/my_agent/packages/core && npx tsc --noEmit
```

Expected: no errors. If there are errors, fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/capabilities/reverify.ts
git commit -m "feat(m9.6-s11): add runSmokeFixture to reverify.ts"
```

---

## Task 4: Unit tests for `runSmokeFixture`

Four cases: smoke.sh exits 0, exits 1, missing+available, missing+unavailable.

**Files:**
- Create: `packages/core/tests/capabilities/run-smoke-fixture.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
/**
 * S11 unit tests — runSmokeFixture in reverify.ts.
 *
 * Four cases:
 *   1. smoke.sh present, exits 0  → pass: true
 *   2. smoke.sh present, exits 1  → pass: false
 *   3. smoke.sh absent, cap available → pass: true + warning logged
 *   4. smoke.sh absent, cap unavailable → pass: false
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { runSmokeFixture } from "../../src/capabilities/reverify.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

/** Build a minimal CapabilityRegistry stub with one entry */
function makeRegistry(status: "available" | "unavailable" | "invalid"): CapabilityRegistry {
  return {
    get: (type: string) =>
      type === "test-type"
        ? { status, name: "test-cap", provides: type, path: "/fake", interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

/** Create a temp capability dir with scripts/smoke.sh set to given exit code */
function makeCapDir(exitCode: number): string {
  const capDir = join(tmpdir(), `smoke-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  const script = join(capDir, "scripts", "smoke.sh");
  writeFileSync(script, `#!/usr/bin/env bash\nexit ${exitCode}\n`);
  chmodSync(script, 0o755);
  return capDir;
}

/** Create a temp capability dir with NO smoke.sh */
function makeCapDirNoSmoke(): string {
  const capDir = join(tmpdir(), `smoke-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  return capDir;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSmokeFixture", () => {
  it("returns pass:true when smoke.sh exits 0", async () => {
    const capDir = makeCapDir(0);
    const registry = makeRegistry("available");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(true);
  });

  it("returns pass:false when smoke.sh exits 1", async () => {
    const capDir = makeCapDir(1);
    const registry = makeRegistry("available");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/smoke\.sh failed/);
  });

  it("falls back to availability check when smoke.sh is absent and cap is available", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capDir = makeCapDirNoSmoke();
    const registry = makeRegistry("available");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("template gap"));
  });

  it("returns pass:false when smoke.sh is absent and cap is not available", async () => {
    const capDir = makeCapDirNoSmoke();
    const registry = makeRegistry("unavailable");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/not available/);
  });
});
```

- [ ] **Step 2: Run the tests — verify they pass**

```bash
cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/run-smoke-fixture.test.ts
```

Expected: 4 passing tests.

- [ ] **Step 3: Run full test suite — check for regressions**

```bash
cd /home/nina/my_agent/packages/core && npm test
```

Expected: same pass/fail counts as before this sprint. Any new failures are regressions — fix before committing.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/capabilities/run-smoke-fixture.test.ts
git commit -m "test(m9.6-s11): unit tests for runSmokeFixture (4 cases)"
```

---

## Task 5: Roadmap update

- [ ] **Step 1: Mark S11 as Done in `docs/ROADMAP.md`**

Find the S11 row in the M9.6 sprint table. It currently reads:
```
| S11 | Template smoke fixtures | Planned | Every capability template...
```

Change `Planned` to `Done`:
```
| S11 | Template smoke fixtures | Done | Every capability template...
```

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(m9.6-s11): mark S11 Done in roadmap"
```
