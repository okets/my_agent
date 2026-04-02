# Deviations: M8-S5.1 Direct Desktop Tools

## Deviation: MCP server factory pattern

**Type:** Addition
**Planned:** Register desktop-action-server as a shared singleton like other MCP servers
**Actual:** Had to implement `addMcpServerFactory()` — a factory pattern that creates fresh MCP server instances per session. Working Nina failed with "Already connected to a transport" when the shared singleton was already bound to Conversation Nina's transport.
**Reason:** In-process SDK MCP servers (`createSdkMcpServer()`) can only bind to one transport at a time. Multiple concurrent sessions (brain + Working Nina) need separate instances.
**Impact:** Added `addMcpServerFactory()` and `buildMcpServersForSession()` to session-manager.ts. AutomationExecutor updated to use `buildMcpServersForSession()`. This is a systemic fix — all future in-process MCP servers that need concurrent access should use factories.
**Recommendation:** Keep — this is the correct pattern. Pre-existing bug exposed by desktop tools.
