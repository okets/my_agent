# WhatsApp Intermittent Disconnects + Re-Authorization — Investigation Brief

> **Type:** Ad-hoc bug fix
> **Priority:** High — WhatsApp is unusable when it keeps disconnecting
> **Recovery context:** `docs/recovery/whatsapp-stability/transcript.md` (on master)

---

## Symptom

WhatsApp channel shows "disconnected" periodically, then reconnects but asks for owner authorization again (dedicated channel re-prompts trust for owner's phone number). This suggests the session credentials or identity state is being lost/corrupted on reconnect.

## Context

- A previous stability fix was already applied (commit `1e1a712`) based on recovered transcript
- That fix added: `makeCacheableSignalKeyStore`, `markOnlineOnConnect: false`, `syncFullHistory: false`, WebSocket error handler, and reconnect logic for transient errors (408/500/503)
- Phone number pairing was added after that fix (commits `2405534..dca0614`, merged in `6f8b734`)
- The current issue is NEW — not the same "408 timeout, never retries" bug from before

## Investigation Steps

1. Read the current WhatsApp plugin: `plugins/channel-whatsapp/src/plugin.ts`
2. Read the channel manager: `packages/dashboard/src/channels/manager.ts`
3. Read the auth module: `plugins/channel-whatsapp/src/auth.ts`
4. Read the recovery transcript: `git show master:docs/recovery/whatsapp-stability/transcript.md`
5. Check git diff of all WhatsApp changes since stability fix:
   ```bash
   git log --oneline -p 1e1a712..HEAD -- plugins/channel-whatsapp/ packages/dashboard/src/channels/ packages/core/src/channels/
   ```
6. Check if owner authorization state is persisted or only in-memory (channel config, agent.db)
7. Look for: credential corruption on reconnect, auth state reset, owner identity lost after socket recreation

## Key Questions

- When the socket reconnects, does it reload credentials correctly or start fresh?
- Is the "owner authorized" flag stored in the DB or only in runtime memory?
- Does the phone pairing flow (commits `2405534..dca0614`) interfere with credential persistence?
- Is the `CredentialSaveQueue` flushing properly before socket recreation?
- Does OpenClaw's `safeSaveCreds`/`maybeRestoreCredsFromBackup` pattern (not yet implemented) matter here?

## Key Files

| File | Purpose |
|------|---------|
| `plugins/channel-whatsapp/src/plugin.ts` | BaileysPlugin — connection lifecycle, reconnect logic |
| `plugins/channel-whatsapp/src/auth.ts` | CredentialSaveQueue — serialized credential writes |
| `packages/dashboard/src/channels/manager.ts` | ChannelManager — reconnection backoff, watchdog |
| `packages/core/src/channels/types.ts` | ChannelStatus, ChannelPlugin interface |

## Fix Criteria

- WhatsApp stays connected across transient disconnects without re-pairing
- Owner authorization persists across reconnects (no re-prompting)
- Push every commit immediately
