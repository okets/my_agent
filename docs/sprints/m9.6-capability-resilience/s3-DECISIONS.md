# S3 Decisions

**Sprint:** M9.6-S3 — Capability hot-reload + restart gap closure
**Date:** 2026-04-15

---

## D1: Replace existing `capWatcher` (FileWatcher) with `CapabilityWatcher`

**Decided:** Replace the existing `FileWatcher`-based `capWatcher` local variable in `app.ts` with the new `CapabilityWatcher` instance stored as an App field.

**Why:** The pre-existing `capWatcher` only watched `**/CAPABILITY.md`. The plan requires watching `**/{CAPABILITY.md,.enabled,config.yaml,.mcp.json}`. Additionally, `capWatcher` was a local variable with no shutdown handle — it leaked on `App.shutdown()`. `CapabilityWatcher` is an App field with a proper `stop()` path wired into the shutdown sequence.

**Blast radius:** None. The new watcher provides a superset of the old behaviour. The `handleCapabilityChange` callback logic is preserved inside `CapabilityWatcher.rescanNow()`.

---

## D2: Update `bash-blocker-extended.test.ts` — `systemctl start` assertion

**Decided:** Updated the existing test at lines 79–83 that asserted `systemctl start nina-dashboard.service` is ALLOWED to instead assert it is BLOCKED.

**Why:** S3 adds the pattern `/systemctl\s+(restart|start|reload)\s+nina-/i` to `BLOCKED_BASH_PATTERNS`. The existing test's assertion (`toBeUndefined()`) would fail under this new pattern. Updating it to `toBe('block')` correctly reflects the new intended behaviour — agents must not self-restart the dashboard even with `start`.

**Blast radius:** Test file only. No production code changed. The test description is updated to match.

---

## D3: `CapabilityWatcher` uses static chokidar import (not dynamic)

**Decided:** `watcher.ts` imports chokidar statically (`import { watch, type FSWatcher } from 'chokidar'`) matching `file-watcher.ts`, rather than the dynamic import pattern used in `watch-trigger-service.ts`.

**Why:** Chokidar is an existing dependency. Static import gives TypeScript the FSWatcher type without casting, and is simpler. The dynamic-import pattern in `watch-trigger-service.ts` was used to avoid bundler issues — not relevant here (both files are in the same package).

---

## D4: "Never self-restart" directive is a static framework section, unconditional

**Decided:** `formatNeverSelfRestartDirective()` is injected unconditionally into every brain session prompt, not gated on capabilities being present.

**Why:** The rule applies whenever the brain is running — even with no capabilities installed, an agent could attempt `systemctl restart` for other reasons. Unconditional injection matches the pattern of `formatScreenshotCurationDirective()` (also unconditional). Capabilities may be installed mid-session; gating on presence would make the rule appear/disappear unexpectedly.
