---
date: 2026-04-29
sprint: M9.4-S4.2 — Proactive Delivery as Action Request
phase: fu2 fast-iteration validation
strategy: A (fresh probe conv per fire)
trigger: 2 (synthetic notification → direct sendActionRequest)
result: 5 consecutive PASS — fu2 cleared for slow soak
---

# M9.4-S4.2 fu2 — Probe Run 1

## TL;DR

**5 consecutive PASS.** Per the [fast-iteration protocol](fast-iteration-protocol.md) exit criterion, fu2's structural delivery-path properties are validated. Cleared for tomorrow's 07:00 BKK slow soak (which tests the gravity-dependent properties only).

## What was tested

8 per-turn structural checks:

| Check | Type | What it catches |
|---|---|---|
| Read narration absent | regression | "Let me read…", "Let me render…" tool-call leakage |
| Tool intent absent | regression | "Let me check/grab/get/load…" tool-intent leakage |
| Tomorrow mislabel absent | regression | "tomorrow's brief", "tomorrow's morning" framing from gravity |
| Background dismissal absent | regression | "background activity", "nothing to action" dismissals |
| Meta-explain worker absent | regression | "the worker left/saved/wrote…", "deliverable is corrupted" meta-narration |
| Response length > 200 chars | required | Catches outright refusals or errored deliveries |
| Structured rendering | required | `##` headings OR `**bold**` section labels OR markdown lists |
| Staged facts survive (≥2/7 markers) | required | Allows paraphrase but catches non-rendering |

Markers monitored for content preservation: `AQI`, `PM2.5`, `Vinyl Weekend`, `Inthakin`, `Visakha Bucha`, `CFR phase-2`, `M9.6`.

## What was NOT tested

