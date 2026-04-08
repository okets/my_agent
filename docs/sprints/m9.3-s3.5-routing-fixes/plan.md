# M9.3-S3.5: Routing & Session Fixes — Sprint Plan

**Goal:** Fix worker crashes in nested sessions, auto-resume safe ad-hoc jobs on restart, prevent WhatsApp notification bleed.

**Branch:** `sprint/m9.3-s3.5-routing-fixes`
**Source plan:** `docs/plans/2026-04-07-m9.3-delegation-compliance.md` (Tasks 7.1-7.5)

---

## Tasks

| # | Name | Files |
|---|------|-------|
| 7.1 | Fix resume_job force-complete event gap | `automation-server.ts` |
| 7.2 | Clear Claude Code env vars at startup | `index.ts` |
| 7.3 | Auto-resume safe interrupted jobs on restart | `app.ts`, new test file |
| 7.4 | Carry sourceChannel through notification queue | `persistent-queue.ts`, `automation-processor.ts`, `heartbeat-service.ts` |
| 7.5 | E2E crash recovery test | Live validation |

## Validation Strategy

1. Unit tests per task (TDD where plan specifies)
2. Full test suite after each commit
3. **Live validation after T7.2:** Restart dashboard, fire automation, verify worker completes (no ProcessTransport errors)
4. **Interruption test after T7.3:** Fire automation → restart mid-task → verify auto-resume → results delivered → no WhatsApp bleed
5. External reviewer

## Success Criteria

- [ ] Workers don't crash when dashboard runs alongside Claude Code
- [ ] Safe interrupted ad-hoc jobs auto-resume on restart
- [ ] Non-resumable jobs notify via correct channel (not WhatsApp when sourceChannel is dashboard)
- [ ] All unit tests pass, no regressions
