# Deviations Log — Sprint M2-S5: Naming

> **Sprint:** [plan](plan.md)
> **Started:** 2026-02-16

---

## Summary

| Type         | Count | Recommendation |
| ------------ | ----- | -------------- |
| Additions    | 2     | Accept         |
| Removals     | 0     | —              |
| Changes      | 2     | Accept         |
| Dependencies | 0     | —              |

**Overall Assessment:** Expanded scope (CTO-directed)

---

## Deviations

### Deviation 1: NamingService constructor changed from `(apiKey: string)` to `()`

**Type:** Change
**Severity:** Low

**Context:**
Plan specified `constructor(apiKey: string)`. Implementation uses `createBrainQuery` from `@my-agent/core` which handles auth internally (resolves from env vars). No API key parameter needed.

**Impact:**
Simpler API, consistent with how `createBrainQuery` works elsewhere.

**Recommendation:** Accept — cleaner design.

---

### Deviation 2: Naming format changed from haiku to human-readable titles

**Type:** Change
**Severity:** Medium

**Context:**
Plan specified 3-word haiku-style hyphenated names (e.g., `autumn-wind-drifts`). CTO directed switch to human-readable descriptive titles (e.g., "Server Monitoring Setup").

**Impact:**
Changed NamingService prompt, validation logic, and all documentation references. Topic tags remain kebab-case for search.

**Recommendation:** Accept — CTO directive, more practical for users.

---

### Deviation 3: Added periodic re-naming on idle (Task 5)

**Type:** Addition
**Severity:** Medium

**Context:**
Original plan had 4 tasks (NamingService, trigger, frontend, integration). CTO augmented sprint with Task 5: re-generate names on abbreviation cycle. Added `manuallyNamed` flag to protect user renames.

**Impact:**
New files/changes: `types.ts` (manuallyNamed field), `db.ts` (migration), `manager.ts` (setTitleManual), `abbreviation.ts` (NamingService integration), `chat-handler.ts` (onRenamed callback, switch triggers).

**Recommendation:** Accept — natural extension of naming system.

---

### Deviation 4: Added draggable sidebar

**Type:** Addition
**Severity:** Low

**Context:**
Longer descriptive titles caused truncation in the fixed-width sidebar. CTO requested a resizable sidebar with drag handle.

**Impact:**
Changes to `index.html` (drag handle element), `app.js` (drag state/method), `app.css` (drag handle styles). No backend changes.

**Recommendation:** Accept — UI improvement, purely additive.

---
