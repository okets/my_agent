# M6.7-S5 Conversation Home Widget — Sprint Review

## Verdict: PASS

## Summary

Replaced the conversation dropdown and mobile switcher with a Conversations widget on the Home tab. Chat is now a single-conversation workspace. Past conversations are browsed from the widget, opened as read-only previews (desktop tab / mobile popover), and resumed with an explicit button. Empty conversations are auto-cleaned on the server. This is a recovery sprint — the first implementation was lost when the old server died with unpushed code.

---

## Plan Adherence

| Task | Plan | Actual | Status |
|------|------|--------|--------|
| T1: Remove dropdown + simplify header | Remove convDropdownOpen, convSwitcherOpen, mobile switcher. Simplify chat header. | Desktop dropdown removed (~130 lines), mobile switcher removed (HTML + JS + CSS), chat header simplified to avatar + title + rename + "New chat" | DONE |
| T2: Conversations widget on Home tab | Glass-strong widget between Notebook and Timeline, search, two-line rows | Widget with search (debounced, calls /api/conversations/search), filter `c.id !== currentConversationId && c.turnCount > 0`, "View →" on hover | DONE |
| T3: Read-only conversation preview | Desktop: left-panel tab. Mobile: popover. Resume button. | Tab with transcript + resume, popover with transcript + resume. Tab restore re-fetches. Loading state with x-show. | DONE |
| T4: Empty conversation cleanup | deleteIfEmpty() in chat-handler, startup cleanup | Async deleteIfEmpty() called in handleNewConversation + handleSwitchConversation, startup cleanup in index.ts | DONE |
| T5: Live updates + mobile polish | Verify reactive chain, clean mobile header | Reactive chain verified (WS → store → effect → widget), notebook 404 spam fixed, mobile header clean | DONE |
| T6: Verification | tsc, prettier, browser test, review | Full coverage audit (30/32 pass, 2 runtime-only skips covered by browser), browser-verified | DONE |
| Post-sprint: Polish | CTO-requested | Timestamps on preview turns, channel badges on non-web turns, gradient resume button per design language | DONE |

---

## Recovery Approach

This sprint reconstructed lost work from `sprint/m6.7-s6-s7` (unpushed branch on dead server). Recovery assets:

| Asset | Path | Used For |
|-------|------|----------|
| Raw transcript | `docs/recovery/m6.7-conversations/transcript-raw.md` | Code patterns, bug fixes |
| Analysis | `docs/recovery/m6.7-conversations/analysis.md` | Architecture decisions, pitfalls |
| Before-state | `docs/recovery/m6.7-conversations/file-reads-before-state.md` | Diffing against current master |
| Reactivity fixes | `docs/recovery/whatsapp-stability/dashboard-reactivity-fixes.md` | Proven Alpine patterns |

A dedicated **Recovery Expert** agent analyzed all docs and briefed the team before implementation began. This prevented repeating mistakes from the first attempt.

---

## Bugs Found and Fixed

### During Implementation (team review)

1. **Search API field mismatch** — `/api/conversations/search` returns `conversationId`/`conversationTitle`/`snippet` but widget template used `id`/`title`/`preview`. Fixed with `.map()` normalization in `searchConversations()`.

2. **Alpine x-show race on tab open** — Desktop tab content momentarily hidden because `activeTab` was set before `openTabs` push completed. Fixed with `$nextTick` wrapper.

3. **Notebook 404 spam** — Widget content loader fetched files without checking if they existed in the notebook tree. Fixed by fetching tree first, skipping non-existent files.

### During CTO-Directed Verification (tech lead)

4. **Alpine proxy reactivity in conversation preview** — `_fetchConversationTabData()` was called with the pre-proxy tab reference (before `openTab()` pushes it into the reactive `openTabs` array). In-place mutations on the original object didn't trigger Alpine's reactivity, leaving the preview stuck on "Loading..." with "0 messages". **Fix:** Look up the proxied tab from `this.openTabs` by ID after `openTab()` completes.

5. **Mobile conv-switcher not fully removed** — Initial T1 implementation removed the desktop dropdown but left the mobile conversation switcher HTML (7 refs in index.html), JS state/methods (9 refs in mobile.js), and dead CSS (40 lines in mobile.css). Caught during tech lead verification, fixed in follow-up commit.

### Bug #4 Root Cause Analysis

Alpine.js wraps objects in `Proxy` when they enter reactive state (e.g., pushed into a reactive array). The original object reference doesn't trigger reactivity — only mutations through the proxy do. The pattern:

```javascript
// WRONG: tab is the original, non-proxy reference
this.openTab(tab);
this._fetchConversationTabData(tab); // mutations here are invisible to Alpine

// RIGHT: look up the proxied version from the reactive array
this.openTab(tab);
this.$nextTick(() => {
  const proxyTab = this.openTabs.find(t => t.id === tabId);
  if (proxyTab) this._fetchConversationTabData(proxyTab);
});
```

