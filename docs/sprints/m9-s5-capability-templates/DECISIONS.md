# M9-S5 Decisions Log

## D1: Hardcoded test contracts instead of dynamic template parsing
**Severity:** Medium (implementation detail)
**Decision:** Test contracts are hardcoded in `test-harness.ts` per well-known type rather than dynamically parsed from template markdown.
**Reason:** Templates are framework-authored and change rarely. Parsing markdown test contracts at runtime adds complexity (regex extraction, error handling) for no practical benefit. The test functions and templates stay in sync because they're both maintained by the framework author.
**CTO input:** Not needed — implementation detail.

## D2: Non-blocking test-on-activation and startup
**Severity:** Medium (approach choice)
**Decision:** Capability tests run in background (fire-and-forget with `.then()`) on both startup and file-watcher rescan. UI sees `available` immediately, then updates to `healthy`/`degraded` within seconds.
**Reason:** Per plan task D3 — "Non-blocking — user sees record button instantly, gets degraded notification within seconds if key is bad." Blocking startup on test results would delay the entire app launch.

## D3: Single-agent execution (no team)
**Severity:** Minor
**Decision:** Ran as single Tech Lead agent instead of spawning a team.
**Reason:** Sprint is mostly markdown/prompt edits (A, B, C, E) with one sequential engineering phase (D). Spawning agents for file edits would add overhead without benefit.

## D4: `projectRoot` parameter kept but unused in test-harness
**Severity:** Minor
**Decision:** `testCapability()` accepts a `projectRoot` parameter even though current implementation doesn't use it (test contracts are hardcoded).
**Reason:** Future extension point — if we later want to dynamically read template contracts or load fixtures from the project, the API is ready without a breaking change.

## D5: Debug API for capability testing
**Severity:** Minor
**Decision:** Added 3 debug endpoints (`GET /capabilities`, `POST /capabilities/test/:type`, `POST /capabilities/test-all`) to the existing debug routes file.
**Reason:** Plan task D5 specified test-on-demand callable from debug API. Follows existing localhost-only pattern.
