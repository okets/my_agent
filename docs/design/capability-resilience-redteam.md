# M9.6 Capability Resilience — Red-Team Review

> **Spec reviewed:** [`capability-resilience.md`](capability-resilience.md)
> **Incident replayed:** `.my_agent/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`
> **Reviewer stance:** adversarial — only findings where I'd push back

---

## Blockers

### B1. Detection layer is in the wrong file

The spec's detection table ([`capability-resilience.md:164-169`](capability-resilience.md#detection-points-runtime-instrumentation)) puts the primary audio detector at `packages/dashboard/src/channels/message-handler.ts:460-522`. That file is wrong. Message-handler only forwards buffers; it doesn't run or observe STT. All STT logic lives in `packages/dashboard/src/chat/chat-service.ts:587-616`, and the capability lookup is `this.app.capabilityRegistry?.get("audio-to-text")` at `chat-service.ts:941-944`. Message-handler has no visibility into `sttResult`.

If S1 wires the detector to the message-handler line range the spec names, it will see an audio attachment arriving and can't tell whether STT succeeded, failed, or was skipped. The three symptoms (`not-installed`, `empty-result`, `deps-missing`) are only distinguishable inside `transcribeAudio` or at the `sendMessage` call site that invokes it.

**Severity:** Blocker. The spec's detection table is load-bearing for S1's entire scope.

**Concrete scenario:** S1 ships, detector attaches to message-handler, voice #1 arrives, detector sees "audio present" but has no `sttResult` reference. It either (a) over-raises CFR on every voice note (false positive storm) or (b) under-raises because STT hasn't run yet at that layer.

---

### B2. Re-verification artifact doesn't exist for the deps-missing case

The spec's correctness property is "re-run the capability against the user's actual triggering input" ([spec §Re-verification Against Actual Input](capability-resilience.md#re-verification-against-actual-input)). Open question 3 flags artifact retention as unresolved; it's worse than "unresolved", it's structurally impossible in the failure mode the incident actually exhibited.

Voice #3 in the JSONL (line 33, turn 9) has `content: "[Voice note — audio attached, pending transcription]"` and **no `attachments` array at all** — contrast with voice #1 (line 23) which has the full attachments object. That's because attachments are only persisted inside the `deps?.attachmentService` branch at `chat-service.ts:536-584`. When `deps` is null (bug B — dashboard booted, no browser WS yet), the raw WhatsApp buffer was passed in memory via `message-handler.ts:460-466`, was never written to disk, and is lost the moment the event handler returns.

So in the deps-missing symptom — which is exactly the scenario S2 is designed to fix and exactly what happened for voice #3 — CFR cannot re-verify against the triggering input because there is no triggering input on disk. The audio is gone.

**Severity:** Blocker. The re-verification rule is the spec's answer to "how do we know the fix worked", and it fails in the headline failure mode.

**What the spec needs:** channel-side persistence of raw media before chat-service gets it, with an explicit CFR rule that on `deps-missing` the orchestrator uses the channel-retained blob. Or: surrender semantics scoped to "artifact lost — ask user to resend once", which is a materially different UX from "we fix it silently".

---

### B3. The self-destructive restart came from the brain, not the fix automation

