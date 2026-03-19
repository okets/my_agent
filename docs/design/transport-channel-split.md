# Transport / Channel Split — Design Specification

> **Status:** Draft
> **Date:** 2026-03-19
> **Scope:** Refactor channel system into transport (infrastructure) and channel (binding) layers
> **Depends on:** M3-S5 Connection Stability (complete)
> **Updates:** `docs/design/channels.md` (supersedes channel architecture sections)

---

## Problem

The current system has a single abstraction called "Channel" that handles two distinct responsibilities: connection infrastructure (pairing, reconnection, credentials, send/receive) and conversation routing (owner verification, brain integration). This conflation causes:

1. Messages from unverified senders can reach Conversation Nina if `ownerIdentities` persists from a previous pairing.
2. Authorization tokens are stored in-memory and lost on service restart.
3. There is no clean boundary between "WhatsApp is connected" and "the owner can talk to Nina through WhatsApp."
4. The architecture doesn't accommodate future message flows (Working Ninas handling non-owner messages) without bolting routing logic onto the wrong layer.

---

## Conceptual Model

**Transport** is infrastructure. It connects to an external service, manages credentials, handles reconnection, and sends/receives messages. A transport can be running and healthy without any consumer attached.

**Channel** is a binding between a transport and a consumer. It is created by authorization — a deliberate act that says "messages from this identity on this transport should reach Conversation Nina." Without a channel binding, messages arrive at the transport but go nowhere.

**Authorization** is the gate that creates a channel. For dedicated transports (agent's own number), this is a token-based flow. For personal transports (owner's number), authorization is implicit — the owner provided credentials.

The web dashboard is a special case. Login is authorization. It is always a channel. The web dashboard has no entry in the `channels:` config — it is an implicit/virtual channel. The routing layer treats web-originated messages as owner messages without a channel lookup. This is enforced in code, not config.

```
Transport (infrastructure)
  |
  |-- connect / disconnect / send / receive
  |-- credentials + reconnection
  |-- message ingress (all messages land here)
        |
        |-- Authorization Gate
        |     Token check (dedicated transports only)
        |     Match -> create Channel binding
        |
        |-- Channel (owner binding -> Conversation Nina)
        |     owner message -> brain -> response
        |
        |-- Unbound messages (everyone else)
              stored, not processed
              future: Working Nina routing
```

---

## Key Rules

**No channel = no brain. Ever.** Messages on a transport without a channel binding are infrastructure-level data. They exist, they are received, but they do not trigger Conversation Nina. This is a policy enforced at the routing layer, not just a convention.

**One owner per dedicated transport.** A dedicated transport has exactly one owner channel. The `ownerIdentities` field is a single normalized identity (not an array). Authorization replaces the previous owner, it does not add to a list.

