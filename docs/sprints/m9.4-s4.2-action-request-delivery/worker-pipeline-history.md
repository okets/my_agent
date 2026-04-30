---
title: Worker Pipeline — Historical Timeline
date: 2026-04-27
author: research subagent (M9.4-S4.2 Phase 2)
purpose: Inform CTO redesign decision on automation-executor.ts:605-621 overwrite bug
scope: Public repo + commit history only; no `.my_agent/` content
---

# Worker Pipeline — Historical Timeline

## The bug

`packages/dashboard/src/automations/automation-executor.ts:605-621` overwrites the
worker's on-disk `deliverable.md` with the model's full response stream **unless
the existing file starts with `---` (YAML frontmatter)**. Modern workers (generic
and research templates) write plain markdown via the Write tool — no frontmatter.
The frontmatter check therefore always fails, and the executor clobbers the
worker's clean output with `extractDeliverable(response).work` — i.e. the full
stream including pre-tool-call narration like `"I'll start by checking the todo
list…"`. This is the contamination factor (b) in
[`soak-day-2.md`](soak-day-2.md) and the framework-level bug recorded in
[`docs/bugs/2026-04-29-validator-enforcement-gap.md`](../../bugs/2026-04-29-validator-enforcement-gap.md).

## Timeline

| Date / commit | Event | Sprint/Milestone | Why it matters |
|---|---|---|---|
| 2026-02-22 / `7191d9e` | `<deliverable>...</deliverable>` XML tag contract introduced. `extractDeliverable()` and `validateDeliverable()` born inside `task-executor.ts`. Workers were instructed via XML template; everything outside the tags was treated as "work log" | **M5-S9** "Work + Deliverable architecture for clean task delivery" | Original contract: model emits one response, executor parses tagged region as deliverable, untagged remainder as work log. No file writes — content lived in memory. |
| 2026-03-23 / `2d7ab43` | Old task system deleted; `extractDeliverable` moved into `packages/dashboard/src/automations/deliverable-utils.ts` (new file) | post-M7 cleanup | The XML-tag contract migrated wholesale into the automation pipeline. No semantic change; just relocation. |
| 2026-03-31 / `1e1827e` | First on-disk write: `deliverable.md` written to `run_dir`. Original code: `if (deliverable && job.run_dir) { fs.writeFileSync(deliverablePath, deliverable, ...) }`. Wrote ONLY when `<deliverable>` tags were present | **m7 "full deliverable pipeline"** | Disk became authoritative. But the write path was conditional on the XML-tag contract still being honored by workers. |
| 2026-04-01 / `f4f5d83` | "fix(executor): write deliverable.md even without `<deliverable>` tags" — change: `let finalDeliverable = deliverable ?? work;`. Now writes `work` (full stream) as fallback | (no sprint label; opportunistic fix) | **First drift point.** Workers had stopped wrapping in tags reliably; rather than fix the contract, the executor learned to swallow the full stream as a "deliverable." This is the line that today contaminates morning briefs. |
| 2026-04-05 / `5976b12` | Todo template + validator system introduced (`todo-templates.ts`, `todo-validators.ts`). Initial templates: `capability_build`, `capability_modify`. Initial validators: `capability_frontmatter`, `completion_report`, `test_executed`, `change_type_set` — all four expect frontmatter | **M9.1-S2** | First time workers were told *where* to put structured fields (frontmatter). The executor's overwrite-fallback (Apr 1) had not been touched; both worlds coexisted. |
| 2026-04-06 / `697ab41` | "fix(m9.1-s8): preserve worker deliverable + clarify todo template text" — adds the `startsWith("---")` guard. Comment: *"Worker wrote structured deliverable with frontmatter — keep it"*. Templates updated to say "write to deliverable.md frontmatter as `<field>`" | **M9.1-S8** smoke-test fix | **The `startsWith("---")` mechanism's actual birth.** Designed for capability-build/modify workers (which DO write frontmatter). Generic/research workers did not exist at this point, so the design was complete *for the templates that existed*. |
| 2026-04-10 / `cacba19` | "fix(brief): replace truncation with disk-based summary resolver, fix framing". Adds `summary-resolver.ts` (reads `deliverable.md` from disk first), adds `generic` + `research` templates, adds `deliverable_written` validator. **Generic/research templates did NOT include frontmatter instructions** — text was: *"Write deliverable.md with your key findings and output — this is what gets delivered to the user"* | **M9.4-S4** brief delivery fix | **Second drift point.** The pipeline now READS from disk authoritatively (summary-resolver), generic+research workers are now first-class, but those workers were not told to write frontmatter. The Apr-6 frontmatter guard now silently fails on generic/research workers — every run, every day. The overwrite is dormant until something stresses it. |
| 2026-04-25 to 2026-04-27 | User reports proactive briefs being dismissed ("That's tomorrow's brief — nothing to action now"). Bug recorded `docs/bugs/2026-04-25-proactive-delivery-dismissal.md` (`1eee571`). M9.4-S4.2 spun up | — | The dismissal pattern was the visible failure. Worker contamination was *also* present but masked because the action-request framing pre-S4.2 inlined `result.work` (already truncated to 500 chars by `summary-resolver`'s 4000-char guard) — long enough to ship the digest, short enough that the worst narration was clipped. |
| 2026-04-27 / `a17c9e4` | "feat(s4.2): deliverable validator with doubled-signal narration detection". Adds `STRONG_OPENERS` + `SECOND_MARKERS` regex inside `deliverable_written`. Strengthens generic+research template text: *"Use the Write tool to emit deliverable.md with your final findings and output… Do NOT narrate your process… Final step…"* | **M9.4-S4.2** | The validator can now detect contamination. But the validator runs against on-disk `deliverable.md` — and the Apr-1+Apr-6 executor overwrite still fires AFTER the validator has already rendered its verdict (worker is already done, todos already marked, executor stage 7 runs at session-end). |
| 2026-04-28 / `35a025e` | "fix(s4.2-fu1): widen deliverable validator regex (L1) — cover Day-1 soak narration verbs". Adds `^I'll start (by\|executing)`, `Now I need to`, `Let me (get\|find\|search\|create\|locate)` | M9.4-S4.2 fu1 | Validator regex is now correct. Soak Day-1 confirmed it still leaks — Day-2 traced it to the validator-enforcement gap (separate bug) PLUS the executor-overwrite (this one). |
| 2026-04-29 / `7101013` | "fix(s4.2-fu2): inline deliverable content in action-request prompt; stop inviting Read tool narration" | M9.4-S4.2 fu2 | Worked around the symptom by inlining content in the action-request prompt. Did not fix the underlying overwrite — but `summary-resolver.ts` now reads `deliverable.md` directly, so contaminated content is what the user sees. |
| 2026-04-29 / `08a1c79` | "docs(bug): validator enforcement gap surfaced by M9.4-S4.2 Soak Day-2" | M9.4-S4.2 follow-up | Bug filed for the validator-side gap (different problem: workers mark `t1: done` despite contaminated content). The executor-overwrite is the *complementary* gap on the framework side. |

## Original design intent (`extractDeliverable` era)

When `<deliverable>` tags were the contract (`7191d9e`, M5-S9, Feb 22), the worker
contract was: **emit one final response containing structured XML.** The executor
parsed:

```
<work-log>I researched X, then composed Y</work-log>  // becomes 'work'
<deliverable>
The actual content to deliver to the user
</deliverable>                                         // becomes 'deliverable'
```

The "work" was telemetry; the "deliverable" was the artifact. The executor never
needed to write to disk — it received the parsed string and handed it to the
delivery layer in memory. `extractDeliverable` was a string-splitting utility
with no side effects. `validateDeliverable` (in the same file) gated whether the
delivery would proceed (missing/empty/`NONE` → `needs_review`).

The `startsWith("---")` guard does not exist in this era. Frontmatter was not part
of the M5-S9 contract. The XML tags WERE the structure.

When disk writes were added (`1e1827e`, M7, Mar 31), the contract was preserved:
write only when `<deliverable>` tags successfully parsed. The fallback to
`work` (`f4f5d83`, Apr 1) is the inflection point — at that moment, the executor
silently committed to writing *whatever the worker emitted, however unstructured*
into `deliverable.md`. The XML tag contract was effectively abandoned without an
explicit replacement.

The `startsWith("---")` guard (`697ab41`, M9.1-S8, Apr 6) was a *minimal*
self-defense for a *new* contract — capability-build/modify workers, which DO
emit frontmatter. The guard's logic is sound for that contract: "if the worker
already wrote a structured file with frontmatter, don't clobber it with raw
stream." But it was never updated when generic/research workers (which write
plain markdown via the Write tool) became first-class.

