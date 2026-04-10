# M9.4-S3 Decisions

## D1: Playwright tests use WS injection, not debug API

**Context:** Plan assumed debug API endpoints for job creation (`/debug/jobs`, `/debug/state/refresh`) that don't exist.

**Decision:** Rewrite browser tests to inject `state:jobs` WebSocket messages via `page.evaluate()`, simulating the server pushing job state updates. This tests the Alpine component behavior (card rendering, toggle, dismiss, fade) without requiring new API endpoints.

**Pros:** No scope creep (no new debug endpoints), tests the actual frontend code path (store update → card render), faster tests.

**Cons:** Doesn't test the full server→WS→client pipeline (but that's covered by integration tests in Task 1).
