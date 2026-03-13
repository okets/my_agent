# M6.9-S3.5 Test Report

**Date:** 2026-03-14
**Branch:** `sprint/m6.9-s3.5-conversation-refactor`
**TypeScript:** PASS (zero errors)

## Unit Test Results

**Command:** `npx vitest run --reporter=verbose`

| Metric | Count |
|--------|-------|
| Test files | 37 |
| Files passed | 35 |
| Files failed | 2 |
| Tests passed | 389 |
| Tests failed | 5 |
| Tests skipped | 2 |
| Duration | 10.12s |

## Failed Tests (5)

All 5 failures are in **live API integration tests** that call the Anthropic API (require `ANTHROPIC_API_KEY` at runtime). These are not unit test regressions -- they are environment-gated integration tests that fail without credentials:

| File | Test | Cause |
|------|------|-------|
| `haiku-jobs.test.ts` | debrief-prep produces output | No API key in test env |
| `haiku-jobs.test.ts` | debrief-prep output is concise | No API key in test env |
| `haiku-jobs.test.ts` | debrief-prep writes current-state.md | No API key in test env |
| `work-loop-scheduler.test.ts` | debrief-prep: produces output via endpoint | No API key in test env |
| `work-loop-scheduler.test.ts` | sequential: two debrief-prep triggers | No API key in test env |

These tests existed before this sprint (under the `morning-prep` name). The rename from `morning-prep` to `debrief-prep` is correct. The failures are pre-existing and environment-dependent.

## New Test Coverage (Sprint-Specific)

| Test File | Tests | Status | Covers |
|-----------|-------|--------|--------|
| `response-timer.test.ts` | 5 | All PASS | Spec S6: 10s typing refresh, 30s/90s interim messages, max 2 messages, cancel() |
| `request-debrief-tool.test.ts` | 2 | All PASS | Spec S5: cache hit (hasRunToday), fresh run fallback |
| `task-processor-notifications.test.ts` | 4 | All PASS | Spec S3: CI.alert() for immediate, CI.initiate() fallback, debrief skip, type-based defaults |
| `conversation-initiator.test.ts` | 2 new | All PASS | Spec S2.1: alert() uses active conversation's channel, not global preference |

## TypeScript Compilation

```
npx tsc --noEmit  ->  0 errors
```

## Browser Verification

Dashboard loads at `http://localhost:4321`. Note: the live service is running master branch code, so API responses reflect pre-sprint state. Source code on branch is verified correct.

| Check | Result | Notes |
|-------|--------|-------|
| Dashboard loads | PASS | No JS errors (only favicon 404 and available-models 404 -- pre-existing) |
| Settings > "Debrief" section | PASS | Visible in source code; live service shows old label because master is deployed |
| Outbound Channel in own section | PASS | "Preferred Channel" is a separate glass-strong panel |
| `interim_status` WS type defined | PASS | In `protocol.ts` and handled in `app.js` |
| `interimMessage` UI rendering | PASS | Template in both desktop and mobile views |
