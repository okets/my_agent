# M8-S4.2: Visual Working Ninas — Decision Log

## D1: Deliverable fallback to work text

**Decision:** Changed `let finalDeliverable = deliverable` to `let finalDeliverable = deliverable ?? work` so deliverable.md is always written, even when the worker doesn't use `<deliverable>` tags.

**Why:** First E2E test failed — worker produced a full memory report but `extractDeliverable()` found no `<deliverable>` tags, so `deliverablePath` was null and the augmentation hook never ran. Workers rarely use structured deliverable tags; the full response is the deliverable.

## D2: Hook inside executor, not outside

**Decision:** Post-execution chart augmentation runs inside the executor, between `extractDeliverable()` and `updateJob()`. The chart is part of the deliverable before the job is marked complete.

**Why:** The deliverable should be final when the job completes. If the hook ran after completion, the job's `screenshotIds` wouldn't include the chart, and consumers reading `deliverablePath` might see the pre-chart version.

## D3: Both MCP servers wired to workers

**Decision:** Workers get both `chart-tools` and `image-fetch-tools`, not just charts.

**Why:** Research workers (e.g., Songkran research, Pattaya diving) fetch web images as part of their work. Giving them `fetch_image` lets them include relevant photos in deliverables.
