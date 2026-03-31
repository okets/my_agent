# M8-S4: Rich I/O — Decision Log

## D1: DOMPurify — explicit img whitelist vs default

**Decision:** Added explicit `ADD_TAGS: ["img"]` and `ADD_ATTR: ["src", "alt", "width", "height"]` even though DOMPurify allows `<img>` by default.

**Why:** Explicit is safer — if DOMPurify ever changes defaults or we upgrade versions, image rendering won't silently break.

## D2: Image lightbox — delegated click vs per-image handler

**Decision:** Used a single delegated click handler on `document` that matches `.chat-md img`, rather than attaching handlers to each image element.

**Why:** Images are rendered dynamically via Alpine.js. Delegation works for all current and future images without re-binding.

## D3: Graceful 404 — CSS class vs onerror remove

**Decision:** Used `onerror="this.classList.add('img-broken')"` with CSS `.img-broken { display: none }` instead of removing the element.

**Why:** Preserves DOM structure, element can be restored if image becomes available again. CSS approach is simpler and reversible.

## D4: VAS cleanup — already implemented

**Decision:** Skipped Task 12 (VAS cleanup invocation) — discovered it was already implemented in S3.5 at `app.ts:1056-1066` (startup + daily setInterval).

**Why:** No duplicate work needed.

## D5: Job detail fetch — inline click handler

**Decision:** Fetch full deliverable on expand via inline `@click` handler rather than a separate Alpine method.

**Why:** The job list is rendered in an `x-data` scope inside `index.html` that doesn't have access to app.js methods. Inline fetch is simpler than refactoring the component boundary.

## D6: WhatsApp image helpers — in plugin, tests in dashboard

**Decision:** Export parsing helpers (`extractMarkdownImages`, `stripMarkdownImages`, `resolveImagePath`) from the WhatsApp plugin for testability, but tests live in `packages/dashboard/tests/unit/whatsapp/`.

**Why:** Dashboard test runner has vitest configured; plugin doesn't have its own test setup. The helpers are pure functions that don't depend on Baileys.
