# Follow-Ups from M9.5-S6 Smoke Tests

Items discovered during smoke testing that are outside this sprint's scope but need tracking.

## UX-1: 30-second silent gap between job completion and Nina's reply

**Observed during:** CNN automation smoke test (2026-04-12).

**Symptom:** After the automation worker finishes and the job card's task list completes, the job card disappears from the chat area. Then there is roughly a 30-second silent period before the "three dots" indicator appears showing Nina is drafting her reply about the automation result.

**Why it matters:** Users interpret silence as "the job was lost." The progress report (job card with task list) is valuable precisely because it shows continuous activity — if the screen goes silent for 30 seconds right after "completion," that defeats the point of showing progress in the first place.

**Two candidate fixes (choose one or combine):**

1. **Close the 30-second gap.** Find what is happening in those 30 seconds (is it a cooldown? A fact-extraction step? Waiting for the conversation Nina session to initialize? A debounce timer?) and eliminate or shorten it. Ideally conversation Nina starts drafting within 1-2 seconds of the job completing.

2. **Keep the job card visible until Nina starts replying.** Instead of dismissing the card on job completion, transition it to a "handing off..." state and only dismiss once conversation Nina emits her first token. This preserves flow continuity even if we can't shorten the gap.

**Suggested priority:** Medium — it's a UX regression that undermines the progress UI but doesn't break functionality. Pick it up post-M9.5 or bundle with the next dashboard UX pass.

**Where to look first:**
- `AutomationExecutor` job-completed event → `ConversationInitiator` / `alert()` → `SessionManager.streamMessage()` path
- WebSocket broadcast timing for `job:completed` vs conversation turn start
- Any fact-extraction / abbreviation / memory-indexing that runs between job end and reply start
