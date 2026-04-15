# Release Roadmap Design

> **Status:** Approved
> **Date:** 2026-03-21
> **Scope:** M7–M14 (Persistent Workspaces through Release)
> **Sprint estimate:** ~22 sprints

---

## Release Definition

Release means **anyone can hatch their own agent** — not just Nina. The framework is generic, stable, and documented. A released agent:

- Communicates with its owner via dashboard, WhatsApp, iOS app
- Communicates with the world via email (MS365), Discord, WhatsApp external contacts
- Understands images and voice, produces rich visual output, speaks back via TTS
- Controls desktop applications on Linux and macOS
- Runs autonomous long-running tasks with persistent workspaces
- Has backup/restore, a proper update mechanism, and session-based auth
- Is extensible: new transports are a well-defined plugin exercise via the Transport SDK

---

## Milestone Overview

| # | Milestone | Sprints | What it delivers |
|---|-----------|---------|-----------------|
| **M7** | Persistent Workspaces | 2 | Decouple work folders from tasks. Workspace CRUD, multi-task continuity, repo-as-workspace. |
| **M8** | Desktop Automation | 2 | Claude Computer Use integration, desktop tool set for Working Agents, safety hooks, Linux + macOS. |
| **M9** | Multimodal | 4 | Rich input (images, STT), rich output + visual thinking, micro-websites, voice mode (TTS). |
| **M10** | Channel SDK + Transports | 4 | Mature transport SDK (OpenClaw-inspired), email transport (MS365), Discord transport, community docs. |
| **M11** | External Communications | 2 | External contacts via Working Agents, cross-channel ruleset, approval flow. |
| **M12** | iOS App | 3 | Native iOS app, push notifications, headless App integration, multimodal support. |
| **M13** | Platform Hardening | 3 | Dashboard auth, backup/restore, update mechanism. |
| **M14** | Release | 2 | Security audit, user-facing docs, setup guide, examples, final polish. |

**Total: ~22 sprints**

---

## Dependency Chain

```
M7 Workspaces ──► M8 Desktop Auto ──► M9 Multimodal ──► M10 Channel SDK ──► M11 External Comms ──► M12 iOS ──► M13 Hardening ──► M14 Release
```

Each milestone builds on the previous. Minimal rework, natural progression.

---

## M7: Persistent Workspaces (2 sprints)

**Goal:** Decouple work folders from task lifecycle. Workspaces become persistent, reusable contexts that tasks attach to.

**Current state:** Tasks create a work folder in `.my_agent/inbox/` or `.my_agent/projects/`. Folder lifetime = task lifetime.

**Target state:** Workspaces are independent entities. A task references a workspace. Multiple tasks can use the same workspace over time. A workspace can point at an external repo.

**Core principle:** Workspace = a folder with a manifest file. The folder IS the workspace. agent.db indexes them for search/listing but is derived and rebuildable.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Workspace Entity | Workspace model (id, name, path, type: internal/external), WorkspaceStorage (CRUD), migration of existing task folders, workspace-task relationship in agent.db. MCP tools: `create_workspace`, `list_workspaces`. |
| S2 | Workspace Lifecycle | Workspace persistence across tasks, workspace browser in dashboard, "attach to workspace" in task creation, external repo registration, workspace-scoped CLAUDE.md + skills loading. |

**Key design questions (resolve during spec):**
- Source of truth for workspace manifest: what format, what location, how are external repos referenced without polluting them?
- Do internal workspaces live in `.my_agent/workspaces/` or stay in `.my_agent/projects/`?
- Archive/cleanup policy for inactive workspaces
- How does the agentic task executor discover which workspace to use?

---

## M8: Desktop Automation (2 sprints)

**Goal:** Working Agents can control desktop applications via Claude Computer Use.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Computer Use Integration | Wire Claude Computer Use tools (screenshot, mouse, keyboard) into the agentic task executor. Safety hooks (confirmation before destructive actions, screenshot audit log). Linux first. |
| S2 | Cross-Platform + UX | macOS support (Accessibility API permissions flow), desktop automation skill for the brain (Nina can be asked to automate desktop tasks), task result screenshots in dashboard. |

