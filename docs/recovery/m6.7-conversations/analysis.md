# M6.7 Recovery Analysis — Consolidated

Two independent analysts reviewed the recovered transcripts against the roadmap and design docs.
This consolidation merges their findings, resolves overlaps, and prioritizes actionable items.

---

## 1. Design Corrections (User Overrides)

### 1a. Home Widget, Not Tab Bar (MAJOR)
The agent built browser-style conversation tabs above the chat panel. The user corrected: past conversations belong on the **Home tab as a widget** (like Timeline), not as tabs in the chat area. The chat dropdown should be replaced with a single "New chat" button.

**Root cause:** The implementation plan (Task 8) explicitly said "Tab bar above chat panel" — the plan itself had the wrong interpretation. The design spec's use of "tab" was ambiguous (left-panel tab vs chat-panel tab bar).

### 1b. Read-Only Preview Before Resume
Clicking a conversation should open a **read-only preview** (tab on desktop, popover on mobile), not immediately resume it. Only an explicit "Resume conversation" button makes it active.

### 1c. Current Conversation Filtered from Widget
Only inactive conversations appear in the widget. The current conversation lives in the chat panel — showing it in both places is redundant.

### 1d. Live Updates Are a Requirement, Not a Task
The user corrected: live widget updates are an inherent requirement of the widget, not a separate task to be tracked.

---

## 2. Discovered Requirements (Not in Any Plan)

| Discovery | Impact | Files Changed |
|-----------|--------|---------------|
| Empty conversations should not be saved | Widget filter + startup cleanup + auto-delete on leave | `index.html`, `chat-handler.ts`, `index.ts` |
| Tab restore must re-fetch transcript data | New `_fetchConversationTabData()` method | `app.js` |
| Mobile popover reactivity: must reassign whole object | Alpine won't detect nested property mutations | `app.js` |
| Sprint reorder: UI before search (avoids rework) | Changed sprint execution order | Process |

---

## 3. Technical Discoveries

| Finding | Detail |
|---------|--------|
| Semantic search already existed | `conv_vec`, `hybridSearch()` with RRF, Ollama embeddings — all in codebase |
| Alpine store sync pattern | `ws-client.js` → `Alpine.store("conversations")` → `Alpine.effect` → component `conversations` property |
| `currentTitle` is a getter | Cannot be assigned directly; derives from `currentConversationId` + `conversations` |
| RRF vs weighted linear | Actual implementation uses Reciprocal Rank Fusion, not the `alpha * keyword + (1-alpha) * semantic` from the S7 plan |
| Search latency: ~55ms | 9x better than the 500ms target |
| Widget insertion point | Between Notebook end (line 598) and Timeline start (line 601) |
| Orphaned dropdown menu | Lines 3580-3801 were unused DOM — removed in S6 |

---

## 4. UX Decisions Made During Sprint

- "View →" not "Resume →" on widget rows
- Desktop: read-only tab with transcript + "Resume conversation" button
- Mobile: popover with transcript + "Resume conversation" button
- Mobile resume auto-expands chat to half state
- Simplified chat header: `[Avatar] [Title] [Rename] [+ New chat]`
- Widget search is inline (same table, debounced 300ms)
- Glass-strong panel styling, following Tokyo Night design language
- Two-line rows: title + time, preview + count

---

## 5. Bugs Found During Implementation

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Tab restore shows loading forever | No re-fetch on localStorage restore | `_fetchConversationTabData()` called for restored tabs |
| Mobile popover doesn't update | Alpine doesn't detect nested mutations | Reassign entire `mobile.popover` object |
| Empty conversations in widget | `handleNewConversation` creates DB record immediately | `turnCount > 0` filter + `deleteIfEmpty()` helper |

---

## 6. What's Missing from the Roadmap

### Sprint Progress (STALE)
Roadmap says: `S1 complete, S2 complete, S3-S4 pending`
Reality: S1-S3 on master, S4-S7 completed on lost branches

### Sprint Count Expanded
Roadmap lists S1-S5. Actual execution: S1-S7. S6 (Conversation Home Widget) and S7 (Semantic Search) are not in the roadmap.

### M6.7 Deliverables Incomplete
The "What this delivers" section doesn't mention:
- Conversations Home widget
- Read-only conversation preview (tab/popover)
- Conversation search (FTS5 + hybrid with RRF)
- Empty conversation auto-cleanup
- Simplified chat header

### Semantic Search Missing from M6.7 Scope
User explicitly said it should be in this milestone. Roadmap has no mention of it as an M6.7 deliverable.

### Task 8 in Implementation Plan is Wrong
The plan says "Tab bar above chat panel" — this was the wrong interpretation and was corrected in S6. The plan should be annotated or replaced.

### Memory File Stale
`MEMORY.md` says branch is `recovery-sprint-auth-gate`. Actual current branch is `feat/whatsapp-phone-pairing`.

---

## 7. Risk Patterns (All Three Materialized)

### Unpushed branches → lost work
Two branches with 5 commits of work were never pushed. Machine loss = total loss.
**Mitigation:** `git push` after every commit in overnight sprints. Not optional, not deferred.

### Spec ambiguity on UI → wrong implementation
"Tabs" meant different things to user and agent. The implementation plan codified the wrong interpretation.
**Mitigation:** UI tasks need wireframes, explicit pattern references, and stated anti-patterns.

### Codebase unawareness → duplicate planning
S7 was planned as 6 tasks of new development. The code already existed.
**Mitigation:** Mandatory codebase scan before sprint planning.

---

## 8. Reconstruction Priorities

| Priority | What | Effort | Notes |
|----------|------|--------|-------|
| **1** | Verify master state | Low | Check what S3 delivered. The gap may be smaller than expected. |
| **2** | Rebuild S6 (Home Widget) | Medium | Transcript has detailed plan + UI audit. Line numbers reference lost branch state — needs fresh exploration. |
| **3** | Skip S4-S5 | None | S6 replaced S4's UI. Search infra may already be on master. |
| **4** | S7 verification | Low | Just test hybrid search works, document results. |

### Hardest to reconstruct
The S6 code changes (479 insertions, 711 deletions). The sprint plan and corrections are well-documented, but actual code was not captured. A fresh implementation using the recovered intent + before-state is the path forward.

---

## 9. Process Recommendations

### For overnight sprints
1. **Push after every commit.** Add `git push origin <branch>` to the commit step in every task.
2. **Pre-implementation design checkpoint for UI.** ASCII wireframe + named pattern + anti-patterns before coding.
3. **Codebase scan before planning.** Search for existing implementations before scoping tasks.
4. **Decision logging during sprint.** Update DECISIONS.md in real-time, not reconstructed after.

### For specs and plans
5. **Explicit anti-patterns.** "NOT a tab bar above chat. NOT a dropdown menu."
6. **Reference existing patterns by name.** "Follows Timeline widget pattern" not "homepage list."
7. **Include wireframes for UI tasks.** Even ASCII mockups prevent misinterpretation.

### For recovery
8. **Annotate Task 8** in the implementation plan as superseded by S6 corrections.
9. **Update roadmap** with S1-S7 sprint count and actual deliverables.
10. **Fix MEMORY.md** stale branch reference.
