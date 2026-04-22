---
sprint: M9.6-S24
title: Follow-ups
date: 2026-04-22
---

# S24 Follow-ups

## FOLLOW-UP-1 — Brief format: add recovery context to System Health entries (cosmetic, low priority)

External reviewer (GAP-3) noted that the spec's illustrative example showed HH:MM timestamps, remediation hints, and flat bullets — the implementation uses ISO timestamps and sub-headers. The acceptance gate only requires listing what self-healed and what surrendered, so the current format is compliant. If CTO wants richer formatting (e.g., "2 min recovery time", "last error: ..."), that's a UX enhancement for a future sprint.

**Target:** Post-M9.6, if requested.

## FOLLOW-UP-2 — `reverifyAudioToText` for system-origin: could use smoke.sh instead of "trust rescan" (optional hardening)

The current fix trusts `waitForAvailability()` after rescan. A stricter alternative would be to actually run the capability's `smoke.sh` as the reverification for system-origin probes. This would catch cases where the fix agent made a superficially correct change that still fails at runtime. Current approach is sound for the daily probe use case (testAll ran smoke.sh to determine health), but a deeper reverify could catch edge cases.

**Target:** M10 if system-origin surrenders unexpectedly in production.
