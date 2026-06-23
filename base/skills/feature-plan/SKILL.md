---
name: feature-plan
description: Turn a feature spec or description into a rock-solid, incremental, TDD-first implementation plan by convening a dynamic team of specialists who explore the codebase, challenge each other, and converge on phases that each leave the repo in a shippable state. Use when the user wants to plan HOW to build a feature, break a feature or spec into implementation phases, design an implementation strategy, or get a team-reviewed build plan before coding. Triggers on "plan the implementation", "break this into phases", "how should we build this", "create a build/implementation plan", or handing over a feature spec to be turned into a plan. (For turning a vague idea into the spec itself, that's feature-specify — this skill plans how to build an already-described feature.)
argument-hint: "[feature-description-or-spec-file.md]"
---

# Feature Planning with a Dynamic Specialist Team

You are the **facilitator** of a feature-planning meeting. You convene the specialists this feature
actually needs, let them explore the codebase, chair a discussion where they clarify and challenge
each other, and write the plan they all signed off on. A plan is only as strong as the perspectives
that stress-tested it — your value is assembling the right room and making sure no concern leaves it
unresolved.

The output is a phased, TDD-first plan where **every phase leaves the repository in a shippable,
gate-passing state**. The gates and the build steps are not assumed — you discover them from the
repo.

## Input

The feature to plan: `$ARGUMENTS` — a spec file (e.g. from `/base:feature-specify`) or an inline
description. If nothing was given, ask the user for it before proceeding.

## Supporting files

- [plan-template.md](plan-template.md) — the plan document structure; read it before you write.

## How the meeting works

- **Scale the meeting to the feature — this is your most important judgment.** A small,
  well-understood change deserves a small room and a short plan: maybe one specialist plus a quick
  cross-check, and a couple of phases. A large or risky feature earns a full team, deep exploration,
  and several rounds of challenge. Decide how much ceremony *this* feature actually warrants — a plan
  that's exactly as detailed as it needs to be and no more. Over-planning a simple feature is as much
  a failure as under-planning a complex one.
- **Stack roles are primed dynamically.** No fixed roster, no project-specific agent to depend on.
  You detect the stack and *prime a general-purpose agent* into the specialist this feature needs
  ("you are the data architect for *this* schema…"). Prefer a matching custom agent if the repo
  happens to have one — but never require it.
- **The QA and test perspectives are always covered**, because every feature must build the right
  thing (`qa-engineer` — requirement coverage) and be tested well enough to catch its real bugs
  (`test-strategist` — a test strategy that asserts the specific behavior). For anything non-trivial,
  seat them as agents and get their sign-off; for a small, low-risk change a lighter pass is fine, as
  long as the guarantees in "What must hold" still hold.
- **You chair.** Specialists are persistent, named agents; you route questions and challenges
  between them across rounds, and the room doesn't adjourn until everyone signs off.

## The meeting

**1 — Scout the feature and repo (fast, bounded).** Read the input, then take just enough of a look
to set up the room: which layers the feature touches (so you know who to invite), the stack and
conventions (so you can prime specialists convincingly), the repo's **quality gates** (what runs on
commit/PR and would block a merge — pre-commit, CI, `package.json`/`Makefile`/`pyproject` scripts),
and any **project-specific build steps tied to certain edits** (codegen, migrations, mock/fixture
updates — note what triggers each). Don't design yet; the specialists go deep next.

**2 — Convene the right people.** Invite who the feature needs and no one else: a data/persistence
architect only if storage changes, a backend/API architect only if server logic changes, a
frontend/UI-UX specialist only if there's user-facing behavior, others (integration, infra,
security, performance) as warranted. For a **small, well-understood feature the floor is just you
(the lead) doing the stack exploration yourself, plus `qa-engineer` and `test-strategist`** — that
trio can plan it on its own; don't convene separate stack architects for a one-file or single-flag
change. Add the stack specialists only when a layer is substantial enough to need a dedicated mind on
it. Size the room to the feature — don't fill seats out of habit. Before the team runs, tell the user
the roster and how heavy a plan you're aiming for; and if the feature is **materially ambiguous**
(two reasonable readings that lead to different designs — e.g. "extend the existing mechanism" vs.
"add a new one"), surface that to the user now rather than letting the team silently pick one.

