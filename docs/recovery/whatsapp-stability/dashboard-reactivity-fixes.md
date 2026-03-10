# Dashboard Reactivity Fixes — Recovery Transcript

> **Source:** Conversation transcript recovered from mobile interface (2026-03-10)
> **Branch:** `sprint/m6.7-s6-s7` (lost branch — fixes need reconstruction)
> **Status:** Fixes were verified working but code was lost with the branch

---

## Problem

Desktop conversation preview tabs stuck at "Loading..." — fetch completes but UI never updates. Same class of bug as mobile popover blank screen.

### Root Cause

Alpine.js cannot detect deep property mutations on objects nested inside arrays. The code was doing:

```javascript
// In _fetchConversationTabData():
tab.data.turns = data.turns;    // deep mutation — Alpine can't detect
tab.data.loading = false;        // deep mutation — Alpine can't detect
```

`tab` is nested inside the `openTabs` array. Alpine tracks the array reference and top-level properties, but not `tab.data.turns` assignments.

---

## Three Fixes Applied

### Fix 1: Desktop Tab Reactivity (`_fetchConversationTabData`)

**Before:** Deep property mutation on tab inside openTabs array.

**After:** Reassign `tab.data` as a new object + trigger array reactivity:
```javascript
tab.data = { ...tab.data, turns: data.turns, loading: false };
this.openTabs = [...this.openTabs];  // triggers Alpine reactivity
```

### Fix 2: Mobile Popover Reactivity (`openConversationPreview`)

**Before:** Replacing entire `$store.mobile.popover` object.

**After:** Set `mobile.popover.data = newData` on the Alpine proxy directly (avoids replacing the store reference).

### Fix 3: Mobile Scroll + Delayed Scroll

**`scrollToBottom()`:** Check `offsetHeight > 0` to use the visible container (desktop vs mobile — only one is visible at a time).

**`conversation_loaded` handler:** Added 350ms delayed scroll for mobile CSS transition (chat sheet animates open, scroll needs to wait).

---

## Files Changed

| File | Change |
|------|--------|
| `packages/dashboard/public/js/app.js` | `_fetchConversationTabData()`: new object + array spread |
| `packages/dashboard/public/js/app.js` | `openConversationPreview()` mobile path: direct store proxy mutation |
| `packages/dashboard/public/js/app.js` | `scrollToBottom()`: check `offsetHeight > 0` for visible container |
| `packages/dashboard/public/js/app.js` | `conversation_loaded` handler: 350ms delayed scroll |
| `packages/dashboard/public/index.html` | Mobile popover template: `x-if` → `x-show`, removed getter `x-data`, uses `$store.mobile.popover.data` directly |

---

## Alpine Reactivity Patterns (Lessons Learned)

These patterns apply to ALL Alpine code in the dashboard:

1. **Never mutate nested properties on array items.** Always reassign the object: `item.data = { ...item.data, newProp }` then `array = [...array]`.
2. **Store proxies vs replacements.** When updating Alpine store data, mutate via the proxy (`store.data = newValue`) rather than replacing the store object.
3. **`x-show` over `x-if` for dynamic data.** `x-if` destroys/recreates DOM — if the data arrives after creation, the template may not re-evaluate. `x-show` keeps the DOM and toggles visibility.
4. **Scroll after CSS transitions.** Mobile animations need a delay before `scrollToBottom()` — the container has zero height during transition.
5. **Check `offsetHeight > 0`** to determine which container (desktop vs mobile) is actually visible before scrolling.

---

## Relevance to S5 Reconstruction

These exact patterns are documented in the S5 plan pitfalls section:
- Pitfall #3: Mobile popover reactivity (full-object reassignment)
- Pitfall #4: Tab restore needs re-fetch
- Opus Review Correction #6: Use landmarks, not line numbers

The fixes above are the **proven solutions** to these pitfalls. S5 reconstruction should follow these patterns exactly.