## Drift points

Three concrete moments where the contract changed and a dependent mechanism was
not updated:

1. **Apr 1 (`f4f5d83`)** — XML-tag contract abandoned in the executor (silently;
   commit message says workers "don't always wrap" but the response is to widen
   the executor, not to re-establish the contract). The auto-write of full
   stream content as `deliverable.md` is born here. The validator system did not
   yet exist to compensate.

2. **Apr 10 (`cacba19`)** — Generic/research templates and `deliverable_written`
   validator added together, but the templates did not specify frontmatter. The
   Apr-6 `startsWith("---")` guard, designed for capability workers that emit
   frontmatter, silently became a no-op for the new template types. The summary
   resolver (which now reads from disk) became the user-facing delivery surface,
   so any executor overwrite *would* surface — but at this point workers were
   reliably writing clean content via the Write tool, so the overwrite was
   harmless overwriting harmless content.

3. **Apr 27 (`a17c9e4`)** — When workers started emitting contaminated streams
   (Sonnet narration patterns at increasing rates — possibly an SDK / model
   update; the soak diaries note the regression is recent and fresh-session-
   resistant), the validator was strengthened to detect contamination. But the
   validator only governs the *worker's* todo-completion path. The executor's
   own end-of-session write (line 605-621) is *not gated by the validator*.
   So even when the worker correctly produced clean content via Write tool, the
   executor would then overwrite it with the contaminated stream once the SDK
   query loop concluded.