**Token authorization applies only to dedicated transports.** Personal transports (agent watches the owner's account) have implicit authorization through the credentials the owner provides. No token flow needed.

**The web dashboard bypasses the transport/channel model.** Dashboard login is the authorization. This means web conversations are always active. If the user chats on web and then tries to continue on WhatsApp before WhatsApp is authorized, WhatsApp will not respond — this is expected and correct.

---

## Authorization Flow

### First-time authorization

1. Transport is paired and connected (WhatsApp QR/phone pairing complete).
2. Dashboard shows "Authorize Owner" button on the transport.
3. User clicks the button.
4. Server generates a 6-character alphanumeric token using `crypto.randomInt()` (CSPRNG, not `Math.random()`). Charset: A-Z minus I/O, 2-9 — avoids ambiguous characters.
5. Token hash and expiry (20 minutes) are written to an ephemeral auth state file at `.my_agent/auth/{transportId}/.pending-auth.json` with `0600` permissions. The plaintext token is never written to config.yaml.
6. A failed-attempt counter is initialized at 0.
7. Dashboard displays the plaintext token to the user.
8. User sends the token via WhatsApp.
9. Authorization gate (in the binding layer, between transport and channel) receives the message, hashes it, compares against the stored hash.
10. On match: channel entry is created in config.yaml with `ownerIdentity` and `ownerJid`. The pending auth file is deleted. A confirmation message is sent via WhatsApp. Dashboard updates.
11. On mismatch: failed-attempt counter increments. After 5 failures, the token is invalidated and the pending auth file is deleted. Dashboard shows the Authorize button again.

### Re-authorization (owner number change)

1. User clicks "Re-authorize" on the dashboard.
2. The existing channel enters a "pending re-auth" state. The old `ownerIdentity` is preserved in a `previousOwner` field on the channel config.
3. During re-auth, the channel is suspended. Messages from the previous owner are silently dropped (not routed to brain, not queued). A WhatsApp message is sent to the previous owner: "I'm in re-authorization mode. Messages won't be processed until verification completes." Holding messages across restarts adds complexity for a rare flow — dropping with a clear warning is simpler and honest.
4. A new token is generated (same flow as first-time, steps 4-7).
5. When the new owner verifies, the channel entry is updated with the new identity. The `previousOwner` field is cleared.
6. If re-auth is not completed within 20 minutes, the token expires. The channel reverts to its previous state — `previousOwner` becomes `ownerIdentity` again, the channel is unsuspended. The user can try again.

### Token expiry and cleanup

Tokens expire after 20 minutes. Cleanup happens in two places:

**Scheduled cleanup:** When a token is generated, a timer is set for 20 minutes. On expiry, the pending auth file is deleted. If re-authorizing, the channel reverts to its previous owner.

**Startup cleanup:** On service start, check all transports for pending auth files. If `pendingAuthExpiry` is in the past, delete the file. If still valid, schedule cleanup for the remaining time. This handles crashes and restarts.

---

## Token Security

**Generation:** Tokens are generated using `crypto.randomInt()` (Node.js CSPRNG), not `Math.random()`. This ensures tokens are cryptographically unpredictable.

**Storage:** Tokens are hashed (SHA-256) before storage. The plaintext token is returned to the dashboard API response and exists only in the browser session memory until displayed. The hash lives in an ephemeral file with 0600 permissions, separate from config.yaml. The plaintext is never persisted to disk.

**Brute force protection:** A failed-attempt counter is stored alongside the hash. After 5 failed attempts, the token is invalidated. With 32^6 (~1 billion) possible tokens and a 5-attempt limit, brute force is not viable.

**Scope:** The token is transport-scoped. A token generated for one transport cannot authorize a different transport.

**Disk exposure:** The ephemeral auth file contains only the hash, expiry, and attempt counter. Even if read, the hash cannot be reversed to the plaintext token. The file is deleted immediately on successful authorization or expiry.

---

## Config Structure

### config.yaml

```yaml
transports:
  ninas_dedicated_whatsapp:
    plugin: baileys
    role: dedicated
    identity: "+1480..."
    authDir: auth/ninas_dedicated_whatsapp
    reconnect:
      initialMs: 2000
      maxMs: 30000
      factor: 1.8
      jitter: 0.25
      maxAttempts: 50
    debounceMs: 0

channels:
  ninas_whatsapp:
    transport: ninas_dedicated_whatsapp
    ownerIdentity: "41433650172129"
    ownerJid: "41433650172129@lid"
```

### Ephemeral auth state (separate file)

`.my_agent/auth/{transportId}/.pending-auth.json` (0600 permissions):

```json
{
  "tokenHash": "sha256:...",
  "expiresAt": "2026-03-19T10:20:00Z",
  "failedAttempts": 0
}
```

This file exists only while authorization is pending. It is deleted on success, expiry, or max failed attempts.

---

## Message Routing

When a message arrives on a transport:

**Step 1: Authorization gate.** The pending auth state is loaded into memory on startup (or when a token is generated) and cached. The binding layer checks the in-memory cache, not the file system, on every message. The file is the persistence layer for restart resilience, not the hot path. If a pending auth exists: hash the incoming message content, compare against the cached hash. If match and not expired and under attempt limit: create channel, delete auth file, clear cache. If mismatch: increment counter (in memory and file), check limit. If no pending auth: continue.

**Step 2: Channel lookup.** Find the channel bound to this transport. If a channel exists and the sender matches `ownerIdentity`: route to Conversation Nina. If a channel exists but the sender does not match: unbound message. If no channel exists: unbound message.

**Step 3: Unbound messages.** Stored in the existing `ExternalMessageStore` (SQLite-backed). Not processed by the brain. No retention policy defined yet — future Working Nina work will define this.

The authorization gate sits in the binding layer (between transport and channel), not in the transport layer. The transport emits all messages blindly. The binding layer decides what to do with them.

---

## Config Write Safety

The current `saveChannelToConfig()` uses synchronous `readFileSync`/`writeFileSync`, which is safe in single-threaded Node.js for synchronous callers but not for concurrent async operations. The refactor introduces a serialized write queue: all config.yaml mutations go through a single async queue that ensures read-modify-write operations are sequential. This is a new mechanism — it does not exist in the current code.

This applies to all config.yaml writes, not just authorization — reconnect policy changes, channel additions, and any future config mutations.

---

## Migration

Existing deployments have a `channels:` section in config.yaml with the old format. On startup, the config loader detects the old format (presence of `plugin` field inside a `channels:` entry — new-format channels don't have `plugin`, they have `transport`).

Migration is automatic:

1. Old `channels:` entries are moved to `transports:`.
2. Entries with `ownerIdentities` get a corresponding new-format `channels:` entry.
3. The `ownerIdentities` array is collapsed to a single `ownerIdentity` string (first element). If the array has multiple entries, a warning is logged — the current code only ever sets a single-element array, so multiple entries would indicate manual config editing. The snake_case alias `owner_identity` is also supported for consistency with the existing `owner_identities` alias pattern.
4. Old fields removed from transport config: `ownerIdentities`, `ownerJid`.
5. A backup of the original config.yaml is written before migration.

Migration runs once. After migration, the old format is not supported.

---

## Refactor Phases

### Phase 1: Rename existing layer to Transport

Rename types, files, and code:

- `ChannelPlugin` becomes `TransportPlugin`
- `ChannelManager` becomes `TransportManager`
- `ChannelInstanceConfig` becomes `TransportConfig`
- `ChannelStatus` becomes `TransportStatus`
- `ChannelInfo` becomes `TransportInfo`

Config.yaml: `channels:` section becomes `transports:` (with auto-migration).

### Phase 2: Extract Channel as a binding layer

New types: `ChannelBinding` (transport reference + owner identity). New config section: `channels:`. Message handler simplified: reads channel bindings for routing, no longer manages tokens.

### Phase 3: Authorization flow

Token generation writes ephemeral auth file. Authorization gate reads it. Successful verification creates channel binding in config.yaml. Cleanup timers handle expiry. Dashboard UI updated for transport vs channel distinction.

---

## Scope Boundaries

### What changes

- Core types renamed (transport terminology)
- Config parser reads two sections
- Message handler simplified (routing only)
- Authorization logic moved to binding layer with persistence
- Dashboard UI: transport settings vs channel settings
- API routes split: transport routes and channel routes

### What does not change

- Baileys integration (connect, disconnect, QR pairing, credentials)
- Reconnection logic and backoff
- Credential save queue and backup
- Conversation system and brain/session manager
- Web dashboard chat functionality

---

## Addressed Review Findings

| Finding | Resolution |
|---------|-----------|
| C1: Token on disk unencrypted | Token hashed (SHA-256) before storage. Stored in ephemeral file with 0600 permissions, not config.yaml. |
| C2: Brute force | 5-attempt limit. Token invalidated after 5 failures. |
| C3: Config write races | New serialized write queue for all config.yaml mutations. Explicitly noted as new mechanism. |
| H2: Re-auth message loss | Messages dropped (not held) during re-auth with clear WhatsApp warning. Reverts on expiry. Holding adds complexity for a rare flow. |
| H3: Personal transport auth | Token flow is dedicated-only. Personal transports have implicit authorization. Stated explicitly. |
| H4: Web cross-channel | Documented as expected behavior. Web is always active; external transports require authorization. |
| M1: Migration | Auto-migration on startup with backup. Warning logged for multi-entry ownerIdentities arrays. |
| M3: Token check location | Authorization gate sits in binding layer, not transport layer. Transport emits all messages blindly. |
| M4: Single vs multi-owner | Explicitly single-owner. `ownerIdentity` is a string, not an array. |

### Spec review findings (second pass)

| Finding | Resolution |
|---------|-----------|
| Insecure RNG | Token generation uses `crypto.randomInt()` (CSPRNG). Specified in authorization flow and security section. |
| Re-auth held messages unspecified | Changed to drop with warning instead of hold. Simpler, no persistence concern. |
| Auth gate file I/O on every message | Pending auth state cached in memory. File is persistence layer only, not hot path. |
| Config write queue is new | Explicitly stated as a new mechanism to implement, not a description of existing code. |
| Migration multi-entry data loss | Warning logged for multi-entry arrays. First element used. Only single-element arrays exist in practice. |
| Unbound message store vague | Explicitly references existing `ExternalMessageStore` (SQLite-backed). |
| Web dashboard no config entry | Documented as implicit/virtual channel. No config entry needed. Enforced in code. |
| Token expiry value change (10 to 20 min) | Intentional change. 20 minutes gives more time for the user to switch to their phone and type the code. |
