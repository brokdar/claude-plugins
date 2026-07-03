# Plan Document Template

The facilitator reads this at plan-writing time (Step 6) and fills it in with the agreed team
output. Write the completed plan to `<feature-name>-plan.md` in the repository root.

This template is **scalable** — it's the *full* shape, not a checklist to exhaust. Use as much of it
as the feature warrants: a small, straightforward feature might be just a title, two or three short
phases, and a coverage check — skip the dependency overview, progress table, and per-task
scaffolding. Only large or risky features need the whole structure. Match the detail to the feature;
never pad a simple plan to fill the template.

**But always keep, in every phase even a trimmed one** — a downstream executor
(`/base:implement-plan`) parses these, so dropping them breaks automated execution:

- the numbered `## Phase N: <title>` header;
- a `> **Delivers**:` line;
- the `> **Gates that must pass to commit**:` blockquote (naming the **real** discovered commands)
  and the `> **Project-specific steps triggered**:` blockquote (or "none");
- a final Phase Commit step whose `git commit -m "<subject>"` subject is **verbatim and stable**
  (it's matched against git history to detect already-completed phases);
- a Higher-Level Tests step **when** the phase has integration/E2E work.

Status markers (⬜/✅) are cosmetic — git history is the source of truth — so don't rely on them.

This template is also **stack-neutral**. Two things are filled in from what the lead discovered, not
assumed:

- **Gates** — wherever a phase says "passes the repo's gates," list the actual checks discovered in
  Step 1 (the commit/CI/lint/type/test commands that would block a merge in *this* repo).
- **Project-specific build steps** — codegen, client/type regeneration, migrations, mock/fixture
  updates, asset builds, etc. appear only in the phases whose edits trigger them. If the repo has
  none, the plan simply omits them. Do not invent steps the repo doesn't actually need.

---

````markdown
# Feature Implementation Plan: [Feature Name]

> **Source**: [feature description / spec file path]
> **Branch**: feature/[feature-name-slug]
> **Team**: [specialists convened, e.g. "Data Architect · API Architect · QA Engineer · Test Strategist"]
> **Repo gates** (each phase must pass these to commit clean): [the actual checks discovered — e.g. "unit tests, lint, type-check, build"]

## Status Legend

| Symbol | Meaning |
| ------ | ------- |
| ⬜ | Not Started |
| 🔄 | In Progress |
| ✅ | Completed |
| ⏸️ | Blocked |
| 🔀 | Parallelizable (independent sub-agents eligible) |

---

## Setup

### Task 0: Branch Creation

- **Status**: ⬜
- **Command**: `git checkout -b feature/[feature-name-slug]`
- **Verification**: branch exists and is checked out

---

## Phase 1: [Slice Name] → commit

> **Delivers**: [the meaningful increment this phase adds]
> **Gates that must pass to commit**: [the repo's discovered gates relevant to these changes]
> **Project-specific steps triggered**: [only those this phase's edits require — codegen / migration / mock update / …; "none" if so]

<!--
  RECOMMENDED PHASE SHAPE — a sensible default, not a mandate. Shape the phase around the
  feature; keep the underlying principle, drop any step that doesn't apply, reorder if the
  work genuinely calls for it:
    1.1 Write the tests this phase needs → confirm they fail FOR THE RIGHT REASON
    1.2 Implement
    1.3 Any project-specific build step triggered by 1.2's edits (codegen / migration / mock or
        fixture update) — sequenced before anything that depends on it
    1.4 Higher-level tests (integration / end-to-end) if this phase warrants them — usually sequential
    1.5 Commit — clean against the repo's gates

  Why this order: a test that hasn't been seen to fail proves nothing; build steps that other work
  depends on must finish before that work; the broadest, slowest tests come last because they need
  everything else in place.
-->

### Step 1.1: Write Tests [🔀 independent tests can be written in parallel]

#### Task 1.1.a: [Component A] Tests

- **Status**: ⬜
- **Parallelizable**: Yes (independent of 1.1.b)
- **Files to Create**: `[test file paths]`
- **Test Cases** (each names the *specific* claim it asserts — per the test strategy):
  - [ ] `[test name]`: asserts [the specific thing]; fails when [the real defect]
  - [ ] `[edge/error case]`: asserts [the specific thing]
- **Verification**: tests exist and FAIL for the right reason (no implementation yet)
- **Sub-agent Prompt**:
  ```
  Write [test-framework] tests for [Component A]. They MUST fail initially — no implementation
  exists yet — and each must assert the specific behavior, not a proxy. Cases: [from test strategy].
  ```

#### Task 1.1.b: [Component B] Tests

- **Status**: ⬜
- **Parallelizable**: Yes (independent of 1.1.a)
- **Files to Create**: `[test file paths]`
- **Verification**: tests exist and FAIL for the right reason

### Step 1.2: Implement [🔀 independent components can be done in parallel]

#### Task 1.2.a: Implement [Component A]

- **Status**: ⬜
- **Dependencies**: Task 1.1.a ✅
- **Files to Create/Modify**: `[paths]`
- **Implementation Requirements**:
  - [ ] [requirement]
- **Verification**: all Task 1.1.a tests pass; relevant repo gates clean

### Step 1.3: Project-Specific Build Step [⚠️ only if this phase's edits trigger one]

<!-- Omit entirely if nothing in this phase triggers a build step. Examples: regenerate a client
     from changed schemas, run a migration for a changed model, update mocks/fixtures for a changed
     contract. Sequence before any step that depends on its output. -->

#### Task 1.3.1: [Build step name]

- **Status**: ⬜
- **Dependencies**: Step 1.2 ✅
- **Trigger**: [the edit that requires this — e.g. "schema changed"]
- **Command / Action**: [discovered command, or how it's verified if a hook does it automatically]
- **Verification**: [expected result]

### Step 1.4: Higher-Level Tests [⚠️ sequential — only if this phase warrants them]

<!-- Omit if this phase has no integration/end-to-end scenarios worth covering here.
     Run one runner at a time where resources or shared state demand it. -->

#### Task 1.4.1: Write & Run [Integration / E2E] Tests

- **Status**: ⬜
- **Parallelizable**: NO
- **Dependencies**: Steps 1.2 (and 1.3 if applicable) ✅
- **Files to Create**: `[paths]`
- **Scenarios** (each asserts the real behavior, exercised as it's actually used):
  - [ ] [scenario]: [what it proves]
- **Verification**: written, confirmed failing for the right reason, then passing

### Step 1.5: Phase Commit

- **Status**: ⬜
- **Dependencies**: all preceding steps in this phase ✅
- **Pre-commit checklist** (the repo's discovered gates):
  - [ ] [gate 1 — e.g. unit tests pass]
  - [ ] [gate 2 — e.g. lint/format clean]
  - [ ] [gate 3 — e.g. type-check / build passes]
- **Command**: `git add [files] && git commit -m "[type]([area]): [description]"`

---

## Phase 2: [Next Slice Name] → commit

<!-- Repeat the structure for each subsequent slice. Each phase includes only the steps it needs.
     The number of phases follows the feature — design them around cohesive increments. -->

---

## QA Coverage Matrix

| Acceptance Criterion | Verified In Phase(s) | Status |
| -------------------- | -------------------- | ------ |
| [Criterion 1]        | Phase 1              | ⬜     |
| [Criterion 2]        | Phase 2              | ⬜     |

---

## Decisions Log

<!-- Every judgment call the room arbitrated — what was chosen, over what, and why — so a reader
     can audit tradeoffs without replaying the meeting. The facilitator surfaces the 3-5
     highest-leverage entries to the user at adjourn. -->

| # | Decision | Chosen over | Why |
| - | -------- | ----------- | --- |
| 1 | [what was decided] | [the alternative] | [tradeoff rationale] |

---

## Dependency Overview

```
[Task 0: Branch]
       │
       ▼
[Phase 1: Slice] ──(1.1 tests → 1.2 impl → [1.3 build step] → [1.4 higher tests] → 1.5 commit)
       │
       ▼
[Phase 2: Slice] → commit
       │
       ▼
     [...]
```

---

## Progress Tracking

| Phase     | Description  | Contains                          | Tasks   | Completed | Status |
| --------- | ------------ | --------------------------------- | ------- | --------- | ------ |
| Setup     | Branch       | —                                 | 1       | 0         | ⬜     |
| Phase 1   | [Slice name] | tests + impl + [build] + [higher] | [N]     | 0         | ⬜     |
| Phase 2   | [Slice name] | …                                 | [N]     | 0         | ⬜     |
| **Total** |              |                                   | **[X]** | **0**     |        |

---

## Execution Notes

- **After each phase**: the commit is done and the repo is clean and passing. Update this file's
  statuses. A later session can read this file to resume.
- **Parallelization**: within a phase, tasks with no shared files and no data dependency can be
  delegated to sub-agents in parallel. Keep sequence-sensitive work (migrations, codegen chains,
  heavy integration/e2e runners, the commit itself) ordered.
- **Sub-agents must not commit** or modify this plan file; the main agent verifies their output
  before marking tasks complete.

---

## Change Log

| Change       | Notes                          |
| ------------ | ------------------------------ |
| Plan Created | Team: [specialists convened]   |
````