## Why the failure became visible Apr 25-28

Three things happened in the second half of April that made silent contamination
become user-visible:

1. **The summary-resolver redirection (Apr 10, `cacba19`).** Before this commit,
   the brief delivery path used `result.work.slice(0, 500)` — the first 500
   chars of the in-memory stream. After this commit, it reads
   `deliverable.md` from disk verbatim (up to 4000 chars). The on-disk file IS
   the brief once `summary-resolver` is in place. So the executor's silent
   overwrite (which had been in place since Apr 1, 24 days earlier) now
   directly produced user-visible content.

2. **Workers producing more contaminated streams.** Soak Day-1 and Day-2 reports
   flag this as recent. Possible causes: model behavior drift on Sonnet 4.6,
   prompt-template wording (the Apr 27 strengthened text "Do NOT narrate your
   process" reads as a reaction, not a preventative measure), or todo-server
   prompt context inflating the worker's stream-of-consciousness. Whatever the
   cause, the executor had no defense against contaminated streams, and the
   summary-resolver pipeline now showed the contamination directly.

3. **The action-request reframing (Apr 28, S4.2 merged).** Before S4.2,
   proactive deliveries were `[SYSTEM: …]` injections — the model dismissed
   them as context. Bad in its own way, but the dismissal *hid* the
   contamination behind a "background activity" frame. After S4.2, the
   action-request frame caused the model to deliver the brief as content. So
   contamination that was always present finally landed in the user's lap.

The bug is older than the visibility — at minimum, it has been present since
Apr 1 (`f4f5d83`). The Apr 10 + Apr 28 changes are what unmasked it. Earlier
clean briefs (e.g. user's reference Apr 24 baseline) were clean either because
workers produced clean content (the executor's overwrite was harmless because
the stream WAS the deliverable) or because the truncation/framing layers
absorbed the contamination.

## Conclusion

This is **accumulated drift, not intentional incomplete migration**. Each commit
in the timeline addresses a specific local pain — `f4f5d83` "let's just write
the file when there's no tag", `697ab41` "preserve frontmatter so we don't
clobber capability workers", `cacba19` "the user can't see the brief, replace
truncation with disk read", `a17c9e4` "stop the worker from writing
contamination". No commit owns the worker contract end-to-end; each generation
defended against the previous failure mode without revisiting the original XML-
tag premise. The `startsWith("---")` guard is a load-bearing fossil — it was
correct for the contract that existed when it was written (Apr 6:
capability-build/modify workers with frontmatter), but it has been embedded in
a pipeline that now assumes a different worker contract (generic/research
workers writing plain markdown via Write tool). The right fix is at the contract
level: decide what the executor's role is once a worker writes its own
`deliverable.md` via the Write tool — and either remove the auto-write fallback
entirely, or make it conditional on "no worker-written file exists at all"
rather than the frontmatter sniff.

## References

- M5-S9 origin: commit `7191d9e` (`<deliverable>` XML tag contract)
- Disk write introduction: commit `1e1827e` (M7, "full deliverable pipeline")
- Drift point 1 (overwrite born): commit `f4f5d83` ("write deliverable.md even
  without `<deliverable>` tags")
- Drift point 2 (frontmatter guard): commit `697ab41` (M9.1-S8)
- Drift point 3 (generic/research without frontmatter): commit `cacba19` (M9.4-S4)
- Validator strengthened: commit `a17c9e4` (M9.4-S4.2)
- Bug surface: [`docs/bugs/2026-04-29-validator-enforcement-gap.md`](../../bugs/2026-04-29-validator-enforcement-gap.md)
- Soak Day-2 case: [`soak-day-2.md`](soak-day-2.md) §Factor (b)
- Pre-existing brief bug (different but adjacent):
  [`docs/bugs/2026-04-08-brief-delivery-broken.md`](../../bugs/2026-04-08-brief-delivery-broken.md)
