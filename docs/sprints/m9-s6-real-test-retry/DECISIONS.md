# M9-S6 Decisions Log

## D1: Providers — Deepgram STT + Edge TTS
**Severity:** Major (CTO decision)
**Decision:** Deepgram Nova-2 for STT ($200 free credits), Edge TTS for TTS (free, no API key).
**Reason:** CTO researched and specified both providers. Edge TTS chosen over ElevenLabs/OpenAI for zero cost. Deepgram chosen for speed (1-2s) and quality.

## D2: Fix MCP transport collision before retesting
**Severity:** Major
**Decision:** AutomationExecutor must not use shared MCP servers. Workers get fresh chart/image instances only.
**Reason:** Shared singletons caused "Already connected to a transport" crashes on every job run. Root cause of lost notifications, SIGTERM crashes, and stale DB connections.

## D3: Job monitoring — three-layer approach
**Severity:** Major
**Decision:** System prompt awareness (setRunningTasksChecker) + notification queue (next-turn delivery) + check_job_status MCP tool.
**Reason:** No single mechanism was reliable. System prompt prevents Nina from giving up. Queue handles async delivery. MCP tool enables active polling.

## D4: WhatsApp bleed fix — sourceChannel threading
**Severity:** Medium
**Decision:** Thread sourceChannel through fire_automation → job.context → handleNotification → alert(). Tag brain-triggered automations as 'dashboard'.
**Reason:** Same pattern as whatsapp-bleed-issue-2. Automation notifications were leaking to WhatsApp.

## D5: Voice mode hint over post-processing
**Severity:** Medium
**Decision:** Inject VOICE_MODE_HINT into brain query when input is audio. prepareForSpeech() as safety net only.
**Reason:** Better for Nina to write conversationally at the source than to strip markdown after the fact. TTS engines (Edge TTS) use punctuation for prosody, not markdown.

## D6: Audio queue, not concurrent playback
**Severity:** Minor
**Decision:** Sequential audio queue (playNextAudio) — each voice reply waits for the previous to finish.
**Reason:** Overlapping audio was "creepy" (CTO feedback). Split-turn responses must play in order.

## D7: Transcript replaces placeholder live
**Severity:** Minor
**Decision:** Send conversation_updated back to sender socket (not just other tabs). Client matches on "[Voice message]" placeholder and replaces with transcript.
**Reason:** Users need to see what they said, not a placeholder. Refresh should not be required.

## D8: TTS audio to runtime dir
**Severity:** Minor
**Decision:** TTS output goes to {agentDir}/audio/ served via /api/assets/audio/. Not in public/ (repo).
**Reason:** Audio files were accumulating in the git-tracked public directory.
