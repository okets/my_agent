---
name: brainstorming
description: Collaborative design exploration — use before any creative work, new features, architecture changes, or behavior modifications. Explores intent, requirements, and design before implementation.
origin: curated
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs through natural collaborative dialogue.

Start by understanding the current context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get approval.

<HARD-GATE>
Do NOT begin any implementation until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Process

1. **Explore context** — check relevant files, docs, recent changes
2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
3. **Propose 2-3 approaches** — with trade-offs and your recommendation
4. **Present design** — in sections scaled to complexity, get approval after each section
5. **Document design** — save validated design for implementation reference
6. **Hand off** — delegate implementation to a working agent

## Understanding the Idea

- Check current project state first (files, docs, recent changes)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems, flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single design, help decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built?
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message
- Focus on understanding: purpose, constraints, success criteria

## Exploring Approaches

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

## Presenting the Design

- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## Design Principles

- **Isolation and clarity** — break systems into smaller units with one clear purpose, well-defined interfaces, testable independently
- **Work in existing codebases** — explore current structure before proposing changes, follow existing patterns
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Incremental validation** — present design, get approval before moving on

## Technique Libraries

When brainstorming, invoke the **brainstorming-techniques** and **elicitation-techniques** skills to access 100+ structured methods. Select techniques silently based on context — never announce technique names to the user. Examples:

- Stuck on requirements? Use elicitation techniques (5 Whys, Stakeholder Round Table, Pre-mortem Analysis)
- Need creative approaches? Use brainstorming techniques (First Principles, SCAMPER, Cross-Pollination)
- Exploring risks? Use elicitation techniques (Red Team vs Blue Team, Failure Mode Analysis)

The technique libraries enrich your process — they don't replace it. Follow the process above; let techniques guide your questions and approach exploration.

## Key Rules

- **One question at a time** — don't overwhelm with multiple questions
- **Multiple choice preferred** — easier to answer than open-ended when possible
- **Explore alternatives** — always propose 2-3 approaches before settling
- **Be flexible** — go back and clarify when something doesn't make sense
