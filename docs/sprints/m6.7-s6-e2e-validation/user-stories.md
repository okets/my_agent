# M6.7-S6: Human-in-the-Loop Test Scenarios

> **Purpose:** Step-by-step walkthrough for CTO manual validation of the M6.7 Two-Agent Refactor milestone.
>
> **Prerequisites:** Dashboard running (`systemctl --user status nina-dashboard`), browser open to the dashboard URL.
>
> **Time estimate:** ~15 minutes for scenarios A-D, +5 minutes if WhatsApp is connected (scenario E).

---

## Scenario A: Daily Conversation Flow

**Goal:** Verify the core conversation lifecycle — create, chat, switch, browse, resume.

### Steps

1. **Open the dashboard** in your browser.
   - [ ] The chat panel loads with the current conversation (or empty state if none exists).
   - [ ] The left sidebar shows the **Home** tab with a **Conversations** widget.

2. **Send a message** in the chat panel (e.g., "What time is it?").
   - [ ] Response streams in real-time with visible text appearing incrementally.
   - [ ] The conversation title auto-generates after a few turns (if this is a new conversation).

3. **Click the "New chat" button** (top-right of chat header, pencil-square icon).
   - [ ] The chat panel clears and shows a fresh conversation.
   - [ ] The previous conversation appears **immediately** in the Conversations widget on the left.
   - [ ] The widget entry shows: title (or "Untitled"), relative time (e.g., "just now"), and a message preview snippet.

4. **Send a message** in the new conversation (e.g., "Tell me about the weather").
   - [ ] Response streams correctly in the new conversation.

5. **Hover over the previous conversation** in the Conversations widget.
   - [ ] A **"View -->"** link appears on hover.

6. **Click "View -->"** on the previous conversation.
   - [ ] A read-only preview panel opens as a tab in the left sidebar.
   - [ ] The full transcript is visible (scrollable).
   - [ ] A gradient **"Resume conversation"** button appears at the bottom.

7. **Click "Resume conversation"**.
   - [ ] The preview tab closes.
   - [ ] The chat panel loads the resumed conversation with all previous messages.
   - [ ] The conversation you were just in (from step 4) now appears in the Conversations widget.
   - [ ] You can send a new message and get a response in the resumed conversation.

8. **Type `/new` in the chat input** and send.
   - [ ] Same behavior as step 3: fresh conversation starts, old one moves to widget.

### Pass criteria
All checkboxes above are checked. No console errors (open DevTools > Console to verify).

---

## Scenario B: Search

**Goal:** Verify keyword and semantic search across conversations.

### Prerequisites
At least 3 conversations with distinct topics. If you don't have them, create them:
- Conversation 1: discuss "nginx reverse proxy configuration"
- Conversation 2: discuss "systemd service management"
- Conversation 3: discuss "Tailscale VPN networking"

### Steps

1. **Locate the search icon** in the Conversations widget header (magnifying glass icon, right side).

2. **Click the search icon**.
   - [ ] A search input field expands below the widget header.
   - [ ] The input is auto-focused.

3. **Type a keyword** that matches one conversation (e.g., "nginx").
   - [ ] Results appear within 1-2 seconds.
   - [ ] The matching conversation(s) are shown with highlighted content snippets.
   - [ ] Non-matching conversations are filtered out.

4. **Try a semantic query** (e.g., "that conversation about web server setup").
   - [ ] If Ollama is running: results include the nginx conversation even without exact keyword match.
   - [ ] If Ollama is not running: only keyword matches appear (graceful degradation, no errors).

5. **Clear the search** by pressing Escape or clearing the input text.
   - [ ] The normal conversation list returns.
   - [ ] All conversations are visible again.

6. **Close search** by clicking the magnifying glass icon again.
   - [ ] The search input collapses.

### Pass criteria
Keyword search returns correct results. Semantic search works if Ollama is available, degrades gracefully if not. No errors on clear/close.

---

## Scenario C: Mobile Flow

