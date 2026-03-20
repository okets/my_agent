# M6.10-S3 Decisions

## DEC-1: Auth/hatching stays in WS adapter (Minor)

Auth gate and hatching flow remain in `chat-handler.ts` rather than moving to `ChatService`. These are transport-specific — they send WS controls, compose hints, and auth protocol messages. Moving them would pollute the ChatService with transport concerns.

## DEC-2: ResponseTimer stays in adapter (Minor)

The `ResponseTimer` (sends "still thinking..." interim messages) is UX timing that belongs in the transport layer. The ChatService yields content events only. The adapter wraps the generator with its own timer.

## DEC-3: AsyncGenerator over EventEmitter for streaming (Medium)

`ChatService.sendMessage()` returns `AsyncGenerator<ChatEvent>` instead of emitting events on the App EventEmitter. Rationale: generators give natural per-connection isolation and backpressure. EventEmitter would require connection IDs for routing and has no backpressure. This matches the existing `SessionManager.streamMessage()` pattern.

## DEC-4: _effects on start event for side-effect metadata (Minor)

The `sendMessage` generator yields `{ type: "start", _effects: { conversationId, userTurn, conversationCreated } }` so the adapter can update per-connection state and broadcast without a separate return channel. This is a pragmatic coupling — the alternative (separate return value) would require consuming the generator differently.

## DEC-5: Accept ~530-line adapter vs 200-line target (Medium)

See DEVIATIONS.md. The 200-line target was based on auth/hatching moving to ChatService, which was architecturally incorrect. All business logic is extracted — the remaining code is protocol delegation.