This is now a known pattern for any Alpine tab system that fetches async data after opening.

---

## Team

| Role | Agent | Model | Contribution |
|------|-------|-------|-------------|
| Tech Lead | Opus | claude-opus-4-6 | Orchestration, proxy reactivity bug fix, browser verification, CTO polish |
| Recovery Expert | Opus | claude-opus-4-6 | Analyzed 4 recovery docs, briefed team on pitfalls and patterns |
| Frontend Dev | Sonnet | claude-sonnet-4-6 | T1, T2, T3, T5 implementation (HTML, CSS, Alpine.js) |
| Backend Dev | Sonnet | claude-sonnet-4-6 | T4 implementation, type check + test verification |
| Reviewer | Opus | claude-opus-4-6 | Per-task reviews, full coverage audit (32 criteria) |

---

## Coverage Audit (Reviewer)

Final tally: **30 PASS, 0 FAIL, 2 SKIP**

| Task | Pass | Fail | Skip |
|------|------|------|------|
| T1 (Remove dropdown) | 5/5 | 0 | 0 |
| T2 (Widget) | 9/9 | 0 | 0 |
| T3 (Preview) | 6/6 | 0 | 0 |
| T4 (Empty cleanup) | 3/3 | 0 | 0 |
| T5 (Live updates) | 4/5 | 0 | 1 |
| T6 (Code quality) | 3/4 | 0 | 1 |
| **Total** | **30/32** | **0** | **2** |

Skipped criteria (runtime-only: console errors, server restart) were verified via browser testing — all pass.

---

## Commits (15 total)

```
7ac22d6 style(dashboard): prettier format mobile.js
bd66aeb style(dashboard): timestamps, channel badges, and gradient resume button in conversation preview
bb86cd4 fix(dashboard): fetch proxied tab for Alpine reactivity + remove dead conv-switcher CSS
ce33f3a fix(dashboard): normalize search API response fields with .map() chain
4bfdc34 fix(dashboard): mobile popover wrapper.data ref + remove dead conv-switcher CSS
ab4d7f7 fix(dashboard): correct search result field names for conversation search API
4a9d067 fix(dashboard): use $nextTick to avoid x-show race on conversation tab open
e8f0434 fix(m6.7-s5): fix Alpine reactivity in conversation tab - mutate in place instead of replacing proxy
a0dce13 fix(m6.7-s5): improve conversation widget row layout alignment
df84c54 fix(m6.7-s5): fix notebook path encoding + tree parsing in widget content loader
b33f200 feat(m6.7-s5): fix notebook 404 spam + verify live update reactive chain
24b6466 feat(m6.7-s5): add read-only conversation preview (tab + popover)
f87c0c5 feat(m6.7-s5): add Conversations widget to Home tab
2997c1a feat(m6.7-s5): remove conversation tabs + simplify chat header
2411338 feat(m6.7-s5): auto-delete empty conversations (T4)
```

Branch: `sprint/m6.7-s5-conversation-home-widget` — merged to master at `430d448`.

---

## Files Changed

### Modified (packages/dashboard/)
- `public/index.html` — Removed dropdown + switcher HTML (~485 lines removed), added Conversations widget + preview templates (~741 lines added)
- `public/js/app.js` — Widget state, search, preview methods, tab fetch with proxy-safe pattern (+213 lines)
- `public/js/mobile.js` — Removed convSwitcherOpen state + methods (-35 lines)
- `public/css/mobile.css` — Removed dead .conv-switcher-* and .conversation-dropdown-mobile CSS (-42 lines)
- `src/ws/chat-handler.ts` — deleteIfEmpty() helper, called in new/switch handlers (+21 lines)
- `src/index.ts` — Startup cleanup for empty conversations (+12 lines)

---

## Deviations

| Deviation | Reason |
|-----------|--------|
| In-place mutation instead of object replacement in `_fetchConversationTabData` | Plan suggested `tab.data = { ...tab.data, turns, loading: false }` but this breaks Alpine proxy chain. In-place mutation (`tab.data.turns = turns`) preserves the proxy. |
| Proxy tab lookup added to `openConversationPreview` | Not in plan. Discovered during browser verification — original tab reference is pre-proxy. |
| Notebook 404 fix added to T5 | Not in plan. Discovered during live testing — widget content loader fetched non-existent files. |
| Timestamps, channel badges, gradient button | CTO-requested polish after initial completion. |

---

## Known Gaps

- **Channel conversations not in widget** — By design. WhatsApp/email conversations go to `channelConversations` (shown under channel settings), not the Home widget. The widget shows web conversations only.
- **Search quality untested with real data** — Only 3 conversations exist. Hybrid search (FTS5 + vector) works but quality assessment deferred to S6 E2E validation.

---

## Ready For

- **S6 (E2E Validation)** — All conversation architecture (S1-S5) is on master. Automated tests + human walkthrough can proceed.
- **Roadmap update** — M6.7-S5 should be marked complete.
