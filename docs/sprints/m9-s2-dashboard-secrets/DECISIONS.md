# M9-S2 Decisions Log

## D1: Capabilities Store Pattern
**Decision:** Use Alpine.store("capabilities") with a `has(type)` helper for UI gating, rather than passing capabilities through component props.
**Reason:** Matches existing pattern (spaces, automations use stores). Any component can reactively check capability presence.

## D2: Model Indicator Source
**Decision:** Show model from the current conversation's model field (already tracked), not a separate global model state.
**Reason:** Model varies per conversation. The existing `conversation_model_changed` message already broadcasts this.

## D3: Secrets API — Capability Association
**Decision:** Read CAPABILITY.md frontmatter at request time to build key-to-capability mapping, rather than caching.
**Reason:** Capabilities change rarely. Reading frontmatter on each GET /api/settings/secrets is fast enough and always fresh.

## D4: MCP Lifecycle Wrapper Deferred
**Decision:** MCP lifecycle wrapper (`start.sh`/`stop.sh`) deferred from S1 — no concrete use case yet.
**Reason:** All current capabilities use `interface: script`. MCP passthrough via `.mcp.json` is implemented.