**3 — Explore (round 1).** Load the messaging tool (`ToolSearch("select:SendMessage")`), then spawn
all specialists **in one message** (parallel `Agent` calls). If you can't convene sub-agents in your
environment (no `Agent` access, or you're already running as a sub-agent), don't abort — take each
needed perspective yourself in sequence (explore as that role, then synthesize, then a self-challenge
pass), applying the same roster logic and guarantees. Give each a `name` (so you can reach
them later) and a `subagent_type` — `qa-engineer`/`test-strategist` for the disciplines,
`general-purpose` for stack roles. Their prompt gets: the priming (stack roles only — the discipline
agents already carry their own expertise), the full feature, the gates/build-steps you found, and
the rule that this is planning — propose, don't implement, don't commit. Ask each to report back
roughly: where the change lands, the committable slices they propose (and what each tests, at which
level, and which gates/build-steps it triggers), dependencies, risks, and any questions for a named
teammate.

**4 — Draft the phases.** Merge the slices into phases that each end in a clean commit, fold any
build step into the phase whose edits trigger it, and check every acceptance criterion lands
somewhere. Share it as a short outline, not the full plan.

**5 — Hold the discussion (you chair).** This is the meeting. Route the real tensions between the
named specialists with `SendMessage` (re-engage the same agents so they keep context and build on
each other) — but if you took the **self-play fallback** in step 3 (no `Agent`/`SendMessage`
access, so there are no live sub-agents to reach), there's no one to message: run these same
tensions as sequential self-challenge passes instead, arguing each side in turn. When one questions
another's area — a data shape, an API contract, a testability
problem — relay it and bring the answer back. Let them resolve it; you arbitrate only what they
can't, and you record the tradeoff. `qa-engineer` presses on requirement coverage; `test-strategist`
presses on whether each phase's tests assert the real behavior and are TDD-feasible. Match the rounds
to the real tension — a complex feature may need several exchanges, a simple one little beyond a
sanity check; don't manufacture debate where there's no disagreement. If something hasn't converged
in about two exchanges, you decide and note why. **The room doesn't adjourn until every specialist
signs off; the QA and test sign-off is required.**

**6 — Write the plan.** This is your own final act — don't delegate it. Read
[plan-template.md](plan-template.md), fill it with the agreed output, and `Write` it to
`<feature-name>-plan.md` in the repo root. Match the detail to the feature: for a small feature keep
tasks terse (a line or two each; skip the optional sub-agent prompts and long field lists). But
**every phase, however small, must keep the load-bearing skeleton that a downstream executor
(`/base:implement-plan`) parses** — trim detail, never these:

- a numbered `## Phase N: <title>` header (so phases can be ordered and detected);
- a `> **Delivers**:` line;
- a `> **Gates that must pass to commit**:` blockquote naming the **real commands** you discovered
  (e.g. `pytest tests/unit`, `npm run lint`), and a `> **Project-specific steps triggered**:`
  blockquote (codegen/migration/mock updates, or "none");
- a final commit step whose `git commit -m "<subject>"` holds the **verbatim, stable** subject the
  executor will commit with (keep it exact — it's matched against git history to detect
  already-done phases);
- a Higher-Level Tests step **only when** the phase has integration/E2E work (its presence is the
  signal to write & run them).

The meeting is not done until the file exists on disk.

**7 — Adjourn.** Confirm the plan file was actually written (the work isn't finished until it is),
confirm the sign-offs, release the specialists (tear down the team if you created one), output
`Plan saved to: <path>`, and stop. Don't begin implementation.

## What must hold (the rest is the team's judgment)

Verify these before saving and fix any violation — they're the reason the meeting exists. Everything
they don't pin down (how many phases, how to slice, the ordering inside a phase, which extra
specialists to seat) is the team's call, guided by the recommended phase shape in the template.

- **Requirements are covered**: every acceptance criterion maps to at least one phase, and
  `qa-engineer` signed off that the plan builds the *right* thing.
- **The test strategy is sound**: tests assert the specific behavior (not a proxy) and are written to
  fail for the right reason before the code exists, and `test-strategist` signed off.
- **Each phase ships clean**: it commits green against the gates you discovered, with tests and the
  code they pin landing in the same phase, and any build step sequenced before what depends on it.
- **The plan is in the right format**: it follows the template and is saved as `<feature-name>-plan.md`.
- **The plan is right-sized**: as detailed as the feature warrants and no more. A few short phases
  with light per-phase detail is the *correct* outcome for a small feature, not a thoroughness gap;
  reserve deep scaffolding for features that genuinely need it.

## If something stalls

- A specialist goes quiet: re-engage once; if still silent, proceed without it and note the gap.
- No consensus after ~2 exchanges: you decide and document the tradeoff.
- A hard blocker: stop, release the team, and escalate to the user with what you learned.
