---
sprint: m9.6-s18
---

# M9.6-S18 Deviations

## DEV-1 — tts-edge-tts scripts not committed to git

**Task:** Task 3 (S11-FU-5 — tts-edge-tts Ogg transcode fix)

**What the plan assumed:** `git add .my_agent/capabilities/tts-edge-tts/scripts/synthesize.sh` would succeed.

**What happened:** `.my_agent/` is gitignored (privacy guardrail). Git rejected the add.

**Resolution:** Changes applied to disk. `bash .my_agent/capabilities/tts-edge-tts/scripts/smoke.sh` exits 0, confirming the transcode and OggS validation work. No git record for `.my_agent/` changes — this is correct behavior for the private directory.

**Impact:** None. The plug changes are live and working. Sprint artifacts (DECISIONS.md, test report) document the change.

---

## Proposals filed

None. All deviations were minor implementation details handled via DECISIONS.md (D1–D3) without requiring proposal documents.
