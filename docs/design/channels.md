# Channels — Design Specification

> **Status:** Design Complete
> **Date:** 2026-02-14
> **Scope:** Channel architecture for multi-account, multi-role communication
> **Milestones:** M3 (WhatsApp), M6 (Email), future channels

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Channel vs Account](#channel-vs-account)
3. [Channel Roles](#channel-roles)
4. [Channel Instances](#channel-instances)
5. [Processing Models](#processing-models)
6. [Conversation Ownership](#conversation-ownership)
7. [Conversation Continuity](#conversation-continuity)
8. [Configuration](#configuration)
9. [Autonomous Communication Policies](#autonomous-communication-policies)
10. [Plugin Interface](#plugin-interface)
11. [Implementation Notes](#implementation-notes)

---

## Core Concepts

### What Is a Channel?

A channel is a **communication interface** with send/receive capability via API. It enables two-way message exchange between the agent and external parties.

| Requirement     | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| **Receive**     | API to receive incoming messages (webhook, polling, WebSocket) |
| **Send**        | API to send outgoing messages                                  |
| **Identity**    | An addressable identity (phone number, email address, etc.)    |
| **Persistence** | Authentication/session that survives restarts                  |

**Examples of channels:**

- WhatsApp (via Baileys) — send/receive messages to phone numbers
- Email (via Microsoft Graph) — send/receive emails to addresses
- Telegram (via Bot API) — send/receive messages to users
- Web dashboard — send/receive via WebSocket

**NOT channels:**

- LinkedIn profile (no messaging API access)
- GitHub account (no direct messaging, only PR/issue comments)
- Twitter/X profile without API access

An account alone is not a channel. A channel requires a communication API.

---

## Channel vs Account

| Concept              | Definition                                | Example                                   |
| -------------------- | ----------------------------------------- | ----------------------------------------- |
| **Account**          | A user identity on a platform             | user@gmail.com, @username                 |
| **Plugin**           | Technical connector to a platform's API   | `baileys`, `microsoft365`, `telegram-bot` |
| **Channel Instance** | A specific account connected via a plugin | Agent's WhatsApp via Baileys              |
| **Channel**          | Shorthand for "channel instance"          | `baileys_nina_main`                       |

The relationship:

```
Plugin (how to connect)
  └── Channel Instance (specific account + role)
        └── Conversations (per external party)
```

---

## Channel Roles

Every channel instance has a **role** that determines how the agent interacts with it.

### Dedicated Role

The agent **is** the identity. It owns conversations, responds immediately, and is an active participant.

| Property        | Value                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- |
| **Identity**    | Agent's own account                                                                         |
| **Ownership**   | Agent owns conversations                                                                    |
| **Processing**  | Immediate (message arrives → agent responds)                                                |
| **Permissions** | Full (read, respond, initiate)                                                              |
| **Escalation**  | Policy-driven (see [Autonomous Communication Policies](#autonomous-communication-policies)) |

**Use cases:**

- info@company.com — agent handles support emails
- Agent's WhatsApp number — customers/contacts message it directly
- Support bot — agent is the bot identity

### Personal Role

The agent **watches** the user's account. It assists but does not own conversations.

| Property        | Value                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| **Identity**    | User's account (user's email, user's WhatsApp)                                     |
| **Ownership**   | User owns conversations                                                            |
| **Processing**  | On-demand (user asks agent to check)                                               |
| **Permissions** | Limited (read, summarize, draft, flag) — NO autonomous respond                     |
| **Escalation**  | N/A (agent doesn't respond autonomously)                                           |

**Permission definitions:**
- `read` — Access message content
- `summarize` — Generate summaries of conversations
- `draft` — Compose response drafts that require user approval before sending (see [Approval Flow](#approval-flow-personal-channels))
- `flag` — Mark messages for user attention

**Use cases:**

- Monitor inbox for urgent items
- Summarize unread messages
- Draft replies for user approval
- Flag messages matching criteria

---

## Channel Instances

### Naming Convention

Channel instances use a clear naming scheme:

```
{plugin}_{owner}_{name}

Examples:
  baileys_agent_main          # Agent's primary WhatsApp
  baileys_user_personal       # User's WhatsApp (agent watches)
  microsoft365_agent_info     # info@company.com (agent's)
  microsoft365_user_work      # user@company.com (agent watches)
  microsoft365_user_personal  # user@gmail.com (agent watches)
  telegram_agent_support      # Support bot
```

- `plugin`: Technical connector (`baileys`, `microsoft365`, `telegram`)
- `owner`: Who the account belongs to (`agent`, `user`)
- `name`: User-defined identifier for clarity

The actual identity (phone number, email address) is stored in config, not in the channel ID.

### Multiple Instances

The same plugin can power multiple instances:

```yaml
# Two WhatsApp accounts, same plugin
baileys_agent_main:
  plugin: baileys
  role: dedicated
  identity: "+1555000001"

baileys_user_personal:
  plugin: baileys
  role: personal
  owner: user
  identity: "+1555000000"
```

---

## Processing Models

How and when the agent processes messages from a channel.

| Mode          | Trigger                       | When to Use                           |
| ------------- | ----------------------------- | ------------------------------------- |
| **immediate** | Message arrives → process now | Dedicated channels (agent's accounts) |
| **on_demand** | User explicitly asks agent    | Personal channels (user's accounts)   |

### Immediate Processing (Dedicated)

```
Message arrives on baileys_agent_main
  → Agent receives notification
  → Agent processes with conversation context
  → Agent responds (or chooses no-reply)
  → Response sent via same channel
```

The agent is always listening on dedicated channels. It responds like an employee would.

### On-Demand Processing (Personal)

```
User: "Check my inbox for anything urgent"
  → Agent reads microsoft365_user_work
  → Agent summarizes/flags/drafts
  → Agent reports back to user
```

Personal channels default to **pure on-demand**: no listener, no polling. The agent only looks when explicitly asked. This is the privacy-first default.

### Monitoring Gate (Personal Channels)

Personal channels support **selective monitoring** — a per-conversation opt-in that enables real-time message flow for specific conversations while keeping others fully private.

**How it works:**

- **Unmonitored (default):** No listener attached. Messages never reach the agent. Pure privacy.
- **Monitored:** Channel plugin listens for messages from this conversation only. Messages flow to agent.

Enabling monitoring for a conversation **changes the processing model** for that specific conversation from `on_demand` to event-driven. The channel-level default remains `on_demand`.

**Storage:** `.my_agent/channels/{id}/monitoring.json`

```json
{
  "default": false,
  "conversations": {
    "+1555123456": { "monitored": true },
    "group-abc123": { "monitored": true, "reason": "Watch for pricing" }
  }
}
```

**Privacy guarantee:** Unmonitored conversations on personal channels are never sent to the cloud. The filtering happens at the plugin level, before any data leaves the device.

**Toggle mechanisms:**

1. Dashboard UI: Settings → Channels → Monitoring
2. Natural language: "Start monitoring my sales group"
3. API: `POST /api/channels/{id}/monitoring`

### Approval Flow (Personal Channels)

When the agent drafts a response on a personal channel, it requires user approval:

1. Agent drafts response
2. Draft appears in conversation view (read-only history + editable draft)
3. User edits text and clicks Send, or rejects

**Note:** The `external-communications.md` file governs **dedicated channels** (how the agent handles messages from third parties on the agent's own accounts). Personal channel responses always require approval — there is no auto-respond bypass for personal channels, as the agent should never send messages as the user without explicit approval.

### Scheduled Tasks (Future — M4a)

For recurring work on personal channels:

```
Task: "Every morning at 8am, summarize my inbox"
  → Scheduler triggers task
  → Agent reads microsoft365_user_work
  → Agent generates summary
  → Agent delivers to user (web dashboard, WhatsApp, etc.)
```

This is a **task**, not a channel processing model. Tasks are covered in a separate design doc.

---

## Conversation Ownership

Who "owns" a conversation depends on the channel role.

### Dedicated Channel Ownership

```typescript
interface Conversation {
  owner: "agent"; // Agent owns it
  channel: "baileys_agent_main";
  externalParty: "+1555123456"; // Who the agent is talking to
  // ...
}
```

The agent maintains context, remembers history, responds as itself.

### Personal Channel Ownership

```typescript
interface Conversation {
  owner: "user"; // User owns it
  channel: "microsoft365_user_work";
  externalParty: "sarah@company.com"; // Who user is talking to
  // ...
}
```

The conversation is between the user and their contact. The agent is an assistant with read access.

---

## Conversations vs External Communications

Every message arriving on a dedicated channel is routed based on **who sent it**, not just which channel it came from.

### Identity-Based Routing

```
Incoming message on dedicated channel
  │
  ├─ FROM owner identity → CONVERSATION (user ↔ agent)
  │   ├─ Route to existing conversation flow
  │   ├─ Read-only in dashboard (source of truth = channel medium)
  │   ├─ Full trust, same as web chat
  │   └─ Brain processes immediately
  │
  └─ FROM anyone else → EXTERNAL COMMUNICATION
      ├─ Rule lookup (check external-communications.md)
      ├─ Separate UI area (NOT in conversation sidebar)
      ├─ Default: notify user, no response
      └─ Apply rule if exists (auto-respond, draft, or block)
```

### Definitions

| Concept                    | Definition                                                                        | Example                                  |
| -------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| **Conversation**           | Exchange between the user (owner) and the agent. User-facing. Appears in sidebar. | Hanan messages Nina's WhatsApp, web chat |
| **External Communication** | Exchange between the agent and a third party. Trust-tiered. Separate UI.          | Customer messages Nina's WhatsApp        |

### Owner Identity Configuration

Each dedicated channel can specify which identities belong to the owner. Messages from these identities are routed as conversations, not external communications.

```yaml
channels:
  baileys_agent_main:
    plugin: baileys
    role: dedicated
    identity: "+1555000001"
    processing: immediate
    owner_identities: # Messages from these = Conversation
      - "+1555000000" # Owner's phone number
```

If `owner_identities` is not configured, ALL messages on dedicated channels are treated as external communications (safe default).

### Cross-Channel Conversations

Conversations are **per-channel** — a WhatsApp conversation and a web conversation are separate items in the sidebar. However, the agent can cross-reference across channels ("I see what you sent me on WhatsApp earlier").

### External Communication Data Model

External communications use a separate data model from conversations:

```typescript
interface ExternalCommunication {
  id: string; // ext-{ulid}
  channelId: string; // Which channel
  externalParty: string; // Phone/email of the external party
  displayName: string | null; // senderName from message
  hasRule: boolean; // Whether a rule exists for this contact
  created: Date;
  updated: Date;
  messageCount: number;
  status: "pending" | "responded" | "blocked" | "ignored";
}
```

**Status values:**
- `pending` — New message, no action taken yet
- `responded` — Agent or user has replied
- `blocked` — Contact is blocked, future messages silently dropped
- `ignored` — Marked as seen, no response sent

External communications are displayed in a dedicated UI area (not the conversation sidebar). Full implementation is in M3-S4.

---

## Conversation Continuity

How conversations are scoped per channel type.

| Channel Type     | Conversation =                 | Participants                 |
| ---------------- | ------------------------------ | ---------------------------- |
| WhatsApp (1:1)   | Per contact phone number       | Fixed (two parties)          |
| WhatsApp (group) | Per group JID                  | Dynamic (members join/leave) |
| Email            | Per thread (References header) | Dynamic (recipients change)  |
| Telegram (1:1)   | Per user ID                    | Fixed                        |
| Telegram (group) | Per chat ID                    | Dynamic                      |
| Web              | Per explicit session           | Single user                  |

### Email Threading

Email threads can have changing participants:

1. Sarah emails the user
2. User replies
3. Sarah adds Bob to the thread
4. Bob replies

This is **one conversation** (same thread ID). The `participants` field updates as people join:

```jsonl
{"type":"meta","id":"conv-...","channel":"microsoft365_user_work","participants":["sarah@co.com"]}
// ... turns ...
{"type":"event","event":"participant_added","participant":"bob@co.com","timestamp":"..."}
// ... more turns with bob ...
```

---

## Configuration

Channel instances are configured in `.my_agent/config.yaml`:

```yaml
channels:
  # Agent's dedicated WhatsApp
  baileys_agent_main:
    plugin: baileys
    role: dedicated
    identity: "+1555000001"
    authDir: ./auth/agent-whatsapp
    processing: immediate
    escalation: default # policy name

  # User's WhatsApp (agent watches)
  baileys_user_personal:
    plugin: baileys
    role: personal
    owner: user
    identity: "+1555000000"
    authDir: ./auth/user-whatsapp
    processing: on_demand
    permissions:
      - read
      - summarize
      - draft
      - flag

  # Agent's support email
  microsoft365_agent_info:
    plugin: microsoft365
    role: dedicated
    identity: info@company.com
    clientId: "${MS365_CLIENT_ID}"
    tenantId: "${MS365_TENANT_ID}"
    processing: immediate
    escalation: default

  # User's work email (agent watches)
  microsoft365_user_work:
    plugin: microsoft365
    role: personal
    owner: user
    identity: user@company.com
    clientId: "${MS365_CLIENT_ID}"
    tenantId: "${MS365_TENANT_ID}"
    processing: on_demand
    permissions:
      - read
      - categorize
      - summarize
      - draft
      - flag
```

### Configuration Fields

| Field              | Required        | Description                                                  |
| ------------------ | --------------- | ------------------------------------------------------------ |
| `plugin`           | Yes             | Which connector to use                                       |
| `role`             | Yes             | `dedicated` or `personal`                                    |
| `identity`         | Yes             | The account address (phone, email)                           |
| `owner`            | If personal     | Who owns the account                                         |
| `owner_identities` | If dedicated    | Phone/email identities that route to conversation flow       |
| `processing`       | Yes             | `immediate` or `on_demand`                                   |
| `escalation`       | If dedicated    | Policy name for autonomous responses                         |
| `permissions`      | If personal     | What the agent can do                                        |
| `authDir`          | Plugin-specific | Where to store auth tokens                                   |
| `clientId`, etc.   | Plugin-specific | API credentials                                              |

---

## External Communications Ruleset

External communications (non-owner messages on dedicated channels) are governed by a **ruleset** rather than rigid tiers. The user defines per-contact rules through natural language conversation with the agent.

### Default Behavior

**All non-owner messages: Notify user. Do not respond.**

No automatic acknowledgment. The user must explicitly add rules for contacts.

### Ruleset Model

Instead of fixed tiers, the agent uses flexible per-contact rules:

| Rule Type        | Example                                 | Behavior                    |
| ---------------- | --------------------------------------- | --------------------------- |
| **Auto-respond** | "Always answer Sarah warmly"            | Agent responds autonomously |
| **Draft**        | "Draft replies to Bob for approval"     | Agent drafts, user approves |
| **Block**        | "Never answer mother-in-law"            | Silent drop                 |
| **Custom**       | "When CEO emails, escalate immediately" | Per-contact logic           |

### Rule Storage

**Global defaults:** `.my_agent/external-communications.md`
**Per-channel overrides:** `.my_agent/channels/{id}/external-communications.md`

Example file:

```markdown
# External Communications Rules

## Default

Notify owner. Do not respond without explicit rule.

## Contacts

### Sarah Chen (+1555123456)

Respond warmly. She's a friend. Auto-respond allowed.

### Bob from Acme (+1555999888)

Important client. Draft for approval before responding.

### Mother-in-law (+1555000999)

Never respond. Ignore completely.
```

### Rule Evolution

Rules are managed through conversation with the agent:

> **User:** "Always answer my wife on WhatsApp"
> **Agent:** "Got it. I'll respond freely to messages from [wife's number]. Added to your rules."

The agent appends to `external-communications.md` with the new rule.

### Owner Identity

The **owner** (user) is identified via token-based verification during channel setup. Owner messages bypass the ruleset entirely and route to the main conversation flow.

### Relationship to Autonomy Modes

Rulesets and autonomy modes are **orthogonal**:

- **Ruleset** governs external communications (checked at message arrival)
- **Autonomy modes** govern task actions (checked during task execution)

They don't cascade. A message without a rule triggers notification before any task is created.

### Escalation

When escalating untrusted contacts:

```
Agent → User (via WhatsApp/dashboard):
"New message from +1555999888:
'Hi, I'm Bob from Acme Corp. Can you send me the pricing doc?'

Options:
1. Add to known contacts + respond
2. Respond once (don't add)
3. Ignore
4. Block"
```

User's response updates trust and may trigger a reply.

---

## Autonomous Communication Policies

**Scope:** Dedicated channels only. These policies govern how the agent responds when acting autonomously.

**Location:** `.my_agent/brain/autonomous_communication_policies.md`

### Policy Structure

```markdown
# Autonomous Communication Policies

## Default Policy

- Always be professional and helpful
- Never share confidential information
- Sign off with name and role

## Escalation Rules

### Always Escalate

- Sender domain: veryimportantcompany.com
- Keywords: "urgent", "deadline", "legal", "contract"
- Sentiment: angry/frustrated

### Never Respond

- Known spam senders
- Unrecognized numbers (after 2 failed verifications)

### Auto-Respond

- Out-of-office when calendar shows OOO
- "I'll get back to you" for after-hours messages

## Refinements

- 2026-02-14: "Never answer anyone from VeryImportantCompany without running it by me"
- ...
```

### How Policies Work

1. Message arrives on dedicated channel
2. Agent loads conversation context
3. Agent checks escalation rules:
   - Match "always escalate"? → Escalate to user, don't respond
   - Match "never respond"? → Ignore silently
   - Match "auto-respond"? → Send template response
   - Otherwise → Agent responds normally
4. Agent composes response (if not escalated)
5. Response sent

### Refinement

Policies evolve through conversation:

> **User:** "Never answer anyone from VeryImportantCompany without running it by me"
>
> **Agent:** "Got it. I've added that to my escalation rules. Any message from @veryimportantcompany.com will come to you first."

The agent appends to `autonomous_communication_policies.md` with timestamp.

---

## Plugin Interface

A channel plugin provides:

### Required Components

```typescript
interface ChannelPlugin {
  /** Unique plugin identifier */
  name: string; // "baileys", "microsoft365", "telegram"

  /** Initialize the plugin with config */
  init(config: ChannelConfig): Promise<void>;

  /** Start listening for messages */
  connect(): Promise<void>;

  /** Stop listening */
  disconnect(): Promise<void>;

  /** Send a message */
  send(to: string, message: OutgoingMessage): Promise<void>;

  /** Event emitter for incoming messages */
  on(event: "message", handler: (msg: IncomingMessage) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
}

interface IncomingMessage {
  from: string; // Sender identity
  content: string; // Message text
  timestamp: Date;
  channel: string; // Channel instance ID
  threadId?: string; // For email threading
  attachments?: Attachment[];
}

interface OutgoingMessage {
  content: string;
  replyTo?: string; // Message ID to reply to
  attachments?: Attachment[];
}
```

### First-Party Plugins

| Plugin         | Platform | Library         | Auth            |
| -------------- | -------- | --------------- | --------------- |
| `baileys`      | WhatsApp | Baileys         | QR code linking |
| `microsoft365` | Email    | Microsoft Graph | OAuth 2.0       |
| `telegram`     | Telegram | Bot API         | Bot token       |

### Plugin Location

```
plugins/
├── channel-whatsapp/      # baileys plugin
│   ├── src/
│   ├── package.json
│   └── README.md
├── channel-email-ms365/   # microsoft365 plugin
└── channel-telegram/      # telegram plugin (future)
```

---

## Implementation Notes

### Milestones

| Milestone | Channels         | Focus                                  |
| --------- | ---------------- | -------------------------------------- |
| M2        | Web only         | Dashboard chat (current)               |
| M3        | + WhatsApp       | First external channel, dedicated role |
| M6        | + Email          | Second channel, personal role          |
| Future    | + Telegram, etc. | Additional channels as needed          |

### Web as a Channel

The web dashboard is technically a channel:

```yaml
# Implicit, not in config
web_default:
  plugin: web
  role: dedicated # Agent responds immediately
  identity: dashboard
  processing: immediate
```

But it's special:

- Always available (comes with the framework)
- Primary interface for viewing all channels
- Where user interacts with the agent directly

### Channel Discovery

On startup:

1. Load `config.yaml`
2. For each channel instance:
   - Load plugin
   - Initialize with config
   - Connect (if dedicated + immediate)
3. Register message handlers

For personal channels with `on_demand` processing, connection happens when user requests it.

### Error Handling

| Scenario                | Behavior                                      |
| ----------------------- | --------------------------------------------- |
| Plugin fails to connect | Log error, retry with backoff                 |
| Message send fails      | Queue for retry, notify user after 3 failures |
| Auth expires            | Attempt refresh, escalate to user if fails    |
| Plugin crashes          | Restart plugin, preserve message queue        |

### Privacy

- All channel auth lives in `.my_agent/` (gitignored)
- Personal channel data is highly sensitive — user's actual messages
- Dedicated channel data is the agent's — still private but less sensitive
- Transcripts store full message content (for context)

---

## Resolved Questions

1. **Multi-recipient email** — When in doubt about CC/BCC handling, the agent asks the user. Each user has different policies for email recipients.

2. **Group ownership** — For WhatsApp groups on dedicated channels, the agent owns the conversation if it responds as itself. The ownership follows who is actively communicating.

3. **Cross-channel conversations** — No. A conversation is bound to a single channel. Conversations do not span channels (e.g., cannot start on email and continue on WhatsApp). This is already defined in `docs/design/conversation-system.md`.

---

_Design specification created: 2026-02-14_
