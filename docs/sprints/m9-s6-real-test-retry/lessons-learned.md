# M9-S6 Lessons Learned

> Compiled from 4 iterations of the "real test" — having Nina create STT (Deepgram) and TTS (Edge TTS) capabilities from scratch.
> Date: 2026-04-04

---

## What Worked

- Brainstorming skill fires reliably on capability requests
- Template system works — Nina reads them and follows the contracts
- Builder produces working scripts that pass the test harness
- Sequential building (STT first, then TTS) avoids MCP collisions between jobs
- `check_job_status` MCP tool saved the flow when automatic notifications failed
- Edge TTS: free, no API key, 761ms latency, valid OGG Opus output
- Deepgram STT: 1.2-1.7s latency, handles OGG/WebM/WAV/MP3 transcoding
- Nina corrected a user's misnamed env var (`DEEPGRAM_API` → `DEEPGRAM_API_KEY`) on her own
- Nina self-diagnosed and fixed a path bug in the transcription invocation
- Record button appears automatically when STT capability is available
- End-to-end voice recording → transcription → response works

---

## Issues to Fix

### P0 — Critical (blocks reliable operation)

#### 1. MCP Transport Collision in AutomationExecutor
**Error:** `Already connected to a transport. Call close() before connecting to a new transport`
**Where:** `AutomationExecutor.run()` at line 206
**Impact:** Unhandled rejection prevents `executeAndDeliver()` from completing → `handleNotification()` never called → no completion notification → `once: true` not processed → automation stays active
**Root cause:** Chart/image MCP servers are singleton instances shared between brain session and automation workers. Worker tries to connect to an already-connected transport.
**Fix:** Create fresh MCP server instances per worker, or skip chart/image servers for workers that don't need them (capability builders don't need chart tools).
**Observed:** Every single job run in all 4 iterations.

#### 2. SDK Process SIGTERM Crashes (exit code 143)
**Errors:** `Claude Code process exited with code 143`, `ProcessTransport is not ready for writing`
**Where:** During `streamMessage`, `fire_automation` MCP tool calls
**Impact:** Dashboard crashes and restarts (4 restarts during S6 testing). Active conversations lose their session.
**Root cause:** Likely caused by the MCP transport collision — the unhandled rejection destabilizes the SDK process, which then gets killed.
**Observed:** Multiple times, always correlated with automation firing.

### P1 — High (degrades user experience)

#### 3. Job Completion Notifications Not Delivered
**Symptom:** Nina launches a tracked job, waits for notification, notification never arrives. She needs manual nudging ("check the job status") to discover the job completed.
**Root cause:** Issue #1 (MCP collision) causes `executeAndDeliver()` to throw before reaching `handleNotification()`. The queued notification fix (from this sprint) works IF the notification is queued, but the upstream error prevents it.
**Dependency:** Fix #1 first, then the notification queue will work.

#### 4. Test Harness Timing — False "degraded" on New Capabilities
**Symptom:** Capability shows `degraded` immediately after creation, then self-corrects on rescan.
**Root cause:** File watcher triggers rescan → test harness runs → but builder hasn't finished writing scripts/installing deps yet. Test finds missing script → marks degraded.
**Fix options:**
  - (a) Don't run test on first scan if capability is brand new (< 30 seconds old)
  - (b) Retry test after a delay on first failure
  - (c) Only test capabilities that have all expected files (check for scripts/ before testing)
**Observed:** Both STT and TTS in iterations 1-3.

### P2 — Medium (should fix)

#### 5. Builder Chose Wrong Provider (gTTS instead of Edge TTS)
**Symptom:** Iteration 2 — TTS builder ignored the "Edge TTS" spec and chose gTTS.
**Root cause:** The alert injection path (`debug/initiate`) sent the provider spec as a system turn, not a user message. The builder may not have received the provider choice clearly.
**Fixed in this sprint:** Builder prompt now says "CRITICAL: Follow the spec. Use the exact provider specified." Verified working in iterations 3-4.