**Key design questions (resolve during spec):**
- Trust tier: per-task approval or workspace-level permission?
- Screenshot storage and privacy (real screen content)
- Rate limiting / timeout guards (prevent runaway clicking loops)

---

## M9: Multimodal (4 sprints)

**Goal:** Nina understands images and voice, produces rich visual deliverables, thinks visually, and speaks back.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Rich Input | Image passthrough verification/fix (dashboard + WhatsApp). Voice messages: STT engine selection (Whisper or similar), audio → text pipeline, transcription shown in chat. Both channels. |
| S2 | Rich Output + Visual Thinking | Asset storage + serving, deliverable types (text/image/file/html), inline rendering. MCP tools for Nina to generate visual artifacts mid-conversation (diagrams, formatted cards, annotated images). "Visual communication" skill — behavioral guidance on when to reach for visuals vs. text. |
| S3 | Micro-websites | Sandboxed iframe rendering for task-generated HTML artifacts in dashboard chat. Interactive deliverables. Security (CSP, sandboxing). Preview for WhatsApp (link + screenshot). |
| S4 | Voice Mode | TTS engine selection (local/open — Qwen 3 TTS or similar). Dashboard audio playback. WhatsApp voice note replies. Streaming TTS for long responses. Toggle in settings. |

**Key design questions (resolve during spec):**
- STT/TTS: local models (privacy, no API cost) vs. cloud (quality, latency)?
- Asset storage: per-workspace, per-task, or global?
- Voice mode: always on, per-conversation toggle, or activation phrase?
- Visual thinking: how does Nina decide when to produce a visual vs. text?

---

## M10: Channel SDK (8 sprints, S0 done)

**Goal:** Perfect the transport/channels system with clean decoupling and easy extensibility. Ship 4 production channels pre-launch (WhatsApp + Telegram + Discord + Line). End with Nina authoring a channel solo as proof of SDK usability.

**Core principle:** Transport (wire: connect/send/receive/auth) and Channel (owner-identity binding on top) are separate contracts. A transport without a channel is still useful — M11 layers external communications + email-as-capability on top without forcing every transport through the channel abstraction.

**Non-scope:** email, external communications, per-contact rulesets. Those are M11. M10-S1 designs forward-compat for them without implementing.

**Inspiration:** OpenClaw connector patterns; Anthropic's Claude Code "Channels" MCP model (envelope + sender gating + capability declaration patterns, adapted for our multi-user case — they couple transport+channel because Claude Code is single-user; we don't).

| Sprint | Name | Mode | Scope |
|--------|------|------|-------|
| S0 | Routing Simplification | Done | Eliminated `sourceChannel` tagging and routing hardcodes. Presence rule at delivery. Merged 2026-04-13. |
| S1 | Transport + Channel SDK Design | Design, no code | Spec deliverable: transport/channel decoupling, auth primitives (QR/OAuth/token/custom), sender gating enforcement point, lifecycle hooks, health/status surface, capability declarations (inbound/outbound/richContent/groupChat), protocol-expressibility, M11 forward-compat analysis. |
| S2 | WhatsApp Migration — Gold Bar | Implementation | Refactor WhatsApp onto new SDK. Becomes the reference implementation. |
| S3 | Telegram Channel | Implementation | Framework-built. Simplest bot-API shape. First non-WhatsApp validation. |
| S4 | Discord Channel | Implementation | Framework-built. Real-time WebSocket. Tests SDK's range. |
| S5 | SDK Docs + Scaffold + Skill | Docs + tooling | Public SDK docs, `create-channel` scaffold, `channel-brainstorming` skill + `channel-builder` agent, `skills/channel-templates/` (webhook-bot, long-poll-bot, websocket-bot). |
| S6 | Line Channel — Co-Build with Nina | Co-build | Nina drives, we pair. Each friction surfaced becomes an SDK/docs fix. |
| S7 | Agent-Authored Channel — Proof | Autonomy test | Nina builds a new channel solo from a user request. Validates SDK usability. |

