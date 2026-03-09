# M6.7-S6: E2E Validation + Semantic Search Verification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Validate the entire M6.7 milestone end-to-end. Run all accumulated E2E test scenarios (from S1-S5), verify semantic search works, and conduct human-in-the-loop testing.

**Prerequisites:** S1-S5 complete. All conversation architecture, search infrastructure, and Home widget in place.

**Recovery context:** [recovery/m6.7-conversations/](../../recovery/m6.7-conversations/) — This sprint combines the lost S5 (E2E validation) and S7 (semantic search verification). Semantic search was discovered to already exist — this sprint verifies it rather than implementing it.

**Tech Stack:** Playwright (browser testing), Vitest (unit tests), curl (API testing)

---

## ⚠️ Pitfalls

1. **Semantic search exists only if S4 was completed.** The recovery analysis says "already existed" but that was on the lost branch. After S4 reconstruction, `conv_vec` and `hybridSearch` should exist. Verify with `grep -r "hybridSearch\|conv_vec" packages/dashboard/src/` before running Task 2.
2. **Ollama must be reachable** for semantic search tests. Check: `curl http://${OLLAMA_HOST}/api/tags`
3. **WhatsApp may be in error state.** Channel switch tests (Scenarios 7-8) may need to be skipped or marked N/A if WhatsApp is not connected.
4. **Push after every commit.** Non-negotiable.
5. **Playwright is NOT installed.** It's not in `package.json` devDependencies. Either install `@playwright/test` + create `playwright.config.ts`, or redefine "E2E tests" as API-level Vitest integration tests. Decide before starting Task 1.
6. **Existing `conversations.test.ts` has overlap.** Backend tests in `tests/conversations.test.ts` already cover ConversationManager CRUD and FTS search. S6 scenarios 1-6 may partially duplicate these — check and extend rather than rewrite.

## ⚠️ Opus Review: Missing Test Scenarios

The following scenarios from recovery docs are NOT covered in the plan above — add them:

| # | Scenario | Source |
|---|----------|--------|
| 17 | Tab restore re-fetches transcript after page reload | Analysis Section 2 |
| 18 | Mobile popover reactivity (nested object reassignment) | Analysis Section 5 |
| 19 | Recent message appears in search within seconds | Transcript Part 2 |
| 20 | Long content truncation before embedding | Transcript Part 4 |
| 21 | Concurrent rapid messages don't cause indexing races | Transcript Part 4 |
| 22 | Orphaned DOM references cleaned up (no JS errors) | Analysis Section 3 |
| 23 | Empty dashboard (zero conversations) renders gracefully | Missing from all docs |

**Missing human scenarios:** current-conversation-not-in-widget verification, simplified chat header layout check, empty state walkthrough, tab restore after reload.

---

## Task 1: Automated E2E Tests

Implement the test scenarios accumulated in `docs/sprints/m6.7-s4-e2e-scenarios.md` plus new scenarios from S4-S5.

**Files:**
- Create: `packages/dashboard/tests/e2e/conversation-lifecycle.test.ts`
- Reference: `docs/sprints/m6.7-s4-e2e-scenarios.md` (8 existing scenarios)

### Existing Scenarios (from S1-S3)

| # | Scenario | Source |
|---|----------|--------|
| 1 | Session resume with fresh system prompt | S1 |
| 2 | Resume fallback on stale session | S1 |
| 3 | `/new` creates fresh conversation | S1 |
| 4 | System prompt contains expected layers | S1 |
| 5 | Only one current conversation at a time | S2 |
| 6 | Connect loads current conversation | S2 |
| 7 | Channel switch detection (Web→WhatsApp) | S2 |
| 8 | WhatsApp→Web is NOT a new conversation | S2 |

### New Scenarios (from S4-S5)

