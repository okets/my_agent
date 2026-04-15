# M9.6: Capability Resilience & Recovery — Implementation Plan

**Status:** Approved
**Milestone:** M9.6 — blocker for M10+
**Design spec:** [`../../design/capability-resilience.md`](../../design/capability-resilience.md)
**Red-team:** [`../../design/capability-resilience-redteam.md`](../../design/capability-resilience-redteam.md) (all findings accepted)
**Origin incident:** `.my_agent/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`

---

## 0. For the implementing agent — READ THIS FIRST

You are a Sonnet-based coding agent implementing one sprint of this milestone. Two people matter:

- **The CTO** — the project owner. Final authority. Does not want to adjudicate implementation details during a sprint.
- **The architect** — the reviewer who wrote this plan, available in a separate review session. All sprint-time deviations, clarifications, and "I'd rather do it another way" thoughts route to the architect, not the CTO.

The architect will do a review after S1 and on any filed deviation proposal. The CTO only sees the work at milestone review or if the architect flags something upward.

This plan is authoritative; the design spec is binding context.

### 0.1 The Stop-On-Deviation Rule

**If at any point you cannot implement the sprint exactly as written, STOP. Do not improvise. Do not "do your best." Do not ship a partial implementation and file follow-ups.**

"Cannot implement exactly as written" includes:

- A file referenced by absolute path or line number does not exist, has moved, or the code has changed such that the described edit is ambiguous.
- A function signature you are asked to add conflicts with an existing one.
- An acceptance test cannot be written without a design choice the plan does not make.
- You discover that a prerequisite (a data structure, event, field) that the plan assumes exists does not actually exist.
- You form an opinion that a different approach is better. (Hold the opinion. Do not act on it.)
- A dependency sprint's output is missing (e.g., S4 expects something S1 should have produced; it isn't there).
- An existing test would need to be deleted or rewritten beyond simple imports/snapshots.
- Any edit would touch >150 lines of a single file or >6 files outside the sprint's declared file set.

### 0.2 The Deviation Proposal Protocol

When you hit any of the above, write `docs/sprints/m9.6-capability-resilience/proposals/<sprint>-<slug>.md` containing:

```markdown
# Deviation Proposal — Sprint <N>: <short title>

**Blocker:** <one sentence>

**Original plan says:**
> <quote the exact plan lines>

**What I found:**
<bullet list of evidence — file paths with line numbers, test output, concrete observations>

**Options I considered:**
1. <option> — pros / cons
2. <option> — pros / cons
3. <option> — pros / cons

**My recommendation:** <option N>, because <reasoning in ≤3 sentences>

**Blast radius:** <which other sprints / files / tests are affected>

**Question for the architect:** <the specific yes/no or pick-one question you need answered>
```

Then **stop work on the sprint** and wait. Do not continue to the next task item. Do not open a PR. Do not add a TODO and move on.

If the question is trivially answerable from existing docs or the design spec and you are >95% confident, you may answer it yourself but you still write the proposal and flag it `self-answered: <answer>` at the top. That preserves the paper trail for review.

### 0.3 What "done" means for each sprint

