# Bug Report: CFR Gap for Tool Capabilities (browser-control, desktop-control)

**Date:** 2026-04-21  
**Discovered during:** M9.6-S21 live retest — user asked Nina to screenshot a website  
**Capability under test:** `browser-chrome` (`browser-control` type)  
**Severity:** High — task silently dropped after successful recovery  

---

## Summary

The CFR (Capability Failure Recovery) pipeline handles input capabilities (STT) and output
capabilities (TTS) correctly. Tool capabilities — those invoked mid-brain-session as MCP
tools (browser-control, desktop-control) — have two structural gaps that cause broken UX
even when the underlying capability recovers successfully.

---

## Bug 1: Ack arrives after the brain has already replied

### What happens

1. User asks Nina to take a screenshot of a website
2. Brain starts, calls `browser_navigate` MCP tool → tool fails
3. The SDK delivers the tool error back into the running brain session
4. Brain reacts to the error and replies: *"Browser's not installed, can I set one up?"*
5. **Only now** does PostToolUseFailure fire → CFR starts fix automation
6. User receives: negative reply, then "hold on, fixing…" ack, then "fixed!" ack

The acks arrive in the wrong order. The user already has a final (negative) answer before
recovery even begins.

### Why STT doesn't have this problem

STT failure is detected *before* the brain runs. The `sttResult === null` path in
`chat-service.ts` activates the BUG-2 gate, which holds the brain call entirely. The brain
never sees the failure; it only runs after `reprocessTurn` resolves the gate with recovered
content.

Browser-control failure happens *mid-session* — the brain is already executing when the
tool call fails. There is no gate. The brain responds to the tool error autonomously
before CFR can intervene.

### Root cause

`PostToolUseFailure` fires asynchronously after the SDK delivers the error to the brain.
By the time CFR begins, the brain session may already be producing (or have produced) a
reply. There is no mechanism to suppress or delay the brain's error response when CFR is
about to take over.

---

## Bug 2: Task not retried after successful fix

### What happens

CFR completes the full recovery chain successfully:
- Fix automation runs ✅
- `dispatchReverify` passes (`pass: true`) ✅
- `terminal-fixed` ack sent to user ✅
- `recoveredContent = undefined` → `reprocessTurn` not called ❌
- Original screenshot request: **silently dropped**

The user receives a "fixed!" notification but never gets the screenshot.

### Why STT doesn't have this problem

`reverifyAudioToText` in `reverify.ts` returns `recoveredContent: <transcribed text>` —
the actual content that was lost when STT failed. The orchestrator's `terminalDrain`
(line 665 in `recovery-orchestrator.ts`) calls `reprocessTurn` when
`outcome === "fixed" && recoveredContent !== undefined`, feeding that content to the brain.

For browser-control, `dispatchReverify` falls through to `runSmokeFixture` (the MCP plug
default in `reverify.ts` line 328). Smoke fixture returns `{ pass: true }` with no
`recoveredContent`. There is no content to recover — the capability was a tool being
used mid-task, not an input artifact being transcribed.

So `terminalDrain` reaches line 665, sees `recoveredContent === undefined`, skips
`reprocessTurn`, emits a terminal ack, and closes. The original task is gone.

### Root cause

`reprocessTurn` is designed for input capabilities: it delivers recovered content (e.g. a
transcription) as if the original input had succeeded. For tool capabilities, there is no
"recovered content" — what needs to happen is a *re-execution* of the original request,
not a content replay. The orchestrator has no mechanism for this.

---

## Structural difference: input vs tool capabilities

| | STT (input) | Browser-control (tool) |
|---|---|---|
| When failure is detected | Before brain runs | Mid-brain-session |
| Brain sees the failure? | No — gated | Yes — tool error in session |
| Brain replies before fix? | No | Yes |
| Recovery produces content? | Yes — transcription | No |
| Task retried after fix? | Yes — `reprocessTurn` | No — silently dropped |
| Fix is generic? | Yes | Needs new mechanism |

---

## What a fix needs

### For Bug 1 (ack ordering / brain races CFR)

When PostToolUseFailure fires for a conversation-origin tool capability failure, there
needs to be a way to suppress or defer the brain's autonomous error response until CFR
has had a chance to complete. Options to evaluate:

- **Option A:** Intercept the tool error in the SDK hook before it reaches the brain
  session, hold delivery until CFR outcome is known, then either inject a "tool recovered,
  retry" signal (if fixed) or release the error (if surrendered).
- **Option B:** Accept the race; suppress the brain's error reply from being delivered to
  the user channel when CFR is active for that session; deliver CFR's outcome instead.
- **Option C:** No suppression, but have CFR's `terminal-fixed` ack include an instruction
  for Nina to retry ("Your browser just recovered — please complete the screenshot
  request"), making the sequence at least coherent even if not ideal.

Option C is the lowest effort but leaves a gap window where the negative reply has already
landed. Options A/B require SDK-level hook work.

### For Bug 2 (task not retried)

After `terminal-fixed` for a conversation-origin tool capability failure, the orchestrator
should re-send the original user turn to the brain with a signal that the tool is now
available.

The orchestrator already knows:
- `convId` and `turnNumber` from `TriggeringInput.origin`
- `capabilityType` (browser-control)
- The original user message is in conversation history

A new path in `terminalDrain` alongside the existing `reprocessTurn` path:

```
if (outcome === "fixed" && recoveredContent !== undefined) {
  // existing: input capability — replay content
  await reprocessTurn(failure, recoveredContent)
} else if (outcome === "fixed" && isToolCapability(failure.capabilityType)) {
  // new: tool capability — re-execute original request
  await retryTurn(failure)   // re-sends original user message to brain
}
```

`retryTurn` does not need capability-specific logic. It looks up the original user turn
from conversation history and re-submits it to `chat-service`, same as any new message.
The brain sees the tool as available (capability is now fixed) and completes the task.

`isToolCapability` can be inferred from type (anything not in
`{audio-to-text, text-to-audio, image-to-text, text-to-image}`) or declared explicitly
in CAPABILITY.md frontmatter as `interaction: tool`.

### No per-capability code required

Both fixes are generic. The orchestrator handles all tool capabilities identically —
browser-control, desktop-control, and any future tool capability added to the system.

---

## Evidence from live test

**Conversation:** `conv-01KPQKW04B7RBNBDGNHFZDJ4NZ`

```
user:      please send me a picture of the foxnews website.
assistant: Sure, one sec.
assistant: Browser's not installed on this machine so I can't grab a live screenshot.
           Want me to set up a browser capability so this works going forward?
```

**Service log (12:17–12:19):**
```
12:17:28  [Brain] createBrainQuery model=sonnet   ← brain starts, tool fails
12:17:37  [CFR] ack(attempt) for browser-control  ← CFR starts AFTER brain already replied
12:17:37  [AutomationExecutor] Running fix automation
12:19:14  [AutomationExecutor] Automation completed success=true
12:19:14  [RecoveryOrchestrator] doReverify start hasRawMediaPath=false
12:19:27  [RecoveryOrchestrator] doReverify result pass=true recoveredContent=undefined
12:19:27  [CFR] ack(terminal-fixed)               ← task never retried
```

Screenshot never delivered.