| # | Scenario | Source |
|---|----------|--------|
| 9 | Conversation search returns results | S4 |
| 10 | MCP conversation_search works in brain | S4 |
| 11 | Conversations widget shows only inactive with messages | S5 |
| 12 | Click widget row → read-only preview opens | S5 |
| 13 | Resume from preview → chat loads, preview closes | S5 |
| 14 | "New chat" → old conversation appears in widget | S5 |
| 15 | Empty conversation auto-deleted on leave | S5 |
| 16 | Widget search filters inline | S5 |

### Test Structure

```typescript
describe("M6.7 Conversation Lifecycle E2E", () => {
  // S1: Core Architecture
  describe("Session Management", () => {
    it("resumes session with fresh system prompt on second message", async () => {});
    it("falls back to fresh session when stale session ID fails", async () => {});
    it("/new creates fresh conversation with new SDK session", async () => {});
    it("system prompt contains identity, metadata, and session context", async () => {});
  });

  // S2: Conversation Lifecycle
  describe("Status Model", () => {
    it("only one conversation is current at a time", async () => {});
    it("connect loads current conversation automatically", async () => {});
    it("Web→WhatsApp triggers new conversation", async () => {});
    it("WhatsApp→Web continues same conversation", async () => {});
  });

  // S4: Search
  describe("Conversation Search", () => {
    it("keyword search returns matching conversations", async () => {});
    it("MCP conversation_search is available in brain session", async () => {});
  });

  // S5: Home Widget
  describe("Conversation Home Widget", () => {
    it("widget shows only inactive conversations with messages", async () => {});
    it("clicking row opens read-only preview", async () => {});
    it("resume from preview loads conversation in chat", async () => {});
    it("new chat makes old conversation appear in widget", async () => {});
    it("empty conversations are auto-deleted", async () => {});
    it("search filters widget list inline", async () => {});
  });
});
```

### Acceptance
- [ ] All scenarios implemented as automated tests
- [ ] Tests that require WhatsApp marked with skip condition
- [ ] Tests pass: `npx vitest run tests/e2e/conversation-lifecycle.test.ts`

### Commit
```bash
git add packages/dashboard/tests/e2e/conversation-lifecycle.test.ts docs/sprints/m6.7-s4-e2e-scenarios.md
git commit -m "test(m6.7-s6): add E2E tests for conversation lifecycle (16 scenarios)"
git push origin <branch>
```

---

## Task 2: Semantic Search Verification

Verify that hybrid search (FTS5 + vector) works for conversations. Do NOT implement — it should already exist.

**Files:**
- No code changes expected. If fixes needed, document and fix.

### Pre-Check

```bash
# Confirm hybrid search exists
grep -r "hybridSearch\|conv_vec\|searchVector" packages/dashboard/src/conversations/

# Confirm Ollama is reachable
curl -s http://${OLLAMA_HOST}/api/tags | head -5

# Confirm nomic-embed-text is loaded
curl -s http://${OLLAMA_HOST}/api/tags | grep nomic
```

### Test Cases

| Test | Method | Expected |
|------|--------|----------|
| Keyword search | `curl /api/conversations/search?q=coral+reef` | Exact match results |
| Semantic query | `curl /api/conversations/search?q=that+ocean+conversation` | Finds coral reef conversation despite no keyword overlap |
| Special characters | `curl /api/conversations/search?q='; DROP TABLE` | No crash, safe handling |
| Empty query | `curl /api/conversations/search?q=` | Proper error response |
| Latency | Time the API response | < 500ms (previous: ~55ms) |
| Ollama down | Stop Ollama, search | FTS5 results still work |

### Search Quality Assessment

Compare top-5 results for:
1. A keyword query that should match exactly
2. A semantic query with no keyword overlap
3. A mixed query (some keyword match + semantic relevance)

Document results in `test-report.md`.

### Acceptance
- [ ] Hybrid search returns results for both keyword and semantic queries
- [ ] Graceful degradation when Ollama is down
- [ ] Latency < 500ms
- [ ] No SQL injection vulnerabilities
- [ ] Results documented in test report

### Commit (if fixes needed)
```bash
git commit -m "fix(m6.7-s6): [description of any fixes]"
git push origin <branch>
```

---

