# Deviation Proposal — Sprint 4: Audio Fixture — Gitignored Local Directory + Env Var + skipIf

**self-answered: .local/ gitignored dir + CFR_INCIDENT_AUDIO env var + it.skipIf()**

**Blocker:** Plan §6.4 says to "Copy the incident's audio to `packages/core/tests/fixtures/cfr/voice-1-incident.ogg` as a committed test asset." The audio is the CTO's own voice from a private WhatsApp conversation — committing it to a public repo is a privacy violation.

**Original plan says:**
> Copy the incident's audio to `packages/core/tests/fixtures/cfr/voice-1-incident.ogg` as a committed test asset. Transcript text is not asserted byte-exact (Deepgram output varies) — use substring match on "voice messages".
> — plan.md §6.4

**What I found:**
- Audio is at: `<agentDir>/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ/<attachmentId>.ogg` (~22 KB), confirmed by CTO during pre-flight
- `<agentDir>/` (`.my_agent/`) is gitignored — the audio stays private there
- Committing to `packages/core/tests/fixtures/` would land the CTO's voice in the public repo's git history permanently

**Options I considered:**
1. **Gitignored `.local/` dir + `CFR_INCIDENT_AUDIO` env var + `it.skipIf()`** — no private data in git; test runs on any machine with the file present; CI gets a clean skip (not a false pass). CTO-specified approach.
2. **Synthetic test audio** — doesn't test the real incident transcript; "voice messages" match becomes meaningless against fabricated audio.
3. **Skip the integration test entirely** — loses the most valuable test in S4 (the actual incident replay).

**My recommendation:** Option 1 (CTO-specified). Both the env var and the local fixture path are checked; whichever exists is used. `it.skipIf(!fs.existsSync(audioPath))` reports "skipped" explicitly in vitest output — not a silent pass.

**Implementation:**
- Add `packages/core/tests/fixtures/cfr/.local/` to `.gitignore` (check if `**/.local/` already covers it first)
- Test file header: "Requires CFR_INCIDENT_AUDIO env var or a fixture at tests/fixtures/cfr/.local/voice-1-incident.ogg. Skipped if absent — it'll run on any machine where the CTO has the incident audio locally."
- Path resolution: `process.env.CFR_INCIDENT_AUDIO ?? path.join(__dirname, '../fixtures/cfr/.local/voice-1-incident.ogg')`
- Assertion: `expect(result.recoveredContent).toContain("voice messages")`

**Blast radius:**
- Plan §6.4 needs amendment to reflect this approach (CTO will amend on review).
- No impact on other S4 tests (all others use synthetic data).
- No impact on other sprints.

**Question for the architect:** None — CTO specified the approach directly during trip-sprint pre-flight (2026-04-15).
