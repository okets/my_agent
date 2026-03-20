# M6.10-S3 Deviations

## DEV-1: chat-handler.ts is ~530 lines, not < 200

**Spec says:** chat-handler.ts < 200 lines
**Actual:** ~530 lines (down from 1399 — 62% reduction)

**Why:** The spec's 200-line target assumed auth/hatching flow coordination would move to ChatService. During implementation, auth/hatching was kept in the adapter because it's transport-specific — it sends WebSocket controls, compose hints, and auth messages that are protocol concepts. This is documented in the plan's Key Design Decisions.

**Breakdown of remaining adapter code:**
- Auth gate + hatching flow: ~90 lines (transport-specific, can't extract)
- Message routing switch: ~120 lines (thin delegation, but many message types)
- Chat message handling (/new, /model, streaming): ~80 lines
- Session wiring (getOrCreate, switchConversation): ~60 lines
- Notification forwarding: ~30 lines
- Socket lifecycle (close, ping, send): ~30 lines
- Imports + types: ~20 lines

**Impact:** None — all business logic is in ChatService. The adapter is structurally thin (delegation only, no business logic). The line count reflects the number of message types in the WS protocol, not complexity.

**Decision:** Accept. The spirit of the spec (thin adapter, no business logic) is met. The letter (< 200) requires moving auth/hatching or notification forwarding, which would be wrong architecturally.