## Task 3: Human-in-the-Loop Test Scenarios

Prepare test scenarios for the CTO to walk through manually.

**Files:**
- Create: `docs/sprints/m6.7-s6-e2e-validation/user-stories.md`

### Scenario A: Daily Conversation Flow

1. Open web dashboard
2. Verify current conversation loads in chat panel
3. Send a message → verify response streams correctly
4. Click "New chat" → verify:
   - New conversation starts in chat
   - Previous conversation appears in Home widget instantly
   - Previous conversation shows title, time, preview, message count
5. Send a message in new conversation → verify response
6. Click "View →" on previous conversation in widget → verify:
   - Desktop: left-panel tab opens with full transcript
   - "Resume conversation" button visible
7. Click "Resume conversation" → verify:
   - Tab closes
   - Chat loads the resumed conversation with all messages
   - Previous conversation appears in widget
8. Send `/new` → verify same behavior as step 4

### Scenario B: Search

1. Have 3+ conversations with different topics
2. Open search in widget (click 🔍)
3. Type a keyword that matches one conversation → verify result appears
4. Type a semantic query (e.g., "that conversation about the ocean") → verify relevant result
5. Clear search → verify normal list returns

### Scenario C: Mobile Flow

1. Open dashboard on mobile (or resize to < 768px)
2. Verify Home tab shows Conversations widget
3. Tap "View →" on a conversation → verify popover opens with transcript
4. Tap "Resume conversation" → verify:
   - Popover closes
   - Chat expands to half state
   - Conversation loads in chat
5. Tap "New chat" in mobile header → verify old conversation returns to widget

### Scenario D: Stale Session Resume

1. Send a message (captures SDK session)
2. Restart the server (`systemctl --user restart nina-dashboard`)
3. Send another message → verify response works (should recover transparently)

### Scenario E: Channel Badge Verification (if WhatsApp available)

1. Send message from web → no badge
2. Send message from WhatsApp → verify badge appears in web UI transcript

### Acceptance
- [ ] User stories written with step-by-step instructions
- [ ] All scenarios testable without developer assistance
- [ ] Edge cases covered (restart, empty states, search edge cases)

### Commit
```bash
git add docs/sprints/m6.7-s6-e2e-validation/user-stories.md
git commit -m "docs(m6.7-s6): add human-in-the-loop test scenarios"
git push origin <branch>
```

---

## Task 4: Sprint Review + Milestone Wrap-Up

### Sprint Artifacts

Create in `docs/sprints/m6.7-s6-e2e-validation/`:
- `review.md` — sprint review
- `test-report.md` — automated test results + semantic search assessment

### Milestone Documentation

Update `docs/ROADMAP.md`:
- Mark all S1-S6 as complete
- Update M6.7 deliverables list to include:
  - Conversations Home widget (browse, search, resume)
  - Read-only conversation preview (tab + popover)
  - Conversation search (FTS5 + hybrid with RRF)
  - MCP conversation tools (search + read)
  - Empty conversation auto-cleanup
  - Simplified chat header

### Acceptance
- [ ] All E2E tests pass
- [ ] Semantic search verified
- [ ] Human test scenarios prepared
- [ ] Sprint review written
- [ ] Roadmap updated
- [ ] M6.7 ready for CTO sign-off

### Commit
```bash
git add docs/
git commit -m "docs(m6.7-s6): sprint review + milestone documentation"
git push origin <branch>
```

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| QA Lead | Opus | Test design, search quality assessment |
| Test Dev | Sonnet | Automated test implementation |
| Reviewer | Opus | Coverage verification, test quality |

## Recovery Reference

- E2E scenarios: `docs/sprints/m6.7-s4-e2e-scenarios.md` (8 pre-existing)
- Transcript: `docs/recovery/m6.7-conversations/transcript-raw.md` (Part 8: Sprint Summary)
- Analysis: `docs/recovery/m6.7-conversations/analysis.md` (all sections)
- Semantic search findings: Analysis Section 3 (Technical Discoveries)
