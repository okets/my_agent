# Deviations Log — Sprint M2-S5: Naming

> **Sprint:** [plan](plan.md)
> **Started:** 2026-02-16

---

## Summary

| Type | Count | Recommendation |
|------|-------|----------------|
| Additions | 0 | — |
| Removals | 0 | — |
| Changes | 1 | Accept |
| Dependencies | 0 | — |

**Overall Assessment:** On track

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
