# S21 Decisions

## D1 — Gate resolves with surrender text verbatim (BUG-2)

**Decision:** When CFR surrenders while a brain turn is waiting behind the STT gate, resolve the gate with the surrender copy text (the user-facing apology). This means the brain processes the turn with the surrender message as the "user input."

**Alternatives considered:**
- Resolve with placeholder `[Voice message — transcription unavailable]` — simpler but loses the surrender context; brain answers as if the message was empty
- Inject a system message post-surrender — requires the brain turn to have already processed, creating a race with the surrender ack

**Why:** The surrender text is what we want the brain to contextualise. By resolving the gate with it, the brain sees it as the effective user input and can echo it to the user naturally. The result is identical to `sendSystemMessage` but avoids a second brain turn.

## D2 — Don't resolve gate on `terminal-fixed` (BUG-2)

**Decision:** The `terminal-fixed` ack path does NOT resolve the STT pending gate. Only surrender kinds do.

**Why:** `terminal-fixed` is emitted for non-STT recovery (e.g. TTS). STT recovery calls `reprocessTurn` directly. If a gate exists for a `terminal-fixed` capability type it means the capability isn't audio-to-text and the gate shouldn't have been set; resolving it would inject wrong text.

## D3 — `CLAUDECODE` guard for automation-spawning tests

**Decision:** All integration/E2E tests that spawn real Claude Code automations now skip when `process.env.CLAUDECODE` is set.

**Why:** BUG-5's `.env` auto-load fix (ensureDashboardEnvLoaded) unblocked auth, causing tests that previously skipped silently to run and fail because the AutomationExecutor can't fork a nested Claude Code process inside a Claude Code session. The guard preserves the intent: these tests are designed to run with `env -u CLAUDECODE node --env-file=... vitest`.

Affected: `cfr-stt-reprocess-chain.test.ts`, `cfr-exit-gate-conversation.test.ts`, `cfr-exit-gate-automation.test.ts`, `cfr-abbreviated-replays.test.ts`.

## D4 — skills sync targets `.claude/skills/`, not `brain/skills/`

**Decision:** `syncFrameworkSkillsSync` syncs to `<agentDir>/.claude/skills/` (default). The sprint spec said `brain/skills/` but that path is wrong — Claude Code SDK reads skills from `.claude/skills/`.

**Why:** Confirmed via `skill-expander.ts:13`, `debug-queries.ts:214`, `skills-health.ts:9`. The `brain/` directory holds identity and memory, not SDK skills. Using the wrong path would mean the sync runs but skills are never loaded.
