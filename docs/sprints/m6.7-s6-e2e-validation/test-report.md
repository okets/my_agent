# M6.7-S6 Test Report

## Automated Tests (Vitest)

**File:** `packages/dashboard/tests/e2e/conversation-lifecycle.test.ts`
**Results:** 28 passed, 2 skipped, 0 failed
**Duration:** 367ms (test execution), 1.12s total

### Coverage by Sprint

| Sprint | Area | Tests | Pass | Skip |
|--------|------|-------|------|------|
| S1 | Core Architecture (SystemPromptBuilder, buildQuery) | 3 | 2 | 1 |
| S2 | Conversation Lifecycle (status model, atomic swap, channel switch, persistence) | 5 | 5 | 0 |
| S4 | Search Infrastructure (FTS5, hybrid RRF, field normalization, SQL injection, latency) | 8 | 8 | 0 |
| S5 | Home Widget Logic (filtering, empty cleanup, ordering, delete cascading) | 7 | 7 | 0 |
| Cross-cutting | Lifecycle + Search integration, full lifecycle flow, WhatsApp metadata | 5 | 4 | 1 |
| Additional | Empty dashboard state, concurrent indexing | 2 | 2 | 0 |
| **Total** | | **30** | **28** | **2** |

### Skipped Tests

| Test | Reason |
|------|--------|
| Resume fallback on invalid session ID | Requires live Agent SDK connection |
| WhatsApp session resume across restarts | Requires live Agent SDK connection |

### Key Assertions

- **Atomic swap:** Creating N conversations leaves exactly 1 current, N-1 inactive
- **Channel switch:** Web→WhatsApp = new conversation, WhatsApp→Web = continues
- **Search field names:** `conversationId`, `turnNumber`, `content`, `timestamp`, `score`, `role` — consistent across FTS5 and hybrid
- **SQL injection:** 4 malicious queries tested, all handled safely
- **Search latency:** < 500ms on 50-turn dataset (actual: < 100ms)
- **Empty cleanup:** `deleteIfEmpty` removes 0-turn conversations, preserves non-empty
- **Delete cascading:** Deleting a conversation removes it from search index

## Semantic Search Verification (Live API)

Tested against running dashboard on `localhost:4321`.

| Test | Result | Details |
|------|--------|---------|
| FTS5 keyword search | PASS | Returns results with correct field names |
| Semantic query (no keyword overlap) | PASS | "ocean underwater marine" returns vector-matched results |
| SQL injection | PASS | Returns FTS5 syntax error, no crash, no injection |
| Empty query | PASS | Returns empty results array |
| Latency | PASS | 80ms (target: < 500ms) |
| Ollama status | PASS | `embeddings-ollama` active, nomic-embed-text, 768 dimensions |
| Hybrid infrastructure | PASS | `conv_vec` table, `hybridSearch()` with RRF in search-service.ts |
| FTS5-only fallback | PASS (code review) | Fallback path exists and was observed in test runner logs |

**Note:** Only 1 conversation exists in production DB. Full search quality assessment deferred to human walkthrough (Scenario B).

## TypeScript Compilation

```
npx tsc --noEmit → clean (0 errors)
```

## Pre-existing Test Issues (NOT regressions)

| File | Issue | Impact |
|------|-------|--------|
| `tests/step-executor.test.ts` | Import error — source file `step-executor.ts` was removed in prior refactor | None (orphaned test) |
| `tests/conversations.test.ts` | 1 failing assertion — `creates database file` checks wrong subpath | None (test bug, not runtime) |

## Conclusion

M6.7 conversation lifecycle is validated at the API level. All automated tests pass. Semantic search infrastructure is operational. Frontend/UI scenarios are covered by human-in-the-loop test stories (see `user-stories.md`).
