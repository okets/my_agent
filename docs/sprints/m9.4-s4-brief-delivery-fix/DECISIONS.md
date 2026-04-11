# Decisions — M9.4-S4 Brief Delivery Pipeline Fix

## D1: Sync + async resolver split

Decided to provide both `resolveJobSummary()` (sync) and `resolveJobSummaryAsync()` (async with Haiku fallback). The sync version is used in automation-executor.ts (3 sites) where the code path is sync. The async version is used in automation-processor.ts where `handleNotification` is already async.

**Why:** Haiku fallback requires an async model call. Rather than making all 4 call sites async, only the notification path (which benefits most from Haiku summarization of long raw streams) uses the async variant.

## D2: Frontmatter stripping in both resolver and assembler

Both `summary-resolver.ts` and the new debrief-reporter assembler strip YAML frontmatter. This is intentional duplication — the resolver handles per-job summaries stored in DB, while the assembler handles the debrief digest delivered to the user. Both need clean content without metadata headers.

## D3: 10,000-char async threshold + 2,000-char DB display limit

The async resolver (notification delivery) uses a 10,000-char threshold before triggering Haiku condense. The plan specified 4,000 but this was raised because Haiku condense preserves all information (unlike hard truncation). A higher threshold means fewer Haiku calls for moderately-sized deliverables while still catching unbounded raw streams.

The sync resolver (DB path) uses a separate 2,000-char display limit since its consumers are UI job cards and state broadcasts where unbounded content would bloat WebSocket payloads and break layouts.