A sprint is done when **all** of:
1. All "Files to create" exist with the documented signatures.
2. All "Files to modify" show the documented edits (no drift, no bonus cleanup).
3. All "Acceptance tests" pass, locally, with the commands shown.
4. Linter + `npx tsc` pass in both `packages/core` and `packages/dashboard`.
5. A `DECISIONS.md` file in this sprint folder is updated with any judgment calls (with rationale).
6. A `DEVIATIONS.md` file lists any proposals filed (link to each).
7. A `FOLLOW-UPS.md` file lists any clearly-out-of-scope bugs noticed (don't fix them; list them).
8. The sprint's `review.md` is written by a separate reviewer agent — not the implementer.
9. **The roadmap-done commit is the LAST commit on the sprint branch, landed AFTER the architect-review commit.** You (the implementer) do NOT author a `docs(roadmap): M9.6-SN done` commit before architect review. Either the architect commits it at approval time, or you commit it only after explicit approval in the review. This is not a style preference — it's because a premature "done" claim on the branch misrepresents state if the architect rejects.

Commits: conventional-commit style, one commit per logical change, never batched. Never `--amend`. Never `--no-verify`.

### 0.4 Ground rules

- **Do not delete unrelated code.** If you find dead code adjacent to your change, list it in `FOLLOW-UPS.md` and move on.
- **Do not "fix while you're there."** Pre-commit hook violations and guardrail issues stop you; fix *those*. Other drive-by refactors do not.
- **Do not run `systemctl restart nina-dashboard.service` yourself.** Ever. Even to test. Sprint 3 blocks this at the hook layer; until then, you restart it by asking the architect (who will ask the CTO if needed).
- **Do not test by sending real WhatsApp messages.** Tests use fixtures; E2E happens in S7 under architect supervision.
- **When in doubt about an API of `@anthropic-ai/claude-agent-sdk`**, invoke the `claude-developer-platform` skill (per `CLAUDE.md`). Don't guess at option shapes.
- **Never edit `.my_agent/` files.** That directory is private. Tests that need fixture capabilities use `packages/core/tests/fixtures/capabilities/`.

---

## 1. Milestone overview

**Goal:** When a capability fails during a user turn, Nina acknowledges within 2s, fixes it (≤3 tries), re-processes the original input, and replies. Silence is the bug.

**Sprint sequence (7 sprints, ordered):**

| Sprint | Name | Depends on | Parallelizable with |
|--------|------|-----------|---------------------|
| S1 | Raw media persistence + CFR detector | — | S2 (different files) |
| S2 | Deps wiring at App boot | — | S1 |
| S3 | Capability hot-reload + restart gap closure | — | S1, S2 |
| S4 | Recovery orchestrator (3-tries, reflection, budgets) | S1, S2, S3 | — |
| S5 | Orphaned-turn watchdog | S1 (RawMediaStore), S4 (surrender markers) | — |
| S6 | User-facing messaging + capability confidence contract | S1, S4 | — |
| S7 | E2E incident replay + exit gate | S1–S6 | — |

**Exit gate (S7):** Replay `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ`'s voice #1 audio against a fresh dashboard where `.enabled` is missing for `stt-deepgram`. Within 30s, the conversation must contain: ack turn → fix run → recovered transcription → assistant reply to the actual content. Zero manual intervention. Zero `systemctl restart`.

**Review cadence:**
- Architect does a focused code review after **S1** (foundation sprint — shared contracts, raw media, detector). If the architect signs off, sprints S2–S6 run in sequence with per-sprint review at the end of each.
- Architect also reviews on any filed deviation proposal, regardless of which sprint.
- The CTO reviews the full milestone at S7 exit, not per-sprint.

---

## 2. Shared data contracts (used across sprints)

Create these first in **Sprint 1** and treat as immutable after. Subsequent sprints import, never modify.

### 2.1 `packages/core/src/capabilities/cfr-types.ts` (new)

```typescript
export type CapabilityFailureSymptom =
  | "not-installed"
  | "not-enabled"
  | "deps-missing"
  | "execution-error"
  | "empty-result"
  | "timeout"
  | "validation-failed";

export interface TriggeringInput {
  channel: {
    transportId: string;        // e.g. "whatsapp"
    channelId: string;
    sender: string;
    replyTo?: string;
    senderName?: string;
    groupId?: string;
  };
  conversationId: string;
  turnNumber: number;
  artifact?: {
    type: "audio" | "image" | "document";
    rawMediaPath: string;       // absolute; written by RawMediaStore in S1
    mimeType: string;
  };
  userUtterance?: string;
}

export interface FixAttempt {
  attempt: 1 | 2 | 3;
  startedAt: string;            // ISO8601
  endedAt: string;              // ISO8601
  hypothesis: string;
  change: string;
  verificationInputPath: string;
  verificationResult: "pass" | "fail";
  failureMode?: string;
  nextHypothesis?: string;
  jobId: string;                // the automation job UUID
  modelUsed: "opus" | "sonnet";
  phase: "execute" | "reflect";
}

export interface CapabilityFailure {
  id: string;                    // uuid; stable across iterations
  capabilityType: string;        // e.g. "audio-to-text"
  capabilityName?: string;       // e.g. "stt-deepgram"
  symptom: CapabilityFailureSymptom;
  detail?: string;               // human-readable tail from the origin error
  triggeringInput: TriggeringInput;
  attemptNumber: 1 | 2 | 3;
  previousAttempts: FixAttempt[];
  detectedAt: string;            // ISO8601
  parentFailureId?: string;      // set if this CFR was spawned by another CFR (nesting cap)
}

export type SurrenderScope = {
  capabilityType: string;
  conversationId: string;
  turnNumber: number;
  expiresAt: string;             // ISO8601, +10min cross-conversation cooldown
};
```

### 2.2 New `turn_corrected` event shape (append to `packages/dashboard/src/conversations/transcript.ts`)

```typescript
export interface TurnCorrectedEvent {
  type: "turn_corrected";
  turnNumber: number;            // the turn being corrected
  correctedContent: string;      // what the transcription actually produced
  correctedBy: "cfr-orchestrator";
  cfrFailureId: string;
  timestamp: string;             // ISO8601
}
```

Appended via existing `ConversationManager.appendEvent()` (see `packages/dashboard/src/conversations/manager.ts:137+`). The abbreviation queue (consumer at `packages/dashboard/src/automations/abbreviation-*`) must ingest these and prefer `correctedContent` over the original user turn content when summarizing. **That ingestion change is part of S5**, not S1.

---

## 3. Sprint 1 — Raw Media Persistence + CFR Detector

**Goal:** (a) Every inbound media buffer lands on disk at the channel layer before any downstream processing, and (b) chat-service emits deterministic `CapabilityFailure` events when STT fails.

**Files to create:**

### 3.1 `packages/dashboard/src/media/raw-media-store.ts`

```typescript
export class RawMediaStore {
  constructor(private agentDir: string) {}

  /**
   * Persist an inbound media buffer. Returns absolute path.
   * Writes to: <agentDir>/conversations/<conversationId>/raw/<attachmentId>.<ext>
   * Creates directories as needed. Idempotent per attachmentId.
   */
  async save(
    conversationId: string,
    attachmentId: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<string>;

  /** Absolute path for a persisted artifact, whether or not it exists on disk. */
  pathFor(conversationId: string, attachmentId: string, mimeType: string): string;

  /** Returns true if the path exists and is non-empty. */
  exists(absolutePath: string): boolean;
}
```

Extension policy: `.ogg` for `audio/ogg`, `.mp3` for `audio/mpeg`, `.wav` for `audio/wav`, `.jpg` for `image/jpeg`, `.png` for `image/png`, else the second half of mimeType (`image/webp` → `.webp`), else `.bin`.

Does **not** depend on `AttachmentService` or chat-service's `deps`. Instantiated in `App` constructor path, passed into transport layer.

### 3.2 `packages/core/src/capabilities/failure-symptoms.ts`

```typescript
import type { CapabilityFailureSymptom } from "./cfr-types.js";

/**
 * Parse an STT `transcribeAudio` error string into a symptom.
 * Inputs are the exact `error` strings produced by chat-service.ts:943 and :956.
 */
export function classifySttError(
  error: string,
  capExists: boolean,
  capEnabled: boolean,
): { symptom: CapabilityFailureSymptom; detail: string };

/**
 * Distinguish empty transcription from broken capability using capability-reported
 * confidence and duration.
 * Rule: raise `empty-result` only when durationMs > 500 && confidence > 0.2 && text is empty.
 * Silent/short audio returns null (no CFR).
 */
export function classifyEmptyStt(
  text: string,
  durationMs: number | undefined,
  confidence: number | undefined,
): CapabilityFailureSymptom | null;
```

Mapping rules are a single table; test it exhaustively.

### 3.3 `packages/core/src/capabilities/cfr-emitter.ts`

```typescript
import { EventEmitter } from "node:events";
import type { CapabilityFailure } from "./cfr-types.js";

/**
 * Sink that receives CFR events from anywhere in the framework.
 * Wired to the App in S4; for S1 exists and emits to a no-op listener.
 */
export class CfrEmitter extends EventEmitter {
  emitFailure(f: Omit<CapabilityFailure, "id" | "detectedAt" | "attemptNumber" | "previousAttempts">): CapabilityFailure;
  on(event: "failure", listener: (f: CapabilityFailure) => void): this;
}
```

**Files to modify:**

### 3.4 `plugins/channel-whatsapp/src/plugin.ts`

At line 497–549 (voice-note handling): after `audioBuffer` is materialized (line 501-506), persist it via `RawMediaStore` before constructing `incoming`. Add a new field to `IncomingMessage`:

```typescript
rawMediaPath?: string;   // absolute path written by RawMediaStore
```

The persistence key is `attachmentId = msg.key.id ?? \`\${Date.now()}\``. The `RawMediaStore` instance is injected via the plugin's existing deps bag — thread it through from `TransportManager`. **If threading adds >30 lines, file a deviation proposal.**

Also: images at `:559-577` get the same treatment.

### 3.5 `packages/dashboard/src/channels/message-handler.ts`

At the voice-note branch (around line 460-466): the chat-service call now carries the persisted path. Add to the `ChatMessageOptions`:

```typescript
attachments: chatAttachments.length > 0 ? chatAttachments : undefined,
inputMedium: first.isVoiceNote && first.audioAttachment ? "audio" : undefined,
rawMediaPath: first.rawMediaPath,   // NEW — pass through
```

Do not add detection logic here. Message-handler's job is transport translation only.

### 3.6 `packages/dashboard/src/chat/chat-service.ts`

**At line 536** (the deps guard): when `options?.attachments?.length && !deps?.attachmentService`, emit a CFR event before the bypass:

```typescript
if (options?.attachments?.length && !deps?.attachmentService) {
  this.app.cfr.emitFailure({
    capabilityType: detectCapabilityTypeFromMimes(options.attachments),
    symptom: "deps-missing",
    detail: "AttachmentService unavailable at chat-service entry",
    triggeringInput: buildTriggeringInput(options, convId, turnNumber),
  });
  // ...existing bypass continues
}
```

`detectCapabilityTypeFromMimes`: `audio/*` → `"audio-to-text"`, `image/*` → `"image-to-text"`, else `"attachment-handler"`.

**At line 600** (inside the `transcribeAudio` result branch): on `sttResult.error`, classify and emit:

```typescript
if (sttResult.error) {
  const cap = this.app.capabilityRegistry?.get("audio-to-text");
  const { symptom, detail } = classifySttError(
    sttResult.error,
    !!cap,
    !!cap?.enabled,
  );
  this.app.cfr.emitFailure({
    capabilityType: "audio-to-text",
    capabilityName: cap?.name,
    symptom,
    detail,
    triggeringInput: buildTriggeringInput(options, convId, turnNumber, audioAttachment),
  });
  // ...existing placeholder assignment continues
}
```

**At line 601** (the `sttResult.text` success branch): when `sttResult.text === ""`, call `classifyEmptyStt` with the duration/confidence reported by the script. If it returns a symptom, emit CFR; otherwise accept the empty transcript as valid user input.

**Acceptance tests (all in `packages/dashboard/tests/cfr/` — new folder):**

1. `raw-media-store.test.ts`: save + read-back idempotence, mime→ext mapping exhaustive.
2. `cfr-emit-deps-missing.test.ts`: construct `AppChatService` with `deps = null`, call `sendMessage` with attachments, assert one `failure` event with `symptom === "deps-missing"` and `triggeringInput.artifact.rawMediaPath` is present and the file exists.
3. `cfr-emit-stt-errors.test.ts`: stub `transcribeAudio` to return each error shape; assert the symptom mapping matches `failure-symptoms.ts`'s table.
4. `cfr-emit-empty-silent-vs-broken.test.ts`: feed `{text: "", durationMs: 120, confidence: 0}` → no CFR; feed `{text: "", durationMs: 1500, confidence: 0.9}` → CFR with `empty-result`.

**Verification commands:**
```bash
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run tests/cfr
```

**Escalate via deviation proposal if:**
- `IncomingMessage` adding `rawMediaPath` breaks >3 existing plugins.
- `App` doesn't already expose a field where `cfr: CfrEmitter` can live (likely it does; if not, propose).
- `classifyEmptyStt` requires data the existing `transcribe.sh` doesn't emit — *this is expected*; for S1 the script contract stays as-is and the function returns `null` when `durationMs`/`confidence` are undefined. Empty-result detection comes alive in S6.

---

## 4. Sprint 2 — Deps wiring at App boot

**Goal:** `AttachmentService`, `IdleTimerManager`, `PostResponseHooks` are constructed in the App-owned boot path and `app.chat.setDeps()` is called there, not in the WS handler. WhatsApp → chat-service works on a fresh dashboard with no browser connected.

**Files to modify:**

### 4.1 `packages/dashboard/src/app.ts`

At the service-namespace block (line 1815–1829), after `app.chat = new AppChatService(app);`, immediately wire deps:

```typescript
const attachmentService = new AttachmentService(agentDir);
const idleTimerManager = new IdleTimerManager(app.abbreviationQueue!, /* connectionRegistry */);
// NOTE: connectionRegistry isn't in App today — threading choice needed (see deviation trigger below)

app.chat.setDeps({
  abbreviationQueue: app.abbreviationQueue,
  idleTimerManager,
  attachmentService,
  conversationSearchService: app.conversationSearchService,
  postResponseHooks: app.postResponseHooks,
  log: (msg) => console.log(msg),
  logError: (err, msg) => console.error(msg, err),
});
```

**Known friction:** `IdleTimerManager` currently takes `ConnectionRegistry` which is a WS concept. Two options:
- (a) Lift `ConnectionRegistry` to App. Clean but big.
- (b) Make `IdleTimerManager`'s broadcast a callback so App boot can pass a no-op and WS handler later replaces it.

**→ Implement (b)**. If the `IdleTimerManager` constructor signature is hotter than expected (existing callers >3), file a deviation.

### 4.2 `packages/dashboard/src/ws/chat-handler.ts`

Remove lines 21–24 (the module-level `attachmentService` / `idleTimerManager` lazy singletons) and lines 38–59 (the first-connect init block). Remove the `app.chat.setDeps(...)` call at lines 61–69.

The WS handler's only remaining responsibility around deps: if `IdleTimerManager` uses callback (b) above, supply the broadcast callback to it on first connect via a setter method, not a constructor.

### 4.3 `packages/dashboard/src/channels/message-handler.ts`

If `deps` is unexpectedly null even after S2's boot wiring (should be unreachable post-S2 but keep defensive), emit CFR with `symptom: "deps-missing"` and log at `error` level. The S1 chat-service emit covers this; message-handler does NOT add its own.

**Acceptance tests:**

1. `packages/dashboard/tests/cfr/boot-deps-wired.test.ts`: instantiate App without starting the Fastify server, assert `app.chat["deps"]` is populated.
2. `packages/dashboard/tests/e2e/whatsapp-before-browser.test.ts`: headless App + mock WhatsApp plugin → send voice note while no WS client connected → assert `transcribeAudio` is reached, attachment is saved, audio file exists in `.my_agent/conversations/<conv>/attachments/`.

**Verification commands:**
```bash
cd packages/dashboard && npx vitest run tests/cfr/boot-deps-wired tests/e2e/whatsapp-before-browser
cd packages/dashboard && npx tsc --noEmit
```

**Escalate via deviation proposal if:**
- `IdleTimerManager`'s `ConnectionRegistry` dep turns out to be used in ways a callback can't replace.
- Removing the WS-side singletons breaks any existing test that imports them directly.
- `App` construction already ran via something other than `app.ts:1827` that we missed.

---

## 5. Sprint 3 — Capability hot-reload + restart gap closure

**Goal:** The framework really does hot-reload capabilities on filesystem changes, and both the brain and the fix automation cannot self-restart the dashboard.

**Files to create:**

### 5.1 `packages/core/src/capabilities/watcher.ts`

```typescript
import type { FSWatcher } from "chokidar";
import type { CapabilityRegistry } from "./registry.js";

export class CapabilityWatcher {
  constructor(
    private capabilitiesDir: string,
    private envPath: string,
    private registry: CapabilityRegistry,
    private onRescan?: (caps: Capability[]) => void,
  ) {}

  /** Start watching. Debounced 500ms. */
  async start(): Promise<void>;

  /** Stop watching and close the FSWatcher. */
  async stop(): Promise<void>;

  /**
   * Force a rescan immediately. After rescan, the registry's `testAll()` is
   * called to refresh capability statuses. Returns once both have finished.
   */
  async rescanNow(): Promise<Capability[]>;
}
```

Watches `<capabilitiesDir>/**/{CAPABILITY.md,.enabled,config.yaml,.mcp.json}`. On add/change/unlink (debounced), calls `registry.rescan(scanFn)` then `registry.testAll()`.

**Uses chokidar in polling mode** (we've found that works best on Ubuntu + NFS-adjacent mounts in prior sprints — see `packages/dashboard/src/automations/watch-trigger-service.ts:74-80`). If the existing service proves non-polling is fine, match it.

### 5.2 `packages/core/src/capabilities/registry.ts` — new `getHealth()` method

Add:

```typescript
interface CapabilityHealthReport {
  type: string;
  name: string;
  enabled: boolean;
  status: Capability["status"];
  health: Capability["health"];
  issue?: string;
}

getHealth(): CapabilityHealthReport[];
```

Returns one row per capability with a user-relevant issue flagged (`enabled && status==='unavailable'`, or `status==='available' && health==='degraded'`). Consumed proactively on boot by `App` (logs at WARN).

**Files to modify:**

### 5.3 `packages/dashboard/src/app.ts`

Construct `CapabilityWatcher` after the registry is initialized. Start it. Register stop in the shutdown path (the existing shutdown block around line 1848).

### 5.4 `packages/core/src/hooks/safety.ts`

At line 41–55 (`BLOCKED_BASH_PATTERNS`), **add**:

```typescript
  /systemctl\s+(restart|start|reload)\s+nina-/i,     // (M9.6) self-restart = self-kill
  /pkill\s+.*nina/i,                                  // pkill already partially covered, make explicit
  /kill\s+-9?\s+.*(node|nina)/i,                     // raw kill on our processes
  /service\s+nina-\S+\s+(restart|start|reload)/i,    // legacy service syntax
```

**Move the comment block** at line 51 to reflect the expanded purpose: "Block any self-restart/self-kill. The framework uses `CapabilityWatcher` + `registry.rescan()` for hot-reload; no restart is ever needed from a tool call."

### 5.5 `packages/core/src/agents/definitions.ts`

Lines 110–114 currently describe the watch as a fact. After S3 this is true. Verify the text at the review phase. No content change needed if S3.1 and S5.3 wire the watcher correctly; add a `// Verified real by M9.6-S3` comment adjacent.

### 5.6 Brain identity-layer system prompt

Locate the identity-layer prompt (per memory: `notebook/reference/standing-orders.md` for ops, `brain/CLAUDE.md` for identity — operational rules belong in standing-orders).

**Add to `.my_agent/notebook/reference/standing-orders.md` — wait, that's private.**

The framework side: `packages/core/src/prompt-assembly/` (or wherever layer 2 "operational" prompt is templated — check `packages/core/src/prompt.ts` which was found earlier). Add a framework-owned operational snippet:

```
## Never self-restart
You must NEVER run `systemctl restart nina-dashboard.service`, `pkill nina`, or any
command that kills or restarts the process you are running inside. Capability
changes hot-reload automatically via the framework's filesystem watcher — if a
fix requires a restart, you are looking at the wrong fix. Surface the restart
need to the user in plain text instead of executing it.
```

**If the operational prompt layering isn't obvious, file a deviation.** The memory note on identity-vs-operations split (`notebook/reference/standing-orders.md`) is the source of truth.

**Acceptance tests:**

1. `packages/core/tests/capabilities/watcher.test.ts`:
   - Create temp capability dir. Start watcher. Write `.enabled` file. Within 2.5s, assert `registry.isEnabled(type)` flips to true. (Amended from "1s" after S3: polling 500ms + debounce 500ms + fs/rescan/testAll makes sub-1s physically unreachable.)
   - Delete `CAPABILITY.md`. Within 2.5s, assert capability no longer in `registry.list()`.
2. `packages/core/tests/hooks/safety-restart-block.test.ts`: feed each blocked restart variant to the bash blocker, assert denied. Feed `systemctl restart unrelated-service`, assert allowed.
3. `packages/core/tests/capabilities/get-health.test.ts`: mixed capabilities, assert only unhealthy ones appear in output with correct `issue` string.

**Verification commands:**
```bash
cd packages/core && npx vitest run tests/capabilities/watcher tests/hooks/safety-restart tests/capabilities/get-health
cd packages/core && npx tsc --noEmit
```

**Escalate via deviation proposal if:**
- `packages/core/src/prompt.ts` doesn't contain the operational-layer templating and the location is unclear — ask the architect to point you.
- Adding `CapabilityWatcher` to App shutdown order conflicts with the existing reverse-init sequence.
- Chokidar polling vs native FS events behaves inconsistently in test.

---

## 6. Sprint 4 — Recovery Orchestrator

**Goal:** On CFR emit, orchestrate 3 fix attempts (Opus for reflection / Sonnet for execution), enforce budgets, re-verify against the raw artifact, and signal completion.

**Files to create:**

### 6.1 `packages/core/src/capabilities/recovery-orchestrator.ts`

```typescript
import type { App } from "@my-agent/dashboard";   // circular? → use interface only, inject impl
import type {
  CapabilityFailure,
  FixAttempt,
  SurrenderScope,
} from "./cfr-types.js";

export interface OrchestratorDeps {
  spawnAutomation: (spec: AutomationSpec) => Promise<AutomationHandle>;
  awaitAutomation: (jobId: string, timeoutMs: number) => Promise<AutomationResult>;
  capabilityRegistry: CapabilityRegistry;
  watcher: CapabilityWatcher;
  emitAck: (failure: CapabilityFailure, kind: AckKind) => Promise<void>;
  reprocessTurn: (failure: CapabilityFailure, recoveredContent: string) => Promise<void>;
  now: () => string;                                 // for test injection
}

export interface AutomationSpec {
  name: string;                                      // "fix-<capabilityType>-<shortId>"
  model: "opus" | "sonnet";
  autonomy: "cautious" | "standard";
  prompt: string;
  todos: Array<{ text: string }>;
  jobType: "capability_modify";
  parent?: { jobId: string; iteration: number };     // for nesting budget
}

export class RecoveryOrchestrator {
  constructor(private deps: OrchestratorDeps) {}

  /** Called by CfrEmitter 'failure' listener. Idempotent on (capability, conversation, turn). */
  async handle(failure: CapabilityFailure): Promise<void>;

  /** List currently-surrendered capabilities (for registry proactive-check consumer). */
  listSurrendered(): SurrenderScope[];

  /** Called by CapabilityWatcher after testAll — clears matching surrender scopes. */
  onCapabilityNowAvailable(type: string): void;
}
```

Internal state (not exported):
- `inFlight: Map<string, FixSession>` keyed by `capabilityType` — enforces per-capability mutex (second CFR for same cap attaches to same session).
- `surrendered: Map<string, SurrenderScope>` keyed by `capabilityType:conversationId:turnNumber` with 10-min global cooldown.
- `totalJobsInThisTrigger: Map<triggerRootId, count>` enforcing the 5-job cap (nesting budget).

### 6.2 `packages/core/src/capabilities/orchestrator-state-machine.ts`

Pure functions, no I/O, for the state transitions. Exports `nextAction(session, event): Action` so the orchestrator's logic is unit-testable without spawning real automations.

Transitions:
```
IDLE ──ack──► ACKED ──spawn(execute, sonnet)──► EXECUTING ──job done──► REFLECTING
REFLECTING ──spawn(reflect, opus)──► REVERIFYING ──re-verify pass──► DONE (reprocess turn)
                                                └──re-verify fail──► decide:
                                                    attempts<3 → ACKED (status) + iterate
                                                    attempts=3 → SURRENDER
(State names use present participles — `REFLECTING`/`REVERIFYING`/`DONE`/`SURRENDER` — describing the work in progress, not a past event. Amended 2026-04-15 post-S4.)
```

### 6.3 The fix-automation prompt template

`packages/core/src/capabilities/prompts/fix-automation.md` — markdown with `{{placeholders}}`:

- Opens with the CFR event shape.
- Describes the iteration's hypothesis (from `previousAttempts`).
- Required artifacts to produce: `status-report.md`, `deliverable.md` with frontmatter `change_type`, `test_result`, `surface_required_for_hotreload: false`.
- **Explicit rule: "Do NOT call `systemctl`, `service`, `pkill`, or any process-management command. The framework hot-reloads capabilities when their files change."**
- **Explicit rule: "Your smoke test is against a synthetic fixture. The orchestrator does the real re-verification against the user's audio. Do not try to read from `conversations/<convId>/raw/`."** (Isolation — the fix automation can't see user data.)

### 6.4 Re-verification harness

`packages/core/src/capabilities/reverify.ts`:

```typescript
export interface ReverifyResult {
  pass: boolean;
  recoveredContent?: string;     // the actual transcript/image-caption/etc.
  failureMode?: string;           // why re-verify failed
}

/**
 * Re-run the capability against the user's raw artifact.
 * Waits for registry.testAll() to report status === 'available' (up to 10s).
 */
export async function reverify(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
  watcher: CapabilityWatcher,
): Promise<ReverifyResult>;
```

Dispatcher by `capabilityType`:
- `"audio-to-text"` → spawns `scripts/transcribe.sh` against `rawMediaPath`, validates JSON output.
- `"image-to-text"` → TBD in M9.7; for M9.6 reverify returns `{pass: true}` if the capability is `status===available` and the artifact exists, since no image-to-text capability ships yet.
- Unknown types → `{pass: capability.status === 'available', failureMode: 'no reverifier registered'}`.

**Files to modify:**

### 6.5 `packages/dashboard/src/app.ts`

Instantiate `RecoveryOrchestrator` after `CapabilityWatcher` is started. Subscribe it to `CfrEmitter`'s `failure` events. Wire `emitAck` and `reprocessTurn` to concrete implementations in the dashboard layer (see S6).

For S4, stub `emitAck` to log-only and `reprocessTurn` to inject a system message via the existing `send-system-message` path (`packages/dashboard/src/chat/send-system-message.ts`). S6 replaces the ack stub with real user-facing delivery.

### 6.6 Automation job integration

The orchestrator's `spawnAutomation` delegates to the existing automation runner. Search for the spawn path (likely via `AutomationScheduler` or by writing a jsonl + watchdog — see `.my_agent/automations/*.jsonl` shape for precedent; the incident job used this path).

**If the automation-spawning API is not exposed from `@my-agent/core` today, file a deviation proposal.** Do not implement a parallel spawner.

**Acceptance tests:**

1. `orchestrator-state-machine.test.ts`: all transitions covered with table-driven tests.
2. `orchestrator-budget.test.ts`:
   - Same capability fails twice within 500ms → 1 fix session, not 2.
   - Parent CFR spawns nested CFR, nested cap also fails → total jobs across all sessions ≤ 5.
   - After 5, next CFR goes straight to surrender with `reason: "budget-exhausted"`.
3. `orchestrator-surrender-scope.test.ts`:
   - Surrender on (cap=X, conv=A, turn=5). Another CFR on (cap=X, conv=A, turn=6) within 10 min → goes straight to surrender.
   - `onCapabilityNowAvailable("X")` → both surrenders cleared.
   - Cross-conversation (cap=X, conv=B, turn=1) within 10 min → surrender (cross-conv cooldown).
4. `orchestrator-reverify-integration.test.ts`: real `transcribe.sh` under a fixture capability, incident's voice #1 audio file used as the raw artifact, assert `recoveredContent === "can you understand voice messages now"` (or similar — use the real transcript).

Copy the incident's audio to `packages/core/tests/fixtures/cfr/voice-1-incident.ogg` as a committed test asset. Transcript text is not asserted byte-exact (Deepgram output varies) — use substring match on "voice messages".

**Verification commands:**
```bash
cd packages/core && npx vitest run tests/capabilities/orchestrator
cd packages/core && npx tsc --noEmit
```

**Escalate via deviation proposal if:**
- No programmatic API exists to spawn an automation job (must go via filesystem-only).
- `AwaitAutomation` semantics require reading the job's `status-report.md` file only — which is fine, but is slow (polling). Confirm.
- Per-phase model selection: current `AutomationSpec`s in `.my_agent/automations/*.md` only have one `model:` field. If the automation runner can't switch models mid-run, structure each iteration as two separate spawns (execute-Sonnet then reflect-Opus). Propose before coding.

---

## 7. Sprint 5 — Orphaned-turn watchdog

**Goal:** On App boot, detect user turns with no following assistant turn and either re-drive (if recent and artifact available) or mark resolved-stale.

**Files to create:**

### 7.1 `packages/core/src/conversations/orphan-watchdog.ts`

```typescript
export interface OrphanWatchdogConfig {
  conversationLimit: number;          // default 5, configurable
  staleThresholdMs: number;           // default 30 * 60 * 1000 (30 min)
  rawMediaStore: RawMediaStore;
  conversationManager: ConversationManager;
  cfrEmitter: CfrEmitter;
  systemMessageInjector: (convId: string, prompt: string) => Promise<void>;
}

export class OrphanWatchdog {
  constructor(private config: OrphanWatchdogConfig) {}

  /** Run once at boot. No periodic sweeps. */
  async sweep(): Promise<OrphanSweepReport>;
}

export interface OrphanSweepReport {
  scanned: number;
  rescued: Array<{ conversationId: string; turnNumber: number }>;
  staleSkipped: Array<{ conversationId: string; turnNumber: number; ageMs: number }>;
  corruptSkipped: Array<{ conversationId: string; turnNumber: number; reason: string }>;
}
```

Idempotence: before re-driving, scan for a `watchdog_rescued` event already present for that `turnNumber`. If present, skip.

Event written after re-drive initiation, not completion — this prevents the "crash-during-rescue" loop the red-team flagged (M10). Paired with a `watchdog_rescue_completed` event on success. On next boot, orphan scanner treats turn as rescued if `watchdog_rescued` exists, regardless of completion — the in-flight re-drive is either alive or it's the user's problem to re-prompt.

### 7.2 `packages/dashboard/src/conversations/transcript.ts` — new event types

```typescript
export interface WatchdogRescuedEvent {
  type: "watchdog_rescued";
  turnNumber: number;
  initiatedAt: string;
}
export interface WatchdogResolvedStaleEvent {
  type: "watchdog_resolved_stale";
  turnNumber: number;
  ageMs: number;
  resolvedAt: string;
}
```

### 7.3 Abbreviation queue — ingest `turn_corrected`

File: locate the abbreviation consumer (search `AbbreviationQueue` class). When building the text for a summary, if a `turn_corrected` event follows a user turn, use `correctedContent` in place of the original turn's `content`. Write an integration test with a corrupted-then-corrected turn and assert the summary uses the corrected text.

**Files to modify:**

### 7.4 `packages/dashboard/src/app.ts`

After `RecoveryOrchestrator` is wired, instantiate `OrphanWatchdog` and call `sweep()` once. Log the report. Do not block boot on a long sweep — cap execution at 10s (`conversationLimit` of 5 should stay under).

### 7.5 Rescue-prompt template

The re-drive prompt given to the brain is framework-owned:

```
[SYSTEM: A user turn went unanswered (turn #{n} in this conversation, from {minutes}m ago).
The user's original content was transcribed as:

{correctedContent}

You are the conversation layer. Answer the user's original question directly —
don't acknowledge this system message, don't apologize for the gap, just respond
to what they actually asked.]
```

Place at `packages/core/src/prompts/orphan-rescue.md`.

**Acceptance tests:**

1. `orphan-watchdog-basic.test.ts`: conversation with user turn + no assistant turn, age 2 min → rescued; age 45 min → resolved-stale.
2. `orphan-watchdog-idempotence.test.ts`: run sweep twice on same conversation → second run finds `watchdog_rescued` event and skips.
3. `orphan-watchdog-audio-rescue.test.ts`: simulate incident voice #3 (placeholder content, raw media exists on disk, no STT ran) → watchdog calls reverify via audio-to-text capability, injects system message with actual transcript, writes `turn_corrected` event.
4. `abbreviation-honors-correction.test.ts`: corrupted turn + `turn_corrected` event → summary output contains corrected content, not the placeholder.

**Verification commands:**
```bash
cd packages/core && npx vitest run tests/conversations/orphan-watchdog
cd packages/dashboard && npx vitest run tests/automations/abbreviation
```

**Escalate via deviation proposal if:**
- The abbreviation consumer is spread across multiple files or has no clean insertion point for the `turn_corrected` logic.
- The system-message injection API doesn't support "ignore this, just answer the thing" framing without the brain acknowledging it (memory note on mediator-framing).

---

## 8. Sprint 6 — User-facing messaging + capability confidence contract

**Goal:** Ack / status / surrender messaging delivered on the right transport with the right timing. Capability scripts grow `confidence` and `duration_ms` fields so `empty-result` can distinguish silent input from broken STT.

**Files to create:**

### 8.1 `packages/core/src/capabilities/resilience-messages.ts`

```typescript
export interface ResilienceCopy {
  ack(failure: CapabilityFailure): string;
  status(failure: CapabilityFailure, elapsedSec: number): string;
  surrender(failure: CapabilityFailure, reason: "budget" | "iteration-3"): string;
}

export const defaultCopy: ResilienceCopy;
```

Copy — verbatim:

- **ack (audio-to-text, deps-missing or not-enabled):** "hold on — voice transcription isn't working right, fixing now."
- **ack (audio-to-text, execution-error):** "voice transcription just hit an error — let me fix that."
- **status (>20s elapsed):** "still fixing — second attempt."
- **surrender (iteration-3):** "I tried three fixes and voice transcription isn't working today. could you resend as text? I've logged the issue."
- **surrender (budget):** "I've hit the fix budget for this turn. could you resend as text while I look into it? I've logged the issue."

Other capability types fall back to substituted templates: `"hold on — {friendlyName} isn't working right, fixing now."` where `friendlyName` is a table: `image-to-text → "image understanding"`, `text-to-audio → "voice reply"`, else the raw type.

### 8.2 `packages/core/src/capabilities/ack-delivery.ts`

Framework-owned delivery of deterministic acks. Uses `TriggeringInput.channel` transport context to route the message back via the same channel. Calls through `TransportManager` (for channels) or emits via WS broadcast (for dashboard).

```typescript
export class AckDelivery {
  constructor(private transportManager: TransportManager, private connectionRegistry: ConnectionRegistry) {}
  async deliver(failure: CapabilityFailure, text: string): Promise<void>;
}
```

### 8.3 Capability contract extension

Update `skills/capability-templates/audio-to-text.md` to require scripts to emit:

```json
{
  "text": "...",
  "language": "en",
  "confidence": 0.92,
  "duration_ms": 3400
}
```

Migration rule: existing capabilities that don't emit these fields are still valid; `classifyEmptyStt` returns `null` when either is undefined (conservative — no false-positive CFR). File a follow-up to update the Deepgram script to emit real values once M9.6 ships.

### 8.4 Update `.my_agent/capabilities/stt-deepgram/scripts/transcribe.sh`

**WAIT.** Editing `.my_agent/` is forbidden per memory and `.guardrails`. Do NOT modify the private capability. Instead, update the framework template at `skills/capability-templates/audio-to-text.md` and file a follow-up in `FOLLOW-UPS.md` for the CTO to manually update her deepgram script.

**Files to modify:**

### 8.5 `packages/core/src/capabilities/recovery-orchestrator.ts`

Replace the S4 stub `emitAck: log-only` with a real call to `AckDelivery.deliver()`. Status messages fire on a 20s timer started at ack-emit.

### 8.6 `packages/core/src/capabilities/reverify.ts`

Read the new `confidence`/`duration_ms` from the transcribe.sh output and include them in the `ReverifyResult` for use by the orchestrator's reflection prompt.

**Acceptance tests:**

1. `resilience-copy.test.ts`: assert exact strings for each scenario.
2. `ack-delivery-transport.test.ts`: mock `TransportManager`, assert WhatsApp channel gets the ack text with correct `replyTo`.
3. `orchestrator-timing.test.ts`: freeze time, assert status message fires only after 20s elapsed and only on attempt ≥ 2.
4. `classify-empty-result-live.test.ts`: feed real Deepgram-shaped outputs with and without the new fields; confirm mapping.

**Verification commands:**
```bash
cd packages/core && npx vitest run tests/capabilities/resilience tests/capabilities/ack-delivery tests/capabilities/orchestrator-timing
```

**Escalate via deviation proposal if:**
- `TransportManager` doesn't expose a "send-as-if-from-Nina" path for framework-originated messages (it should — `sendViaTransport` is used in `message-handler.ts:486`, but check whether it works outside of an active chat-service turn).
- Identifying the WS broadcast path for dashboard-channel ack requires reaching into `ConnectionRegistry` in ways that feel hacky.

---

## 9. Sprint 7 — E2E incident replay + exit gate

**Goal:** Prove on the real incident's audio that M9.6 closes the bug class.

**Files to create:**

### 9.1 `packages/dashboard/tests/e2e/cfr-incident-replay.test.ts`

Fixture:
- Copy of `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`'s voice #1 audio, stored at `packages/core/tests/fixtures/cfr/voice-1-incident.ogg`.
- A fixture capability that wraps the real Deepgram script but without `.enabled` initially.

Test sequence:
1. Start headless App with the fixture capability configured but `.enabled` absent.
2. Simulate incoming WhatsApp voice #1 via mock transport.
3. Assert within 30s of ingestion:
   a. A framework-emitted ack turn appears in the conversation with the exact copy from S6.
   b. An automation job was spawned (check `.runs/` folder in the test's tmp agentDir).
   c. `.enabled` file is created by the fix automation.
   d. `CapabilityWatcher` picked up the change and registry shows `status: available`.
   e. An assistant turn follows containing a substring of the real transcript (e.g., "voice messages").
   f. Zero `systemctl restart` was issued (assert on the mocked bash-blocker hook's call log).
4. Confirm JSONL contains a `turn_corrected` event referencing the placeholder turn.
5. Run the test under `--detectOpenHandles --forceExit` to verify shutdown is clean (no leaked watchers).

### 9.2 The "no manual intervention" assertion

Because this is the exit gate, make it explicit: spin up a counter of "tool calls that would have required CTO approval" (e.g., via a hook) and assert `count === 0`.

**Verification commands:**
```bash
cd packages/dashboard && npx vitest run tests/e2e/cfr-incident-replay -t "voice #1 recovers without intervention"
```

**Files to modify:**

### 9.3 `docs/ROADMAP.md`

At the M9.6 row and the `NEXT — BLOCKER FOR EVERYTHING DOWNSTREAM` block, mark `Done` with date and link to this sprint folder's `review.md`. The review file is written by a separate reviewer agent, not the implementer.

**Escalate via deviation proposal if:**
- Real Deepgram calls in a test are disallowed (rate-limit / cost) — propose a mocked-capability variant that preserves the structural assertions.
- Mock transport for WhatsApp doesn't exist yet — that work might belong in M10-S1 instead.

---

## 10. Cross-sprint checklist

Before declaring M9.6 complete, verify:

- [ ] No `.my_agent/` files were modified during development. Check `git diff master -- .my_agent/` is empty.
- [ ] No new `systemctl restart` invocations appear anywhere in the codebase. `Grep -r "systemctl.*restart.*nina"` across `packages/` and `skills/` returns only tests or the blocker itself.
- [ ] `packages/core/src/agents/definitions.ts:110-114` (capability-builder's "framework watches" claim) is true (S3 delivered) and annotated.
- [ ] Open questions 1–10 in the spec are all marked closed with resolutions.
- [ ] All new test files are under `packages/*/tests/`, not in `.my_agent/`.
- [ ] Each sprint's `DECISIONS.md`, `DEVIATIONS.md`, `FOLLOW-UPS.md`, and `review.md` exist.
- [ ] Roadmap updated. `recent commits` section reflects the work with date-stamp.
- [ ] Pre-commit hook passes on every commit. No `--no-verify` used.

---

## 11. Non-goals (do not do these)

- Redesign the capability registry. Use `getHealth()` + `rescan()` as specified.
- Add a generic "retry on failure" to MCP tool invocations. MCP handling is out of scope for M9.6 beyond the existing middleware.
- Teach the brain to self-fix capabilities without going through the orchestrator. The orchestrator is the single entrypoint.
- Ship a UI badge for "capability fixing now" in the dashboard. That's a nice-to-have for M9.7 or later.
- Touch the WhatsApp connection logic itself (phone pairing, reconnect). Out of scope.
- Change Deepgram's script. That lives in `.my_agent/` — CTO-owned, architect-gated. File a follow-up instead.

---

## 12. References

- Design spec: `docs/design/capability-resilience.md`
- Red-team: `docs/design/capability-resilience-redteam.md`
- Incident JSONL: `.my_agent/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`
- Incident fix job: `.my_agent/automations/.runs/fix-audio-to-text-capability/job-4f716f84-ea2f-44b0-8f2f-f0bc54676119/`
- 3-tries origin: `docs/sprints/m9.5-s7-browser-capability/plan.md:272-273`
- Routing rule (ack channel): `docs/sprints/m10-s0-routing-simplification/plan.md`
- Capability system: `docs/design/capability-system.md`, `docs/design/capability-framework-v2.md`
- Normalized metadata: `docs/design/normalized-markdown-metadata.md`
- Paper trail: `docs/design/paper-trail.md`
