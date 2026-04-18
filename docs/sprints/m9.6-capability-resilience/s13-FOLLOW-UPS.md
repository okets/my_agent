---
sprint: m9.6-s13
date: 2026-04-18
---

# M9.6-S13 Follow-Ups

## FU-1 — S10-FU-2 deferred: remove bash-wrapper fallback in reverifyAudioToText

**What:** S10's architect review tracked FU-2: remove the legacy `execFile("bash", [scriptPath, ...])` fallback in `reverifyAudioToText` now that `CapabilityInvoker` is wired. S13 intentionally leaves it in place.

**Why deferred:** The `invoker` parameter is optional in `reverifyAudioToText` (and in the `Reverifier` type), and existing unit tests that don't wire the full App still exercise the fallback path. Removing it in S13 would require migrating all reverify test fixtures — out of scope for a sprint focused on the dispatcher.

**Target sprint:** **S18** — "Duplicate TTS path collapse" already touches reverify wiring; that's the natural place to drop the fallback once all test fixtures are migrated to the invoker path.

**What to do in S18:** In `reverifyAudioToText`, remove the entire fallback block (lines ~163–212 as of S13). Make `invoker` required in `ReverifyResult`-typed reverifiers, or assert it is present and throw if not. Migrate any remaining tests that pass `undefined` as invoker to use a mock invoker.