#### 6. Nina Falls Back to Inline Building
**Symptom:** Iteration 2 — Nina launched tracked jobs, checked too early, thought they failed, built inline instead (no paper trail for TTS).
**Root cause:** No real-time job feedback. Nina polled the filesystem, didn't see output, gave up.
**Partially fixed:** `setRunningTasksChecker` now shows running jobs in system prompt. `check_job_status` MCP tool allows active polling. Full fix depends on #1 and #3.

#### 7. Stale DB Connections After Crash
**Error:** `TypeError: The database connection is not open`
**Where:** `AbbreviationQueue`, `fire_automation`
**Root cause:** After crash/restart, old callbacks reference closed DB connections.
**Impact:** Abbreviations fail (conversations don't get titles), automation firing fails until next clean start.

#### 8. Off-Script Questions in Early Iterations
**Symptom:** Nina asked about channels ("WhatsApp only or dashboard too?") and system deps ("is Python available?").
**Fixed in this sprint:** Brainstorming skill now says "Do NOT ask about channels or system deps."
**Verified working:** Iterations 3-4 had zero off-script questions.

### P3 — Low (nice to have)

#### 9. Missing `health` Field in Capabilities WS Payload
**Where:** `state-publisher.ts:269-280` — `publishCapabilities()` sends `name, provides, interface, status, unavailableReason` but NOT `health` or `lastTestLatencyMs`.
**Impact:** Client-side can't show health status. Minor — button visibility works via `status`, but health display would be useful.

#### 10. Voice Replies Don't Autoplay
**Symptom:** When Nina responds with voice (TTS), the audio player appears but doesn't play automatically. User has to click play.
**Expected:** Voice replies should autoplay — if the user sent a voice message, the natural UX is to hear the response immediately.
**Fix:** In the dashboard's audio player rendering, add `autoplay` attribute when the response is to a voice input (`inputMedium === 'audio'`). Respect browser autoplay policies (may need user interaction first).

#### 11. `capabilities` Message Logged as "Unknown" in app.js
**Where:** `app.js:1868` — the switch statement doesn't have a case for `capabilities`.
**Impact:** Console noise. `ws-client.js` handles it correctly, but `app.js` logs a warning.
**Fix:** Add `case "capabilities": break;` to the switch.

#### 11. Abbreviation Failures After Crash
**Symptom:** `Abbreviation failed for conv-...: Claude Code process exited with code 143`
**Impact:** Conversations don't get auto-generated titles after crashes. Cosmetic.

#### 12. Nina Told User to Edit .env (Iteration 1)
**Symptom:** First iteration — Nina told user to add key to `.env` and run `systemctl restart`.
**Fixed in this sprint:** Builder prompt and notebook reference now say "NEVER tell users to edit .env — always say Settings."
**Verified working:** Iterations 3-4 correctly referenced Settings UI.

#### 13. WhatsApp Bleed on Job Notifications (Iteration 2)
**Symptom:** STT completion notification sent to WhatsApp instead of staying on dashboard.
**Fixed in this sprint:** `sourceChannel` threading through `alert()`. Not re-observed in iterations 3-4.

---

## Process Fixes Applied During S6

| Fix | Files Changed | Status |
|-----|--------------|--------|
| Builder follows provider spec | `agents/definitions.ts` | Verified |
| No .env/bash instructions to users | `agents/definitions.ts`, notebook reference, brainstorming skill | Verified |
| No off-script questions | Brainstorming skill | Verified |
| Sequential job building | Brainstorming skill | Verified |
| Job monitoring (system prompt) | `app.ts`, `session-manager.ts` | Partially working (depends on #1) |
| Job monitoring (check_job_status tool) | `automation-server.ts` | Working |
| Job monitoring (notification queue) | `session-manager.ts`, `conversation-initiator.ts` | Blocked by #1 |
| WhatsApp bleed fix | `conversation-initiator.ts`, `automation-processor.ts`, etc. | Working |

## Recommended Next Steps

1. **Fix MCP transport collision (#1)** — this is the root cause of #2, #3, and #7. Everything else works once this is fixed.
2. **Fix test harness timing (#4)** — small change, high impact on UX during capability creation.
3. **Add health to WS payload (#9)** and fix console warning (#10) — quick wins.
4. **Investigate SDK SIGTERM (#2)** — may be a symptom of #1 or a separate issue.