**Goal:** Verify the mobile-responsive layout and conversation interactions.

### Steps

1. **Resize browser to mobile width** (< 768px), or open on a phone/tablet.
   - [ ] The layout switches to mobile mode with a bottom tab bar.
   - [ ] The **Home** tab is selected by default.

2. **Verify the Conversations widget** is visible on the Home tab.
   - [ ] Shows inactive conversations with titles, times, and preview snippets.
   - [ ] Current conversation is NOT shown in the widget list.

3. **Tap "View -->"** on a conversation in the widget.
   - [ ] A popover/sheet opens showing the full transcript.
   - [ ] The transcript is scrollable.
   - [ ] A "Resume" button is visible.

4. **Tap "Resume"**.
   - [ ] The popover closes.
   - [ ] The chat view expands (half or full state).
   - [ ] The resumed conversation loads in the chat with all messages.
   - [ ] You can send a message and receive a response.

5. **Tap "New chat"** in the mobile chat header (pencil-square icon).
   - [ ] A new conversation starts.
   - [ ] The previous conversation returns to the Conversations widget.

### Pass criteria
All mobile interactions work without layout glitches. No elements overflow or get cut off. Popover opens and closes cleanly.

---

## Scenario D: Stale Session Resume

**Goal:** Verify the server handles a restart gracefully without losing the conversation.

### Steps

1. **Send a message** in the current conversation and wait for the response to complete.
   - Note the conversation title and last message content.

2. **Restart the dashboard service** from a terminal:
   ```bash
   systemctl --user restart nina-dashboard
   ```

3. **Wait 3-5 seconds**, then **reload the browser page** (Ctrl+R / Cmd+R).
   - [ ] The dashboard loads successfully.
   - [ ] The same conversation is loaded (matching title and messages from step 1).

4. **Send another message** (e.g., "Are you still there?").
   - [ ] Response streams correctly.
   - [ ] No error messages or broken state in the UI.
   - [ ] Check the terminal/journal for any "resume failed" warnings:
     ```bash
     journalctl --user -u nina-dashboard --since "2 minutes ago" | grep -i "resume\|fallback\|session"
     ```
   - [ ] If you see "SDK session resume failed ... falling back to fresh session" -- that is expected and correct behavior. The fallback should be transparent to the user.

### Pass criteria
Conversation survives server restart. User can continue chatting. Fallback to fresh session is silent (no user-visible errors).

---

## Scenario E: Channel Badge Verification

**Goal:** Verify that channel badges appear correctly on cross-channel messages.

> **Skip this scenario** if WhatsApp is not connected. Check with: `systemctl --user status nina-whatsapp`

### Steps

1. **Send a message from the web dashboard**.
   - [ ] The message bubble has no channel badge (web is the default, no badge needed).

2. **Send a message from WhatsApp** to the agent's number.
   - [ ] The agent responds on WhatsApp.

3. **Check the web dashboard** — the WhatsApp conversation should appear.
   - [ ] Messages from WhatsApp show a green WhatsApp badge/icon on the message bubble.
   - [ ] The conversation in the widget shows the channel indicator.

4. **View the WhatsApp conversation transcript** in the web dashboard.
   - [ ] All messages are visible with correct sender attribution.
   - [ ] Channel badges are consistent throughout the transcript.

### Pass criteria
WhatsApp messages are visually distinguished from web messages. Channel badges render correctly.

---

## Post-Test Checklist

After completing all scenarios:

- [ ] **No console errors**: Open DevTools (F12) > Console tab. No red errors related to conversations, search, or websocket.
- [ ] **No layout issues**: All panels, widgets, and buttons render correctly at both desktop and mobile sizes.
- [ ] **Server logs clean**: `journalctl --user -u nina-dashboard --since "30 minutes ago" | grep -i error` shows no unexpected errors.

### Reporting Issues

If a scenario fails, note:
1. Which step failed
2. What you expected vs. what happened
3. Browser console errors (if any)
4. Screenshot (if visual issue)
