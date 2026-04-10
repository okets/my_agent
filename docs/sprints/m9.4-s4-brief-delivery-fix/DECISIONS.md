# Decisions — M9.4-S4 Brief Delivery Pipeline Fix

## D1: Sync + async resolver split

Decided to provide both `resolveJobSummary()` (sync) and `resolveJobSummaryAsync()` (async with Haiku fallback). The sync version is used in automation-executor.ts (3 sites) where the code path is sync. The async version is used in automation-processor.ts where `handleNotification` is already async.

**Why:** Haiku fallback requires an async model call. Rather than making all 4 call sites async, only the notification path (which benefits most from Haiku summarization of long raw streams) uses the async variant.

## D2: Frontmatter stripping in both resolver and assembler

Both `summary-resolver.ts` and the new debrief-reporter assembler strip YAML frontmatter. This is intentional duplication — the resolver handles per-job summaries stored in DB, while the assembler handles the debrief digest delivered to the user. Both need clean content without metadata headers.

## D3: 4000-char truncation limit (up from 500)

The plan specified 4000 chars. This is 8x the old limit. The rationale: deliverables are typically 500-2000 chars, so 4000 provides headroom without allowing unbounded content. The Haiku fallback handles cases where raw stream output exceeds 4000 chars.
