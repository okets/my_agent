# S6 Deviations — User-Facing Messaging + Capability Confidence Contract

Sprint: M9.6-S6
Branch: sprint/m9.6-s6-user-facing-messaging

---

No deviation proposals were filed during this sprint. All sprint directives
(§8.1–§8.6) were implementable as written.

The only notable decision-level deviations are documented in
[`s6-DECISIONS.md`](./s6-DECISIONS.md) (D1–D7) and did not require
architect approval ahead of implementation because they fell inside the
team-lead-provided architectural guidance (D1–D5 map directly to the
team-lead message's "Key architectural decisions" section; D6–D7 are
straightforward refinements consistent with the plan text).

Plan steps that were skipped — with reason:

- **§8.4 "Update `.my_agent/capabilities/stt-deepgram/scripts/transcribe.sh`"**
  — Explicitly called out in the plan as forbidden. Template updated at
  `skills/capability-templates/audio-to-text.md` and follow-up recorded in
  `s6-FOLLOW-UPS.md` for the CTO to update her private script.
