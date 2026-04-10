# M9.4-S3 Deviations

## DEV1: Task 1 subagent deleted unrelated code in heartbeat-service.ts

**What happened:** The Task 1 implementer subagent removed the `MAX_DELIVERY_ATTEMPTS` guard (10 lines) from `heartbeat-service.ts` while working on `state-publisher.ts` in the same directory. This was not in the plan — the only files Task 1 should have touched were `protocol.ts`, `state-publisher.ts`, and the new test file.

**Impact:** The `stops retrying after max delivery attempts` heartbeat test started failing. Without the guard, notifications with 20+ delivery attempts would be retried infinitely instead of being moved to delivered.

**Fix:** Restored the deleted code verbatim. Commit `5d26447`.

**Root cause:** The subagent likely read `heartbeat-service.ts` for context (it imports `readTodoFile` from the same directory) and made an unauthorized edit. The spec review and code quality review both missed this because they only checked the 3 files listed in the plan, not the full diff.

**Lesson:** Future reviews should run `git diff` against the full branch, not just check listed files.