**Key design decisions (locked):**
- Transport ≠ channel — separate contracts. Transport is infrastructure; channel is owner-identity binding.
- Pre-launch channels: WhatsApp + Telegram + Discord + Line.
- Three authorship tiers: framework-shipped, community-built, agent-authored. Manifest declares tier.
- Sender gating enforced in framework, not plugin. Plugin reports `fromIdentity`; framework decides channel binding.
- SDK expressed as message protocol, not TS-interface-only. Enables future subprocess/multi-language runtimes.
- Post-generation content adaptation (markdown stripping, message splitting) stays in plugin. Tone/length shaping stays in brain.

**Milestone exit criteria:**
- 4 channels shipped (WA migrated + TG + Discord + Line)
- SDK + scaffold + `channel-brainstorming` skill public
- One agent-authored channel exists (S7)
- M11 forward-compat analysis in S1 spec

**Key design questions (resolve in S1):**
- Protocol shape: message-schema-based (future-proof for subprocess runtimes) vs. TS-module-native (simpler now). S1 must pick a shape that makes both possible.
- Auth UX primitives: how does the plugin declare what it needs (QR/OAuth/token) without each plugin reinventing the flow?
- How M11's working-Nina-outbound + stranger-inbound layers on the same transport a channel is bound to — without the channel's owner binding leaking into other conversation scopes.
- Sender-gating-by-framework: which layer actually enforces it, and how does the plugin report `fromIdentity` in a way that can't be spoofed from inside the plugin?

---

## M11: External Communications (3 sprints)

**Goal:** The agent communicates with people other than the owner, across all transports, via Working Agents. Adds email as a capability (not a channel) — nobody has conversations with their agent over email; email is a tool the agent *uses* on the owner's behalf against external contacts.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Email Capability (MS365) | Email as a capability, not a channel. MS365 via Microsoft Graph API. OAuth flow, inbound polling, outbound sending, attachments, threading. Agent uses it as a tool. |
| S2 | External Contact Routing | Working Agent spawned per external contact/conversation on the transports built in M10 (WhatsApp + Discord + Telegram + Line) + email capability. Contact registry (markdown-first). Inbound routing for non-owner senders. |
| S3 | Ruleset + Approval Flow | Cross-channel ruleset model (auto-reply, queue, block per contact/group). Approval UI in dashboard (pending messages, approve/edit/reject). Outbound sending on behalf of owner. Notification to owner on escalation. |

**Key design questions (resolve during spec):**
- Contact identity across transports (same person on WhatsApp + email = one contact?)
- Ruleset storage: per-contact YAML in notebook, or workspace-level config?
- Approval UX: notification + quick-approve, or full review queue?
- How working Ninas share a transport with conversation-Nina without stepping on each other's auth/rate limits (pre-resolved by M10-S1's forward-compat analysis).

---

## M12: iOS App (3 sprints)

**Goal:** Native iOS app that connects to the agent. Push notifications, multimodal support, full assistant experience on mobile.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | App Foundation | Project setup (Swift/SwiftUI), headless App client connection (WebSocket to dashboard server or direct to headless API), auth flow, basic chat UI. |
| S2 | Full Chat Experience | Streaming responses, rich content rendering (images, files, micro-websites), voice input/output, conversation history, conversation switching. |
| S3 | Native Features | Push notifications (APNs), Siri Shortcuts integration, home screen widget (quick status/tasks), background refresh, app store preparation. |

**Key design questions (resolve during spec):**
- Connection model: iOS app talks to dashboard server (same as web) or directly to headless App?
- SwiftUI vs. React Native vs. WebView wrapper?
- Push notification delivery: dashboard server or separate notification service?

