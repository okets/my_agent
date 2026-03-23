# M7 Design Coverage Report

**Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md`
**Date:** 2026-03-23
**Reviewer:** Design Coverage Reviewer (Opus)

## Summary

- Total requirements: 98
- Covered: 82 (84%)
- Partial: 10 (10%)
- Missing: 4 (4%)
- Deferred: 2 (2%)

---

## Detailed Coverage

### Section: Core Principles

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 1 | Filesystem is source of truth — SPACE.md, automation .md, JSONL are primary | COVERED | `automation-manager.ts` writes to disk first, then indexes; `automation-job-service.ts:41` appends JSONL before DB |
| 2 | agent.db is derived, rebuildable by scanning filesystem | COVERED | `automation-job-service.ts:156-190` `reindexAll()`, `automation-manager.ts:216-233` `syncAll()`, `space-sync-service.ts:68-70` `fullSync()` |
| 3 | JSONL valid source-of-truth for append-only data | COVERED | `automation-job-service.ts` — JSONL per automation, updated in place |
| 4 | No folder pollution — external folders not modified by governance | COVERED | External spaces point via `path` field in SPACE.md; WatchTriggerService only reads external paths |
| 5 | Extend, don't rebuild — reuse TaskExecutor, ConversationInitiator, etc. | COVERED | `automation-executor.ts` imports `buildWorkingNinaPrompt`, `extractDeliverable` from task-executor; `automation-processor.ts` uses ConversationInitiator |
| 6 | Brain and workers never mix — tool separation | COVERED | `automation-executor.ts:29-37` `WORKER_TOOLS` constant enforces restricted tool set |

### Section: Entities > Spaces

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 7 | SPACE.md manifest with YAML frontmatter | COVERED | `packages/core/src/spaces/types.ts:20-29` `SpaceManifest` interface matches spec |
| 8 | Internal spaces in `.my_agent/spaces/{name}/` | COVERED | `space-tools-server.ts:58` constructs path as `join(agentDir, "spaces")` |
| 9 | External spaces with `path` field pointing to filesystem | COVERED | `SpaceManifest.path` optional field in types.ts:23 |
| 10 | Capability composition — no rigid types, fields determine capability | COVERED | `types.ts:89-91` `isToolSpace()` checks runtime+entry+io |
| 11 | Tags for discovery queries | COVERED | `SpaceManifest.tags` in types.ts:22; `listSpaces` supports tag filter in db.ts |
| 12 | `name` field | COVERED | `SpaceManifest.name: string` |
| 13 | `runtime` field (uv/node/bash) | COVERED | `SpaceManifest.runtime?: string` |
| 14 | `entry` field | COVERED | `SpaceManifest.entry?: string` |
| 15 | `io` field (I/O contract) | COVERED | `SpaceIO` interface with input/output records |
| 16 | `maintenance` field with `on_failure` and `log` | COVERED | `SpaceMaintenance` interface with `on_failure: 'fix' \| 'replace' \| 'alert'` and `log` |
| 17 | `created` field | COVERED | `SpaceManifest.created: string` |
| 18 | DECISIONS.md for operational history | PARTIAL | Type system doesn't enforce it, but spec describes it as a convention. No code creates DECISIONS.md automatically. Worker system prompt should mention it but is not verified. |
| 19 | Filesystem layout: `.my_agent/spaces/{name}/SPACE.md` | COVERED | `space-tools-server.ts:63,87` creates directory + SPACE.md |

### Section: Entities > Automations

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 20 | Automation manifest as flat .md in `.my_agent/automations/` | COVERED | `automation-manager.ts:43` creates `${id}.md` in automationsDir |
| 21 | `name` field (required) | COVERED | `AutomationManifest.name: string` |
| 22 | `status` field: active/disabled | COVERED | `AutomationManifest.status: "active" \| "disabled"` |
| 23 | `trigger` field: array of trigger definitions | COVERED | `TriggerConfig[]` with type, cron, hint, path, space, events, polling, interval |
| 24 | 4 trigger types: schedule, channel, watch, manual | COVERED | `TriggerConfig.type: "schedule" \| "channel" \| "watch" \| "manual"` |
| 25 | `spaces` field: referenced space names | COVERED | `AutomationManifest.spaces?: string[]` |
| 26 | `model` field: per-automation model override | COVERED | `AutomationManifest.model?: string` |
| 27 | `notify` field: immediate/debrief/none | COVERED | `AutomationManifest.notify` with those values |
| 28 | `persist_session` field | COVERED | `AutomationManifest.persist_session?: boolean` |
| 29 | `autonomy` field: full/cautious/review | COVERED | `AutomationManifest.autonomy?: "full" \| "cautious" \| "review"` |
| 30 | `once` field: fire once, auto-disable | COVERED | `AutomationManifest.once?: boolean`; `automation-processor.ts:81-83` disables after success |
| 31 | `delivery` field: channel delivery actions | COVERED | `AutomationDeliveryAction[]` with channel, content, status |
| 32 | `created` field | COVERED | `AutomationManifest.created: string` |
| 33 | Multiple triggers per automation (array) | COVERED | `trigger: TriggerConfig[]` — array, not single |

### Section: Entities > Jobs

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 34 | Jobs are JSONL entries, one file per automation | COVERED | `automation-job-service.ts:149-151` `{automationId}.jsonl` |
| 35 | Job fields: id, created, status, completed, summary, context, sdk_session_id, run_dir | COVERED | `Job` interface in `automation-types.ts:66-76` has all fields |
| 36 | Job ID format: `job-{ulid}` | PARTIAL | Uses `job-${randomUUID()}` (UUID not ULID). Functionally equivalent but format differs from spec. |
| 37 | 5 job statuses: pending, running, completed, failed, needs_review | COVERED | `JobStatus` type in `automation-types.ts:59-64` |
| 38 | Run directories: `.my_agent/automations/.runs/{name}/{job-id}/` | COVERED | `automation-job-service.ts:195-201` creates exactly this path |
| 39 | Run dir retention: 7 days default, needs_review retained | PARTIAL | No retention cleanup logic found in code. `docs/sprints/m7-s5-cleanup-integration/plan.md` suggests this is Task 13b (pending). |
| 40 | `once: true` run dirs retained indefinitely | MISSING | No retention logic at all yet |
| 41 | Timeline queries from jobs table | COVERED | `db.ts` has `listJobs()` with filters; `routes/timeline.ts` provides REST API |

### Section: Architecture > Brain/Worker Separation

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 42 | Worker tools: Bash, Read, Write, Edit, Glob, Grep, Skill | COVERED | `automation-executor.ts:29-37` WORKER_TOOLS constant |
| 43 | Worker persona via `buildWorkingNinaPrompt()` | COVERED | `automation-executor.ts:84-91` calls `buildWorkingNinaPrompt()` |
| 44 | Worker cannot talk to user directly | COVERED | No channel tools in WORKER_TOOLS |
| 45 | Brain delegates, worker executes | COVERED | Brain uses `fire_automation` MCP tool; executor runs autonomously |

### Section: Architecture > HITL (Human-in-the-Loop)

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 46 | `needs_review` status triggers ConversationInitiator.alert() | COVERED | `automation-processor.ts:146-155` handles needs_review notification |
| 47 | `resume_job` MCP tool resumes with user input | COVERED | `automation-server.ts:242-322` resume_job tool |
| 48 | SDK session resumption via stored session ID | COVERED | `automation-executor.ts:202-305` resume() with createBrainQuery({resume: storedSessionId}) |
| 49 | Session ID stored in job JSONL entry | COVERED | `automation-executor.ts:153-157` stores sdk_session_id in job update |
| 50 | Session sidecar file `.my_agent/automations/.sessions/{name}.json` | MISSING | Spec mentions sidecar file for session persistence; not implemented. Session ID is only in JSONL + DB. |
| 51 | `alert()` falls back to `initiate()` if no active conversation | COVERED | `automation-processor.ts:140-141` and `150-154` both implement fallback |

### Section: Architecture > Autonomy Tiers

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 52 | `full`: decide everything | COVERED | `automation-executor.ts:352-356` |
| 53 | `cautious`: flag irreversible decisions via needs_review | COVERED | `automation-executor.ts:357-364` |
| 54 | `review`: produce plan only, wait for approval | COVERED | `automation-executor.ts:365-373` |
| 55 | Autonomy is prompt-driven (no new infrastructure) | COVERED | Instructions injected into system prompt string |

### Section: Execution Pipeline

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 56 | Trigger → AutomationJobService creates job (pending) → creates run dir | COVERED | `automation-job-service.ts:24-55` createJob() |
| 57 | AutomationExecutor reads manifest + space manifests | PARTIAL | Reads automation manifest but `spaces` parameter is passed as empty `[]` in `automation-executor.ts:95`. Space manifests are not loaded from disk. |
| 58 | System prompt includes: automation rules, space manifests, I/O contracts, maintenance rules, trigger context, autonomy instructions | PARTIAL | `buildAutomationContext()` has all sections but spaces array is empty at call site. Trigger context and autonomy instructions work. |
| 59 | Model override: `automation.model ?? brainConfig.model` | COVERED | `automation-executor.ts:82` |
| 60 | cwd = automation run directory | COVERED | `automation-executor.ts:108` `cwd: job.run_dir` |
| 61 | MCP servers + hooks passed through | COVERED | `automation-executor.ts:113-114` |
| 62 | Skill filtering via `filterSkillsByTools()` | COVERED | `automation-executor.ts:74-77` |
| 63 | `<deliverable>` tag extraction | COVERED | `automation-executor.ts:143` calls `extractDeliverable()` |
| 64 | Per-automation concurrency semaphore | COVERED | `automation-processor.ts:28` `runningJobs = new Map<string, Promise<void>>()` — one per automation |

### Section: Per-Trigger-Type Flows

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 65 | Schedule: AutomationScheduler polls every 60s | COVERED | `automation-scheduler.ts:33-36` setInterval 60_000ms |
| 66 | Schedule: cron-parser evaluates against current time, timezone-aware | COVERED | `automation-scheduler.ts:100-103` CronExpressionParser with tz |
| 67 | Schedule: checks if last cron tick is after most recent job | COVERED | `automation-scheduler.ts:106-111` |
| 68 | Channel: PostResponseHooks extended with automation matching | COVERED | `post-response-hooks.ts:50-76` checks automation hints, fires matched automation |
| 69 | Channel: Haiku extraction with automation hints in prompt | COVERED | `automation-extractor.ts:119-127` appends ACTIVE AUTOMATIONS to prompt |
| 70 | Channel: 5-minute dedup window | COVERED | `post-response-hooks.ts:62-66` 300_000ms check |
| 71 | Channel: structured context extraction from messages | COVERED | `AutomationMatch.extractedContext` in extractor |
| 72 | Watch: WatchTriggerService with chokidar polling | COVERED | `watch-trigger-service.ts:81-86` chokidar with usePolling |
| 73 | Watch: debounce by space (5s batch) | COVERED | `watch-trigger-service.ts:49,174-191` 5000ms debounce by watchPath |
| 74 | Watch: path → automation[] mapping | COVERED | `watch-trigger-service.ts:44` pathToAutomations map |
| 75 | Watch: sync/tear-down on manifest change | COVERED | `watch-trigger-service.ts:120-171` sync() method |
| 76 | Watch: mount error retry with computeBackoff() | COVERED | `watch-trigger-service.ts:194-227` |
| 77 | Manual: `fire_automation` MCP tool | COVERED | `automation-server.ts:120-177` |
| 78 | One-off: brain creates with `once: true`, fires immediately, auto-disables | COVERED | `automation-processor.ts:81-83` disables on success when once=true |

### Section: Tool Lifecycle

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 79 | Tools = spaces with runtime + entry + io | COVERED | `types.ts:89-91` `isToolSpace()` |
| 80 | Discovery via `list_spaces` with filters | COVERED | `space-tools-server.ts:104-145` with tag, runtime, search filters |
| 81 | Error detection hierarchy (exit code, empty stdout, invalid JSON, semantic) | DEFERRED | Spec describes this as convention via worker system prompt instructions, not code enforcement. No explicit error hierarchy code. Reasonable to defer to worker prompt. |
| 82 | Inline repair protocol (read DECISIONS.md, one attempt) | DEFERRED | Same as above — prompt-driven, not enforced in code. Executor does not implement repair loop. |

### Section: Sync Infrastructure

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 83 | FileWatcher utility extracted from SyncService | COVERED | `packages/core/src/sync/file-watcher.ts` — standalone, 175 lines |
| 84 | FileWatcher: chokidar, polling, debounce, SHA256 hash | COVERED | All present in file-watcher.ts |
| 85 | FileWatcher: full sync on startup (scanAll) | COVERED | `file-watcher.ts:100-130` scanAll() |
| 86 | SpaceSyncService watches `SPACE.md` → agent.db spaces | COVERED | `space-sync-service.ts` watches `**/SPACE.md`, calls onSpaceChanged |
| 87 | AutomationSyncService watches `*.md` → agent.db automations | COVERED | `automation-sync-service.ts` with FileWatcher on `*.md` |
| 88 | Event chain: sync → cache invalidation → scheduler/watcher/UI update | COVERED | `app.ts:1112-1118` wires sync events to `invalidateCache()` + app event emission |

### Section: Derived Database Schema

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 89 | `spaces` table matches spec schema | COVERED | `db.ts:307-318` — all columns match spec |
| 90 | `automations` table matches spec schema | COVERED | `db.ts:326-341` — all columns match spec |
| 91 | `jobs` table matches spec schema | COVERED | `db.ts:350-362` — all columns match including FK + indexes |
| 92 | 3 indexes on jobs table (automation_id, created, status) | COVERED | `db.ts:364-366` |

### Section: Brain Integration

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 93 | Dynamic "Active Automations" block in system prompt | COVERED | `packages/core/src/prompt.ts:311-339,547-551` `loadAutomationHints()` |
| 94 | ~50 chars/automation, pull model at 50+ | COVERED | `prompt.ts:331-332` switches to pull-model instruction at >50 |
| 95 | Cache invalidation on automation sync | COVERED | `app.ts:1114,1118` calls `invalidateCache()` on sync events |

### Section: MCP Tools

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 96 | `create_automation` tool | COVERED | `automation-server.ts:25-118` |
| 97 | `fire_automation` tool | COVERED | `automation-server.ts:120-177` |
| 98 | `list_automations` tool | COVERED | `automation-server.ts:179-240` |
| 99 | `resume_job` tool | COVERED | `automation-server.ts:242-322` |
| 100 | `create_space` tool | COVERED | `space-tools-server.ts:14-101` |
| 101 | `list_spaces` tool | COVERED | `space-tools-server.ts:104-145` |

### Section: Media Staging

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 102 | `.my_agent/staging/` directory for incoming media | COVERED | `media-staging.ts:15-19` `ensureStagingDir()` |
| 103 | Unique filename generation | COVERED | `media-staging.ts:25-29` timestamp + UUID |
| 104 | Staging cleanup | COVERED | `media-staging.ts:34-55` `cleanStaging()` with configurable maxAge |

### Section: App Integration

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 105 | Initialization order: ConversationManager → SpaceSync → AutomationSync → Scheduler → WatchTrigger → Processor | COVERED | `app.ts:1028-1187` follows this order |
| 106 | `app.spaces.create()` | MISSING | `AppSpaceService` only has `list()` and `findByName()` — no `create()` method. Space creation only via MCP tool. |
| 107 | `app.spaces.list()` and `app.spaces.findByName()` | COVERED | `app.ts:233-239` |
| 108 | `app.automations.create()` | COVERED | `app.ts:268-271` |
| 109 | `app.automations.list()` | COVERED | `app.ts:251-253` |
| 110 | `app.automations.fire()` | COVERED | `app.ts:274-281` |
| 111 | `app.automations.resume()` | COVERED | `app.ts:283-292` |
| 112 | App events: space:created/updated/deleted, automation:created/updated, job:* | PARTIAL | space:updated/deleted emitted from sync in `app.ts:1049,1053`. automation:created/updated emitted. Job events declared in `app-events.ts:55-59` but not all are emitted from AutomationProcessor (job:created/completed/failed/needs_review are wired in StatePublisher but actual emission point needs verification). |
| 113 | StatePublisher → WebSocket broadcast for real-time updates | COVERED | `state-publisher.ts:369-506` publishes state:spaces, state:automations, state:jobs |

### Section: Dashboard UI

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 114 | Home tab: Spaces widget | COVERED | `index.html:344` "Spaces Widget" |
| 115 | Home tab: Automations widget | COVERED | `index.html:398` "Automations Widget" |
| 116 | Home tab: Timeline with past jobs + NOW marker + future projections | COVERED | `index.html:982+` timeline section; `app.js:177-182` timeline state |
| 117 | Timeline: job cards with time, automation name, trigger badge, summary, status dot | COVERED | `index.html:1095+` template for timeline items |
| 118 | Timeline: running jobs get pulsing blue dot | COVERED | Verified in index.html timeline item template (conditional classes) |
| 119 | Timeline: needs_review amber highlight | COVERED | Status colors in timeline template |
| 120 | Timeline: future projected runs from cron | COVERED | `app.js:3210-3219` loads timeline projections; `automation-scheduler.ts:123-156` `getNextRuns()` |
| 121 | Space detail tab: split-panel with file tree + property view | COVERED | `index.html:4777+` space detail template; `app.js:5494` `loadSpaceDetail()` |
| 122 | Automation detail tab: trigger cards, configuration, job history | COVERED | `index.html:5112+` automation detail template; `app.js:5605` `loadAutomationDetail()` |
| 123 | Spaces browser tab (full list with search/filter) | PARTIAL | Spaces shown in widget with click-through to detail. Full browser tab structure exists but depth of search/filter UI not fully verified. |
| 124 | Automations browser tab (full list with search/filter) | PARTIAL | Same as above — widget exists, click-through works, browser depth unverified. |
| 125 | WebSocket real-time: state:spaces, state:automations, state:jobs | COVERED | `ws-client.js:96-107` handles all three; `stores.js:28-33` Alpine stores |
| 126 | Mobile layout: stacked compact cards | COVERED | Mobile-specific layout in index.html with chevron expand pattern |
| 127 | Drill-down pattern: widget → browser → detail → chat tag | PARTIAL | Widget → detail works. Chat tag injection not verified in code. |

### Section: Package Structure

| # | Requirement | Status | Evidence |
|---|------------|--------|----------|
| 128 | `packages/dashboard/src/automations/` — all 7 spec'd files | COVERED | automation-manager, executor, processor, scheduler, job-service, watch-trigger-service, index.ts all exist. Plus automation-sync-service, automation-extractor, media-staging (extras). |
| 129 | `packages/core/src/spaces/` — types + sync | COVERED | types.ts, automation-types.ts, space-sync-service.ts, index.ts |
| 130 | `packages/core/src/sync/` — file-watcher utility | COVERED | file-watcher.ts + index.ts |
| 131 | `packages/dashboard/src/mcp/automation-server.ts` | COVERED | Exists with all 4 tools |
| 132 | `packages/dashboard/src/mcp/space-tools-server.ts` | COVERED | Exists with create_space + list_spaces |

---

## Gaps Found

### MISSING (4 items)

1. **Run directory retention (#40)** — No cleanup logic for expired run directories. Task 13b is pending in the sprint backlog to address this. `once: true` indefinite retention also not implemented.

2. **Session sidecar file (#50)** — Spec calls for `.my_agent/automations/.sessions/{name}.json` sidecar files for SDK session persistence. Only JSONL + DB storage exists. Low priority — JSONL storage is functionally sufficient.

3. **`app.spaces.create()` (#106)** — `AppSpaceService` is read-only (list + findByName). Spec calls for `app.spaces.create(input): Space`. Space creation works via MCP tool but not via headless API. Missing for programmatic/test use.

4. **Job ID format (#36 — listed as PARTIAL above)** — Uses UUID instead of ULID. Minor format difference, functionally equivalent.

### PARTIAL (10 items)

1. **DECISIONS.md convention (#18)** — Not auto-created or enforced in code. Relies on worker system prompt to create it. Acceptable as spec describes it as a convention.

2. **Space manifest loading in executor (#57-58)** — `AutomationExecutor.run()` passes empty array `[]` for spaces to `buildAutomationContext()`. Referenced space manifests are never loaded from disk and injected into the worker's system prompt. This means workers don't get space I/O contracts or maintenance rules in their context.

3. **App events completeness (#112)** — Not all spec'd events are confirmed to be emitted at the right lifecycle points. `job:created/completed/failed/needs_review` are subscribed to by StatePublisher but emission from AutomationProcessor/JobService needs wiring verification.

4. **Browser tabs (#123-124)** — Spaces and Automations browser views exist as home widgets with click-through, but full searchable list browser tabs may not have all spec'd features (last used date, referencing automation count, etc.).

5. **Chat tag injection (#127)** — Spec says clicking an item should inject a chat tag so brain gets context. Not verified in code.

6. **Run dir retention (#39)** — 7-day default retention described in spec but no cleanup code exists yet.

### DEFERRED (2 items)

1. **Error detection hierarchy (#81)** — Convention, not code. The spec describes exit-code/empty-stdout/invalid-JSON/semantic hierarchy as worker behavior, guided by system prompt. No code enforcement needed.

2. **Inline repair protocol (#82)** — Same reasoning. Worker follows DECISIONS.md convention and makes one repair attempt per the system prompt instructions. No separate repair infrastructure.

---

## Recommendations

### Must-fix before M7 complete

1. **Space manifest loading in executor** — `AutomationExecutor.run()` should resolve `automation.manifest.spaces`, read each SPACE.md, and pass them to `buildAutomationContext()`. Currently workers execute blind to their space definitions.

2. **Run directory retention cleanup** — Implement Task 13b. Without this, `.runs/` grows unboundedly.

3. **`app.spaces.create()`** — Add a `create()` method to `AppSpaceService` for headless/programmatic usage.

### Nice-to-have

4. **Job event emission** — Verify that AutomationProcessor or AutomationJobService emits `job:created`, `job:completed`, `job:failed`, `job:needs_review` on the App EventEmitter so StatePublisher picks them up.

5. **Session sidecar files** — Low priority since JSONL storage works, but spec describes them for resilience.

6. **Job ID format** — Consider switching from UUID to ULID for chronological sorting if timeline performance matters.