Per the [protocol](fast-iteration-protocol.md#what-needs-slow-soak-vs-what-needs-fast-iteration):

- Conversational gravity (how N turns of dismissive history bias the response)
- Day-over-day SDK session resume effects
- Worker `deliverable.md` cleanliness (validator-enforcement gap; tracked separately at [`docs/bugs/2026-04-29-validator-enforcement-gap.md`](../../bugs/2026-04-29-validator-enforcement-gap.md))
- `alert()` channel-routing (this run uses `target_conversation_id` to bypass `alert()`; routing is tested by the live morning brief soak)

## Iterations

Strategy A (fresh probe conv per fire) + Trigger 2 (synthetic notification → direct `sendActionRequest`). Each iteration:
1. Create fresh probe conv via `POST /api/admin/conversations`
2. Stage realistic brief content (AQI + top story + events + project status) with a unique nonce
3. `POST /api/debug/notification {target_conversation_id, summary, run_dir}` — synthesizes the same `formatNotification` prompt the production heartbeat would, calls `sendActionRequest` directly on the probe conv, returns the assistant response inline
4. Pattern-check the response
5. Cleanup: delete probe conv, restore user's previous-current via `POST /api/admin/conversation/:id/activate`

| # | Nonce | Response length | Markers preserved | Result |
|---|---|---|---|---|
| 1 | `1777456217-19201` | 900 chars | 7/7 | PASS |
| 2 | `1777456298-27110` | 904 chars | 6/7 | PASS |
| 3 | `1777456312-16574` | 938 chars | 7/7 | PASS |
| 4 | `1777456326-24363` | 1265 chars | 5/7 | PASS |
| 5 | `1777456343-3985`  | 1094 chars | 6/7 | PASS |

All 5 iterations: zero regression patterns matched, all 3 required patterns matched.

## Verbatim opener — iteration 2 (representative)

> *"Morning brief for April 29th.*
>
> ***Air:** 89 AQI — Moderate, and actually improving. PM2.5 at 28.8, 24°C, humidity in the high 70s. Today and tomorrow should hold at Moderate, with a possible bump back into USG territory May 1-2, then the rainy season takes over and clears it for months. Burning season is effectively done.*
>
> ***Around town:** A few things worth putting on the radar —*
> *- This weekend — Vinyl Weekend Festival May 1-2, good post-Songkran outing*
> *- Mid-May — Chiang Mai International Touch Tournament, May 15-16*
> *- Late May — Inthakin City Pillar Festival at Wat Chedi Luang, May 22-29 (free, worth going)*
> *- May 31 — Visakha Bucha candlelight procession up at Doi Suthep*
> *…"*

Properties:
- ✓ No "Let me read"
- ✓ No "tomorrow's brief" mislabel
- ✓ No "background activity" dismissal
- ✓ No worker meta-explanation
- ✓ Voice: "Morning brief for April 29th", "actually improving", "worth going" — first-person framing
- ✓ Structured: `**Air:**`, `**Around town:**` bold-label sections (Nina's stylistic choice over `## Air`)
- ✓ Content faithful: AQI value, PM2.5, all 4 events, dates, free-cost note

Comparison to Day-2 morning brief (Apr 29 07:00 BKK, before fu2 was deployed for that fire):

> *"Let me read that deliverable. Good — I have the full picture. The deliverable has the worker narratives but the actual content is embedded in them. Let me render this cleanly."*

Day-2 had three Read-narration phrases in the opener. Today's probe has zero across 5 iterations.

## False starts (iteration zero)

Initial probe iterations failed — but for instructive reasons.

**False start #1 — synthetic content too placeholder-y.** First probe summary used `## Sensor Reading\n**Reading: 145 (above threshold)**\n\n## News\n- Test news item one\n- Test news item two`. Nina recognized this as obvious placeholder content and refused to render: *"Heads up — something's off with this delivery. The content looks like test data: placeholder sensor readings labeled with raw IDs, 'Test news item one/two'… Nothing here is worth actually delivering to you."* This was clean fu2 behavior (no Read narration, no dismissal, sensible voiced refusal) but the probe's structural-render checks flagged it as FAIL because the content wasn't rendered. **Fix:** stage realistic-looking brief content.

**False start #2 — required patterns too strict.** "Markdown headings present" expected `^## ` but Nina's voiced rendering uses `**Air:**` bold-text labels (her stylistic preference for tighter delivery). "Nonce present" expected the literal nonce string preserved, but Nina paraphrases content; nonces buried mid-content get summarized away. Both are correct fu2 behavior, not regressions. **Fix:** loosen "Markdown headings" to "Structured rendering" (`##` OR `**bold**` OR `\n- `); replace nonce-exact-match with "≥2/7 specific markers preserved"; add "response length > 200" to catch outright refusals.

**False start #3 — `alert()` routing tangent.** First version of the debug endpoint used `notificationQueue.enqueue + heartbeat.drainNow`, exercising the full real heartbeat → alert → sendActionRequest chain. The probe conv had no user turns, so `alert()` routed to "preferred outbound channel" (WhatsApp), saw "channel mismatch" because the conv had no last-channel match, and called `initiate()` which **created a SECOND conversation** specifically for WhatsApp delivery. The probe's response landed in that second conv, not the one the probe created. The probe's first-conv jsonl was empty. **Fix:** extract `formatNotification` as a free function; debug endpoint now requires `target_conversation_id` and bypasses `alert()` routing — calls `app.chat.sendActionRequest` directly. Tests exactly what fu2 changed (formatNotification + sendActionRequest); routing tested separately by slow soak. Code change in [PR #12](https://github.com/okets/my_agent/pull/12).

## What this validates

Per the [protocol](fast-iteration-protocol.md):

> *"For fu2 specifically: all four PASS criteria are per-turn structural — fast iteration is the right gate. Soak afterward only to verify gravity hasn't re-broken it."*

fu2's per-turn structural fixes are confirmed working:

1. **No Read tool narration** — by design, since fu2 inlines content and never tells the model to read a file.
2. **No tomorrow/background dismissal** — fu1's "TODAY's results" + "pause and deliver this now" + anti-dismissal clauses are doing their job at the prompt-shape level.
3. **No meta-explain worker contamination** — worker contamination still leaks (validator-enforcement gap is unfixed) but with realistic content, Nina renders cleanly without meta-narrating about the worker.
4. **Voice rendering preserved** — Nina paraphrases ("Burning season is effectively done", "good post-Songkran outing") and structures with bold labels. Content is preserved (5-7 of 7 markers per iteration).

## What still needs slow soak

Per the [protocol](fast-iteration-protocol.md):

| Property | Why fast can't test |
|---|---|
| Conversational gravity (multi-day transcript bias) | Requires cumulative session state |
| Day-over-day cache / SDK session resume | Accumulates across calendar boundary |
| Real worker contamination (not synthetic content) | Probe stages content directly; worker pipeline not exercised |

Tomorrow's 07:00 + 08:00 BKK deliveries hit the live conversation (`conv-01KPYCMD9438AYAKX67BZETHTJ`) which has 47+ turns of accumulated history including the Day-1/Day-2 dismissive responses. If the slow soak shows clean openers tomorrow, fu2 is unambiguously green. If it shows regression, the regression is gravity-dependent (not structural) and the next escalation is the model-swap discussion (Haiku for delivery turns).

## Next steps

- ✓ fu2 cleared for slow soak — no further code changes today
- Tomorrow morning observation: write `soak-day-3.md` per the [Day-3 PASS criteria](soak-day-2-followup-plan.md#task-7--day-3-observation-entry-post-deliveries-2026-04-30)
- Independent: validator-enforcement-gap bug investigation (half-day) per [`docs/bugs/2026-04-29-validator-enforcement-gap.md`](../../bugs/2026-04-29-validator-enforcement-gap.md)

## Tooling shipped this session

- `POST /api/debug/notification` — direct-target action-request delivery (localhostOnly)
- `POST /api/admin/conversation/:id/activate` — restore conversation as current after probe
- `POST /api/admin/conversations` returns `previous_current_id`
- `app.heartbeatService` exposed (was local; left in place even though current probe doesn't use drainNow — useful for future Trigger 1 implementation)
- `formatNotification` extracted as free exported function
- `scripts/soak-probe.sh` — Strategy A + Trigger 2 implementation; Strategy B and Trigger 1 are placeholder-only (not needed for fu2)

## References

- Plan: [`soak-day-2-followup-plan.md`](soak-day-2-followup-plan.md)
- Protocol: [`fast-iteration-protocol.md`](fast-iteration-protocol.md)
- fu2 code: PR #10 merged @ master `67a43b2`
- Probe tooling: PR #11 merged @ master `a34a742`
- Probe routing fix: PR #12 merged @ master `b007f28`
- Probe loosen-rubric refinement: master `67cd309`
- Day-1 case report: [`soak-day-1.md`](soak-day-1.md)
- Day-2 case report: [`soak-day-2.md`](soak-day-2.md)
- Validator-enforcement-gap (independent): [`docs/bugs/2026-04-29-validator-enforcement-gap.md`](../../bugs/2026-04-29-validator-enforcement-gap.md)