---

## M13: Platform Hardening (3 sprints)

**Goal:** Infrastructure that makes the agent safe, recoverable, and updatable.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Dashboard Authentication | Session-based auth for web UI. Login flow, session tokens, secure cookie handling. Multi-user foundation (owner + guests with limited access). |
| S2 | Backup & Restore | Full backup (`.my_agent/` + DBs + config) and partial backup (personality, transcripts, tasks, skills). Restore flow that rebuilds derived indexes. CLI commands. Automated pre-update backup. |
| S3 | Update Mechanism + Install Tooling | Version tracking, `my-agent update` command, schema migrations, breaking change detection, rollback via backup. **Plus:** Installation scaffolding (`npx create-my-agent` or similar), initial config wizard, dependency checking, process manager abstraction (systemd on Linux, launchd on macOS). |

**Key design questions (resolve during spec):**
- Auth: simple password/token, or OAuth (Google/GitHub login)?
- Backup format: tarball, or structured export (JSON + files)?
- Update channel: git pull, npm, or custom registry?
- Deployment portability: Docker-based alternative? macOS launchd support? Minimum system requirements?

---

## M14: Release (2 sprints)

**Goal:** Everything is audited, documented, and ready for other people to use.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Security Audit | Review all trust tiers, hook enforcement, guardrails. Pen-test dashboard auth. Audit transport SDK auth flows. Review Computer Use safety hooks. Harden `.my_agent/` permissions. Fix findings. |
| S2 | Documentation + Launch | User-facing README, getting started guide, hatching walkthrough, transport SDK guide, architecture overview. Example configurations. Landing page / project site. License finalization. |

---

## Post-Release Backlog

Features that are explicitly out of scope for release but enabled by the architecture:

- **Additional transports** — Slack, Gmail, Telegram (community builds via Transport SDK)
- **External calendar channels** — Google Calendar, Apple iCloud, Outlook as channel plugins
- **Mobile dashboard phase 2** — advanced mobile features beyond M2-S7
- **Mid-session intervention** — inject input into running Claude Code sessions
- **Navigable timeline** — hero timeline, infinite scroll, search (design exists)
- **Skill registry** — curated, trust-tiered community skill marketplace

---

## Ad-Hoc Items (folded in)

| Item | Destination |
|------|-------------|
| WhatsApp typing indicator | M10 or M11 (natural fit with transport/external work) |
| Pre-release checklist (auth, backup, security, docs) | M13 + M14 |

---

## Early Design Decisions

These decisions should be made before their milestone's spec phase, as they affect downstream milestones:

| Decision | Resolve before | Why |
|----------|---------------|-----|
| STT/TTS: local-first vs. cloud | M9 spec | Affects infrastructure requirements, privacy model, deployment story for M13/M14 |
| Message normalization format | M10 spec | Every transport, routing rule, iOS app, and backup depends on canonical message shape |

---

## Sizing Risks

| Milestone | Risk | Mitigation |
|-----------|------|------------|
| M9 Multimodal (4 sprints) | Four distinct technical domains (images, STT, rich output, TTS) — most likely to expand | Defer engine selection to spec phase; budget for 5-6 sprints if local models prove complex |
| M12 iOS App (3 sprints) | Platform risk if going native SwiftUI (new language/platform) | SwiftUI vs. RN vs. WebView decision will significantly impact sizing |
| M13-S3 Update Mechanism | Schema migration complexity may be substantial by M13 | Scope depends on how many schema changes accumulate through M7-M12 |

---

## Principles

- **Markdown is source of truth.** Workspaces, contacts, rulesets — all markdown-first, DB is derived.
- **Natural dependency order.** Each milestone builds on the previous. Minimal rework.
- **Sprint quality gate.** Every milestone's final sprint includes E2E automated tests + human-in-the-loop validation.
- **Design before build.** Each milestone gets a spec before sprints begin.
