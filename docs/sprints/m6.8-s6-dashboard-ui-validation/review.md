# M6.8-S6 Dashboard UI + Validation — External Review

**Reviewer:** External (Claude Opus 4.6)
**Date:** 2026-03-18
**Branch:** `sprint/m6.8-s6-dashboard-ui-validation`
**Commits reviewed:** 7 (0ba3590..708f39b)

---

## 1. Spec Coverage

| Requirement | Status | Evidence |
|------------|--------|----------|
| Browse all skills (system + user) | PASS | `GET /api/skills` returns all skills with name, description, origin, disabled fields. UI: Skills tab in notebook widget (desktop + mobile), Skills section in notebook browser. |
| View skill content (rendered md) | PASS | `GET /api/skills/:name` returns full content + body. UI: skill detail view renders markdown via `renderMarkdown()`. Mobile: popover with rendered markdown. |
| User skills: edit | PASS | `PUT /api/skills/:name` route exists. UI: Edit button (user only) opens edit mode with description input + markdown textarea + Save/Cancel. |
| User skills: delete | PASS | `DELETE /api/skills/:name` route exists. UI: Delete button (user only) with confirm dialog. |
| User skills: toggle on/off | PASS | `POST /api/skills/:name/toggle` sets `disable-model-invocation` frontmatter. UI: Enable/Disable button (user only). |
| System skills: view only | PASS | Toggle/delete/update return 403 for system and curated origins. UI: no Edit/Toggle/Delete buttons shown for non-user skills. |
| Global toggle via disable-model-invocation | PASS | `SkillService.toggle()` adds/removes `disable-model-invocation: true` in YAML frontmatter. Verified in unit tests. |
| Search skills | N/A (deferred) | Explicitly deferred in plan. Skills live in `.claude/skills/`, not `notebook/`. Search integration requires extending search service scope. Documented as out-of-scope. |

---

## 2. Test Results

### Dashboard (`packages/dashboard`)
- **57 test files, 548 passed, 2 skipped, 0 failures**
- New test files:
  - `tests/services/skill-service.test.ts` — 15 tests (list, get, toggle, delete, update, isEditable)
  - `tests/routes/skills-routes.test.ts` — 9 tests (all REST endpoints + protection + validation)
  - `tests/e2e/skills-ui.test.ts` — 7 tests (live API shape, origin coverage, protection rules)

### Core (`packages/core`)
- **15 test files, 171 passed, 7 skipped, 0 failures**
- No regressions introduced.

---

## 3. API Verification (Live Dashboard at 127.0.0.1:4321)

| Endpoint | Expected | Actual | Status |
|----------|----------|--------|--------|
| `GET /api/skills` | 200, array of skills | 200, 12 skills returned with correct shape | PASS |
| `GET /api/skills/brainstorming` | 200, full content | 200, includes name, description, origin, content, body | PASS |
| `GET /api/skills/nonexistent` | 404 | 404 | PASS |
| `POST /api/skills/auth/toggle` | 403 (system) | 403, `"Cannot toggle \"auth\" — it is a system skill"` | PASS |
| `POST /api/skills/brainstorming/toggle` | 403 (curated) | 403 | PASS |
| `DELETE /api/skills/identity` | 403 (system) | 403 | PASS |
| `PUT /api/skills/identity` | 403 (system) | **400** (see Bug #1 below) | FAIL |

---

## 4. Gaps Found

### Bug #1: PUT on skill named "identity" returns 400 instead of 403 (non-blocking)

**File:** `packages/dashboard/src/routes/skills.ts`, lines 57-58

The PUT route's error handler checks `msg.includes("identity")` to detect identity-override content validation errors (e.g., "Your name is Bob"). However, the protected-origin error message for the skill named "identity" is `Cannot update "identity" — it is a system skill`, which also contains the substring "identity". This causes it to match the 400 branch instead of falling through to the 403 branch.

**Fix:** Check for the identity-override pattern more specifically (e.g., `msg.includes("identity-override")` or check for `"Cannot update"` prefix first to route to 403).

**Severity:** Non-blocking. The operation is still rejected. Only the HTTP status code is wrong (400 vs 403). No security impact.

### Observation: MCP handlers not refactored to use SkillService

The plan mentions refactoring MCP handlers in `skill-server.ts` to use SkillService. The `handleListSkills` function was updated to optionally use SkillService (with fallback), and the `SkillServerDeps` interface now accepts an optional `skillService`. However, `handleCreateSkill`, `handleGetSkill`, `handleUpdateSkill`, and `handleDeleteSkill` still use direct file I/O.

**Severity:** Non-blocking. The plan's Task 3 ("Refactor MCP list handler") specifically scoped only the list handler for refactoring, with a comment that full refactoring is left for a future sprint. The REST routes use SkillService correctly. This is a known incremental approach.

### No user skills in live environment for positive-path E2E

The E2E tests skip positive-path toggle/delete tests when no user skills exist. This is handled correctly (the unit and route tests cover these paths with fixture data), but a fully end-to-end test with a real user skill would increase confidence.

**Severity:** Non-blocking. Unit and route tests provide coverage.

---

## 5. Architecture Assessment

- **SkillService** is well-structured: clean separation of concerns, proper frontmatter parsing with YAML library, origin-based protection using shared `PROTECTED_ORIGINS` constant from `skill-validation.ts`.
- **Fastify integration** follows existing patterns: decorator for `skillService`, prefixed route registration, proper error code mapping.
- **UI implementation** covers both desktop (notebook widget tab + notebook browser section + detail view) and mobile (popover-based detail view + skills section in mobile notebook browser). Follows the Tokyo Night design language.
- **Test coverage** is thorough: service unit tests, route integration tests (using Fastify inject), and live E2E tests.

---

## 6. Verdict

**PASS** (with one non-blocking bug noted)

All spec requirements are implemented and verified. The one bug (incorrect HTTP status code for PUT on the "identity" skill) is cosmetic and does not affect security or functionality. Tests pass across both packages with no regressions. The implementation is clean, well-tested, and follows existing codebase patterns.

**Recommended follow-up:**
1. Fix the `msg.includes("identity")` check in `skills.ts` PUT route to avoid false match on skill name.
2. Consider full MCP handler refactoring to SkillService in a future sprint.
3. Add search integration when search service scope is extended.