Spec S3 proposes a PreToolUse hook that blocks `systemctl restart` during an active streaming session, with prompt wrapping on the fix automation saying "Do NOT run systemctl restart on your own host" ([spec §Sprint 3](capability-resilience.md#sprint-3--no-self-destructive-restart)).

Read the incident: the restart did not come from the fix job. `.my_agent/automations/.runs/fix-audio-to-text-capability/job-4f716f84.../status-report.md:34` explicitly says *"No service restart required — the registry re-reads capabilities on each brain session start."* The fix job behaved correctly. The restart came from the **conversation brain** one turn later:

> Turn 32 (conversation JSONL, 2026-04-15T11:55:44Z): *"Still failing — the dashboard needs a restart to pick up the newly enabled capability. Let me do that."*

That's the brain's own Bash tool. Wrapping the fix-automation's prompt achieves nothing for this path. The hook has to apply at the conversation brain's tool surface.

Worse, `packages/core/src/hooks/safety.ts:51` already blocks `systemctl stop|disable nina-` but deliberately allows `systemctl restart nina-` — someone made an explicit choice there. S3 needs to close that hole and reason about why it was open. The hook also has no current notion of "streaming session active" — that state lives in chat-service / session-registry and isn't exposed to the safety hook layer.

**Severity:** Blocker. The S3 acceptance test as written (fix-automation attempts restart → denied) passes against the wrong target; the real bug ships unfixed.

---

### B4. The "filesystem watcher auto-registers capabilities" claim is a lie

`packages/core/src/agents/definitions.ts:110-114` tells the capability-builder:

> *"The framework watches `.my_agent/capabilities/` for changes and auto-registers new capabilities. You do NOT need to run `systemctl restart`… the filesystem watch picks it up and the registry surfaces the capability within seconds."*

There is no such watch. Grepping `chokidar` / `fs.watch` across the repo finds the memory sync watcher and the watch-trigger service, but nothing watching capabilities. `registry.rescan()` exists at `packages/core/src/capabilities/registry.ts:196` but is only invoked from explicit callers (settings UI toggle, etc.), not from a file watcher.

This matters for M9.6 in two ways:
1. S3's "new: `capabilityRegistry.rescan()`" ([spec line 289](capability-resilience.md#sprint-3--no-self-destructive-restart)) describes rescan as if it's new. It isn't; it exists. What's missing is the automatic *invocation* path — either a chokidar watch on the capabilities dir, or an explicit rescan call from the fix-orchestrator after each iteration. The spec should say which.
2. The capability-builder has been lying to itself for weeks. The brain presumably believes the lie too (shared prompt lineage). That is likely *why* the brain restarted — she had no signal that the `.enabled` file was being picked up, so she reached for the sledgehammer. A hook that blocks the restart without giving the brain a working alternative (see the status polling question below) traps her: she can't restart, she can't tell if rescan worked, so she surrenders or retries the user-facing feedback loop. Net UX could be worse.

**Severity:** Blocker — S3 needs a real mechanism, not just a rename of an existing method, and the existing false claim in the capability-builder prompt must be retracted or made true.

---

## Major

### M1. The spec's incident narrative under-credits Nina's current behavior

Spec's Four Bugs table row 1 says Nina "Replied generically" to voice #1. JSONL line 24 is:

> *"Looks like the audio transcription didn't come through — the STT capability isn't available right now. Can you resend as text?"*

That is *not* a generic non-answer; it is actually a well-formed, symptom-accurate acknowledgment (better than what most systems produce). The real problem is that Nina asked the user to resend as text *instead of self-healing*. The spec's UX goal is autonomous recovery; the current state is "correct diagnosis, wrong disposition." Framing it as "generic non-answer" is rhetorically convenient but leads the sprint planning astray — the gap is a decision/action gap, not a symptom-recognition gap. S1's prompt engineering should shift from "detect better" (already fine) to "when you detect, trigger CFR instead of surrendering to the user".

**Severity:** Major. The sprint scope will be mis-sized if the team thinks detection is broken at the prompt layer.

---

### M2. Two distinct placeholder strings are silently conflated

Search results confirm two separate placeholder strings:

- `"[Voice note — audio attached, pending transcription]"` — emitted by the WhatsApp plugin at `plugins/channel-whatsapp/src/plugin.ts:518`, *before* chat-service sees it. Appears when transport layer has audio but the STT pipeline didn't run at all.
- `"[Voice message — transcription failed: <error>]"` — emitted by chat-service at `chat-service.ts:612`, when STT ran and failed.

Voice #1 content at JSONL line 23 is `"[Voice message — transcription failed: No audio-to-text capability available]"` — STT ran, failed.
Voice #3 content at JSONL line 33 is `"[Voice note — audio attached, pending transcription]"` — STT never ran.

These are different symptoms with different detection needs. The spec's CFR symptom taxonomy (`not-installed | not-enabled | deps-missing | ...`) is fine, but the incident table in §Four Bugs treats all three voice messages as "placeholder-only" and loses the signal that voice #3 hit a different code path. Sprint acceptance tests should cover both: voice #1 (STT ran, capability unavailable → `not-enabled`) and voice #3 (deps null, STT bypassed → `deps-missing`). The spec's S1 test only covers voice #1.

**Severity:** Major. Missed test coverage = incident recurrence on the "dashboard fresh boot, WhatsApp arrives before browser" edge case.

---

### M3. CFR ack-on-attempt-1 is a race between framework and brain

Design rule at [spec line 171](capability-resilience.md#detection-points-runtime-instrumentation): *"CFR detection lives in the framework, not in the brain's prompt."* That's right. But the attempt-1 ack ([spec §State Machine step 1](capability-resilience.md#state-machine)) is described as coming from the brain: *"1. ack to user (attempt 1)"*. S5 then says "Copy lives in the framework, not in the brain's prompt — deterministic."

Which is it? If framework emits the ack deterministically, good — but then the framework needs to know *the channel and replyTo context*, which chat-service currently only has via the `options.channel` bag passed in `message-handler.ts:509-523`. That context isn't accessible from a detached `failure-detector` singleton listening to events. You'd need the CFR event carrier to include full transport context, and framework-side ack emission needs the transport sender wired to it — not a trivial routing addition.

If instead the brain emits the ack, we have a race: framework raises CFR, orchestrator spawns fix job, orchestrator asks brain to please ack the user — but the brain may still be mid-stream on an unrelated turn (group chat, another conversation), or offline because the dashboard is restarting (see B3 recursion).

**Severity:** Major. This is the acceptance test for "no silence ever" — if it's a race, the promise breaks.

**What I'd expect:** explicit owner decision per symptom. Framework owns deterministic acks for `not-installed`/`not-enabled`/`deps-missing` (clear-cut). Brain owns acks for `empty-result`/`validation-failed` (needs judgment). Carrier-specific transport context travels with the CFR event.

---

### M4. User turn content in the JSONL stays corrupt after CFR recovery

The user turn saved at `chat-service.ts:620-636` is the placeholder string, persisted to disk. After CFR iteration succeeds and the real transcript is recovered, the spec says the brain re-processes and replies. Silent on: does the user's stored turn content get rewritten?

Two failure modes:
1. **Left as-is:** conversation summarization (turn 10 / 22 / 30 in the JSONL are `abbreviation` events at 11:49, 02:57, 11:52) will ingest the placeholder as if it were the user's message. Memory extraction and future re-replays see a corrupt record. Knowledge lifecycle pipelines (M6.9) compound the rot.
2. **Rewritten in place:** violates the append-only JSONL convention — no other code mutates turns in-place. If we rewrite we need a migration story and to decide what happens when abbreviation already ran on the placeholder.

Spec must pick one. I'd pick "append a `turn_corrected` event referencing the original turn's ID, and have the abbreviation queue skip re-abbreviation when such an event exists within the window" — but that's a design call, not a sprint detail.

**Severity:** Major. Missed here, becomes an invisible memory/search/summary bug tomorrow.

---

### M5. Surrender scope is unspecified

[Spec §Graceful Surrender](capability-resilience.md#graceful-surrender-iteration-3-fail): "Conversation is marked resolved (no orphan watchdog retry)." Fine for that conversation *turn*. What about:

- User retries voice 15 minutes later in the same conversation. New CFR? Fresh 3 attempts? Or still surrendered?
- User sends voice in a *different* conversation 2 min later. Capability is still broken. Spec silent.
- Background transient: the Deepgram API was 500-ing for 10 minutes, now it's back. Nothing tells the orchestrator to un-surrender.

Rule needed, at minimum: surrender is scoped to `(capability, conversation, turn)` with a time-bounded "don't retry for N minutes" across conversations to avoid DoS-by-retry. Also need a "capability just got re-tested successfully" event that clears surrender state globally.

**Severity:** Major. Affects the "one resolution thread per user message" promise the moment we have a second user message.

---

### M6. Cascading failures have no budget

Open question 7 flags this, and I don't think it can be left open. Concrete scenarios:

- Fix-audio-to-text needs web-search capability to find an API migration note. Web-search is also broken. Does the orchestrator spawn fix-web-search mid-iteration? Within its 3-tries budget? Shared budget?
- Fix-foo uses Bash to run a smoke test; the smoke test command needs a tool that itself uses a capability. Same question.
- The orchestrator *itself* is a subagent job (the incident job was a Sonnet automation). If spawning it fails (auth expired, MCP server down), what raises CFR on the fix loop?

Without a budget rule, 3 attempts × 3 nested capabilities = 27 Claude job spawns per user voice message, each one potentially running for a minute. At Opus prices and the user's Max subscription OAuth limits, this is a real wallet/rate-limit hazard. The M9.3 work on per-capability budgets is the natural prior art; CFR should inherit those hooks.

**Severity:** Major. Cost/rate-limit blast radius for a resilience feature is embarrassing.

---

### M7. Empty-result can't distinguish silent audio from broken STT

Look at `scripts/transcribe.sh` behaviour from the incident status report: feeding a 440Hz sine wave (no speech) returns `{"text": "", "language": "en"}`, exit 0. That's the same shape CFR treats as `empty-result` ([spec §CFR Event Shape](capability-resilience.md#cfr-event-shape)).

A user sends a 1-second voice note (thumb slipped, dog barked, no speech) → CFR fires → fix-automation runs → iteration 1 "fix" does nothing meaningful because capability is healthy → re-verify returns empty again → iteration 2 → ... → surrender message for a capability that isn't broken. User is told to "resend as text" when they actually just sent empty audio.

**Severity:** Major. High false-positive risk on a detection class that's explicitly in the symptom taxonomy.

**What I'd expect:** `empty-result` detection needs confidence from the capability itself. Transcribe.sh should return `confidence` or `duration_detected_speech_ms`. If stdout is valid JSON and `duration < threshold`, it's silent input, not broken. This is a capability-contract extension, not a CFR bug, but it has to be specified because otherwise CFR is noisy.

---

### M8. Status vs enabled are different registry concepts

The scanner and registry distinguish `.enabled` (user toggled it on) from `status` (`available | untested | unavailable`). `transcribeAudio` gates on `cap.status !== "available"` at `chat-service.ts:942`. Creating the `.enabled` file is necessary but not sufficient — the registry's `testAll()` must have run and marked status `available`.

The fix job added `.enabled` and exited. The spec doesn't say who then runs the test harness to flip status. If rescan() reads from disk and sees `.enabled=true` but status is still whatever the last testAll left it at, and if testAll hasn't run since, the capability stays `unavailable` and STT still returns the original error.

**Severity:** Major — S3 must specify the rescan → testAll → status-update sequence, and the orchestrator's "re-verify" step must wait for that pipeline, not just `.enabled` creation. Otherwise iteration 1's "fix" passes local checks but re-verification keeps failing and we burn all 3 attempts fixing a symptom that's actually a status-stale bug.

---

### M9. Fixture-fallback at runtime is semantically incoherent

Open question 5 asks whether the M9.5-S7 fixture-fallback rule applies at runtime. It shouldn't, and the spec can close this now. A "committed fixture" for build-time means: we couldn't build the real capability, here's a canned response so the system doesn't crash. For runtime: the capability *already exists*, it's just failing this minute. A canned response ("here's what this voice might have said") is not safe. The right answer at runtime is the surrender message the spec already prescribes ("resend as text"). Keeping the question open invites someone to ship a misguided fixture path.

**Severity:** Major (close it definitively, not an open Q).

---

### M10. Orphan watchdog: startup-only window is wrong-shaped for the incident

The incident had two orphaned user turns (voice #2 and #3), both killed by SIGTERM within the same minute. Startup-only watchdog catches them on next boot, OK. But the incident's specific pathology was *repeated* self-destructive restarts (11:55 and 11:56). Each restart creates a fresh watchdog pass. If the brain on boot N sees orphan, tries to reply, and restarts *again* during the reply (because CFR fixed a different capability and the brain again hits the stale restart-to-activate model), boot N+1's watchdog re-drives the same orphan and it compounds.

Spec's idempotence rule (marker in JSONL, skip if present) doesn't save us: marker is written "after re-driving", so on the second boot before the reply streams and is killed, the marker may or may not exist depending on *when* within the stream it was appended. If written at the start of re-drive, we skip legitimate retries after a crash mid-reply. If written at the end, we loop on crash-mid-reply.

**Severity:** Major. The watchdog's protection is load-bearing on S3 actually fixing the root-cause restarts; if S3's hook has holes (see B3/M11), S4 amplifies rather than contains the damage.

---

### M11. Per-phase model selection missing

Memory note (`project_m68_per_phase_model`): *skills declare Opus for plan/review, Sonnet for execute*. The actual fix-automation-file at `.my_agent/automations/fix-audio-to-text-capability.md:7` declares `model: sonnet`. CFR iteration requires hypothesis formation + reflection between attempts ([spec §3-Tries Budget & Reflection](capability-resilience.md#3-tries-budget--reflection))  — that's exactly the plan/review phase that should be Opus. If the orchestrator spawns fix jobs at Sonnet all the way through, iteration 2 and 3's hypothesis quality suffers, reducing the 3-attempt budget's value.

Spec should specify per-phase model: Sonnet for the actual change (cheap, fast), Opus for the reflection between iterations and for the final surrender-or-continue decision. S1 should call this out or the team will default to Sonnet for everything based on the existing automation template.

**Severity:** Major.

---

## Minor

### m1. Open question 4 (ack channel) is already answered by existing routing rule

Memory note `project_routing_rule`: *"conversation replies stay on the conversation's channel; escalations use 15-min presence + preferred-channel fallback."* CFR acks are conversation replies, not escalations — they go to the conversation's channel. Spec can close Q4 with a pointer to M10-S0 rather than leaving it open.

**Severity:** Minor (easy close, removes a red-team debate).

---

### m2. Concurrent CFR-in-same-conversation is worth specifying now

Open Q8: user sends voice #1, CFR starts; user sends voice #2 before iteration 1 completes. Obvious answer: per-capability mutex, queue subsequent triggers with the same capability, both triggers share the *current* fix loop's outcome. But it needs explicit spec because the naive implementation spawns two concurrent fix jobs and the second one's "created .enabled" operation races the first.

**Severity:** Minor, only because it's tractable — spec just has to say the rule.

---

### m3. Abbreviation jobs may race with CFR re-drive

Abbreviation events fire at 11:52 (right before voice #1) and 02:57 earlier. Abbreviation reads the JSONL, generates a summary, emits an event. If the watchdog re-drives an orphaned turn and an abbreviation queue tick runs while the re-drive is in-flight, the summary sees the placeholder content plus a new assistant reply that answered a different (re-transcribed) message. Corrupt summary.

**Severity:** Minor (rare), but belongs in the testing strategy — spec currently names unit/integration/E2E but no CFR-vs-background-jobs interaction test.

---

### m4. 5-sprint scope is optimistic

S1 alone is a new failure-detector + new recovery-orchestrator + prompt engineering for the fix subagent + integration with existing capability registry/paper trail + coordination with the brain's system-prompt layering. That's a full sprint just for S1. Add S2's deps refactor (already-retrofitted wiring is always painful to unwind cleanly), S3's hot-reload + hook + brain prompt education, S4's watchdog with idempotence edge cases, S5's user-facing copy + two-channel delivery. Realistically 7 sprints. Claiming 5 sets the team up to cut corners on the acceptance tests, which is how resilience features quietly ship half-working.

**Severity:** Minor (scheduling/expectations, not correctness).

---

## Nitpick

### n1. "raise CFR event" nomenclature is ambiguous

Event vs exception vs tool-use vs app.emit(). The spec uses "raise" in three places with different intent: from code, from the brain's assessment, from an MCP tool. Clarify a single primitive (`app.emit('capability:failure', ...)`) and forbid the others.

---

### n2. State-machine diagram drops the ack path

The ASCII diagram at [spec §State Machine](capability-resilience.md#state-machine) doesn't show the "ack to user" step, which is one of the most important user-visible properties. Add an edge so reviewers can see it's not optional.

---

## What I'd change

1. **Replace B1–B4 with resolved decisions before sprint kickoff.** Specifically: (a) move detection layer to chat-service (B1); (b) persist raw media at channel layer before any deps check (B2); (c) hook must target brain's Bash, close the `systemctl restart nina-*` gap in `safety.ts:51`, and retract the false filesystem-watcher claim in `agents/definitions.ts:110` (B3/B4); (d) specify whether rescan is FS-watch-driven or orchestrator-driven (B4).
2. **Re-order the spec's §Four Bugs table.** Voice #1 and voice #3 are distinct code paths with distinct placeholders (M2). Detection symptoms map differently; acceptance tests should cover both.
3. **Specify turn content mutation policy.** JSONL `turn_corrected` event + abbreviation skip rule (M4). Without this, CFR "success" leaves the record corrupt.
4. **Make surrender scope explicit.** `(capability, conversation, turn)` plus a cross-conversation cooldown (M5). Add a "capability re-available" event that clears surrender globally.
5. **Budget cascading CFR.** Max 1 level of nested fix; nested fix consumes the parent's attempt; hard cap on total jobs per triggering user turn (M6).
6. **Extend capability contract to surface confidence/duration** so `empty-result` can distinguish silent input from broken capability (M7).
7. **Couple the orchestrator to `rescan → testAll → status-change`, not to `.enabled` existence** (M8). Re-verification waits for status=available, then re-runs against the triggering artifact.
8. **Close open questions 4 and 5 in-spec.** Same-channel for ack (answered by M10-S0 rule). No fixture fallback at runtime (fixture is build-time only).
9. **Per-phase model selection for fix automations:** Opus for reflection/surrender-decision, Sonnet for execution (M11). Declare in the generated automation file.
10. **Budget the sprint count honestly at 6–7**, or trim scope (e.g., S5 copy could be absorbed into S1's ack path) (m4).

The spec's goals are right. The detection-layer error (B1), the vanished-artifact failure mode (B2), the wrong-target restart hook (B3), and the nonexistent filesystem watcher (B4) are each independently disqualifying for a "blocks M10+" claim. Fixing them raises my confidence from "this will ship half-working" to "this solves the class of incident the spec was named for."
