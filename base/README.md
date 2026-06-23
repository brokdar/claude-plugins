# base

The opinionated general dev-workflow baseline you want in every repository — feature speccing,
bug reporting, team-based feature planning, a QA verification gate, issue-closing PR shipping, and a
destructive-git + secrets-read safety net.

## Components

| Component | Name | What it does |
|---|---|---|
| Skill | `/base:feature-specify` | Iteratively turns a vague feature idea into a complete, implementation-ready spec through clarification questions and forced decisions, then files it as a GitHub issue (label `feature`). |
| Skill | `/base:bug-report` | Investigates a bug systematically (or pressure-tests a diagnosis you already have), then files a trustworthy report — observed vs. expected, what was checked and how, root cause as a labelled hypothesis — as a GitHub issue (label `bug`). |
| Skill | `/base:feature-plan` | Convenes a dynamic team of specialists to turn a spec/description into a rock-solid, incremental, TDD-first implementation plan where every phase commits clean. |
| Skill | `/base:implement-plan` | Executes an existing phased plan end to end, fire-and-forget: per phase a developer (TDD) → `qa-engineer` gate → a commit of that phase alone. Launches the bundled `implement-plan` workflow. |
| Skill | `/base:push-pr` | Pushes the current branch and opens a pull request whose body explains the *why* (intent / what changed; for bugs: root cause, fix, consequences) and closes the originating issue. Does not commit; leaves out test plans (CI/CD covers that). |
| Agent | `qa-engineer` | A validation gate that judges delivered behavior against the spec/requirements and issues a per-requirement PASS/FAIL verdict before you merge or ship. |
| Agent | `test-strategist` | Designs the test strategy with a built-in testing ethic — each test must assert the *specific* claim and fail for the right reason, not pass on a proxy. |
| Workflow | `implement-plan` | The orchestration script behind `/base:implement-plan`. Stack-neutral; reads each phase's gates and build steps from the plan. |
| Hook | `block-destructive-git` (PreToolUse) | Blocks destructive git commands run via Bash. |
| Hook | `block-env-read` (PreToolUse) | Blocks reading a real `.env` secrets file through any tool (Read/Edit/Write/Grep/Bash), while allowing `.env.example`-style templates. |

### Skill: `/base:feature-specify`

Note the namespacing — once installed, the skill is invoked as `/base:feature-specify`. Pass an
optional feature idea as an argument, or let it ask. It runs a discovery loop (clarify → force
scoping decisions → detail requirements → validate), then **publishes the spec as a GitHub issue**
labelled `feature`. The template leads with *intent (why we need this) / what it does / why it's
useful*, followed by scope, user stories, and requirements.

### Skill: `/base:bug-report`

Invoked as `/base:bug-report`, with an optional "what's broken" description as the argument (or let
it pull the bug from the current conversation — a failed test, a thrown error). It detects one of
two entry modes:

- **Investigate** — you want help *finding* the problem ("help me figure out what's going wrong").
  It drives a systematic debugging loop with the repo in front of it: reproduce → localize → form a
  *falsifiable* hypothesis → test the cheapest discriminating check → confirm the root cause, reading
  real code paths and recent diffs rather than guessing.
- **Verify** — you already did the legwork and paste a diagnosis. It does **not** redo the
  investigation; it independently checks your evidence, hunts for *disconfirming* signals, and gives a
  calibrated verdict (confirmed / partly right / wrong direction) before discussing — dropping into
  full investigation only if the diagnosis doesn't hold.

Both modes converge on a lean, free-prose report that answers a fixed set of questions — what's the
issue (expected vs. actual, with the verbatim error/behaviour/screenshot), how to reproduce it and
how we investigated, the suspected root cause and how we concluded it, and how confident we are —
then **publish it as a GitHub issue** labelled `bug`. The reproduction is
first-class: the shortest steps or failing test that triggers the bug, so the fixer can confirm it,
verify the fix, and build a regression test. There's no severity/environment/triage boilerplate to
pad out; the one hard rule is keeping observation (fact) separate from conclusion (inference), so the
evidence stays trustworthy even if the diagnosis is later proven wrong.

### Output: GitHub issue, with a `docs/` fallback

Both spec skills publish to a **GitHub issue** by default (via `gh`) rather than leaving a markdown
file in the repo — a spec is most useful where the team already tracks work. The shared procedure
lives in `skills/_shared/publish-spec.md`:

1. Check `gh` is installed, authenticated, and the repo has a reachable GitHub remote.
2. Ensure the label exists (`bug` is built in; `feature` is created if missing), then
   `gh issue create` with the right label and the filled template as the body.
3. **Fallback** — if any check fails (no `gh`, invalid auth, or no GitHub remote), write the spec to
   `docs/feature_<slug>.md` or `docs/bug_<slug>.md` instead, and tell the user *why* it degraded so
   they can fix auth / add a remote and re-run to get a real issue.

### Skill: `/base:feature-plan`

Invoked as `/base:feature-plan`, with an optional spec file or feature description as the argument
(pairs naturally with `feature-specify`'s output). You act as the **facilitator** of a planning
meeting: it scouts the repo to learn the stack and the repo's own quality gates, convenes only the
specialists the feature actually needs (data, API, UI, plus the always-seated `qa-engineer` and
`test-strategist`), chairs a discussion where they challenge each other, and writes a phased
`<feature-name>-plan.md`. It is **stack-neutral** — there's no fixed agent roster and no hardcoded
build commands; stack specialists are primed dynamically, and each phase's "commit clean" bar and
any project-specific steps (codegen, migrations, mock updates) are discovered from your repo.

### Skill: `/base:implement-plan`

Invoked as `/base:implement-plan`, with the plan file as the argument (optionally a spec file and a
phase window like "phase 2" or "phases 2-4"). It pairs naturally with `feature-plan`'s output: hand
it the `<feature>-plan.md` and it runs the plan to completion without supervision. For each
not-yet-committed phase it spawns one developer agent (TDD), gates the result through `qa-engineer`
with a bounded fix↔re-QA loop, then commits **only that phase's own files**; it hard-stops on any
phase that can't go green and runs a whole-feature verification at the end once everything is
committed. "Already done" is read from `git log` (not the plan's ✅ markers), and pre-existing dirty
files are snapshotted and kept out of every commit, so re-running is safe.

It works by launching the bundled `implement-plan` **workflow** — plugins can't auto-register
workflows, so the skill calls it explicitly.

### Skill: `/base:push-pr`

Invoked as `/base:push-pr` once the work is committed. It **pushes the current branch and opens a
PR — it does not commit** (if the tree is dirty it stops and tells you to commit first). It picks the
PR body from the issue label: a **feature** PR states the intent and what changed; a **bug** PR states
the root cause, the fix, and the consequences — and it omits any test/validation section, since CI/CD
covers that. It finds the originating issue (from `$ARGUMENTS`, the branch/commit `#refs`, or `gh
issue list`) and adds `Closes #N` so merging resolves it. Optional argument: an issue number or a base
branch.

### Workflow: `implement-plan`

The orchestration script at `workflows/implement-plan.js`. It's **stack-neutral**: it never hardcodes
a test framework, linter, codegen, or integration runner. Each phase's gates and project-specific
build steps are read from the plan (the format `/base:feature-plan` produces), so the same workflow
drives a Python, JS, Go, or any-stack plan unchanged.

`/base:implement-plan` is the normal way to run it. To launch it directly (e.g. from your own
orchestration), call the `Workflow` tool with its path and JSON args:

```text
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/implement-plan.js",
  args: { plan: "<feature>-plan.md", spec: "<feature>.md", onlyPhase: 2 }
})
```

`plan` is required; `spec` and the phase window (`onlyPhase` / `fromPhase` / `toPhase`) are optional.
The parse and verification agents inherit sensible model tiers pinned in the script (parse on the
lighter tier, implement/QA/verify on the stronger one); edit the `model:` options to change them.

### Agent: `qa-engineer`

Appears in `/agents` as `qa-engineer`. It validates that the **right thing** was built — not just
that tests pass — judging each requirement against the source of truth and returning APPROVED /
REJECTED with evidence. It does not pin a model (inherits your session model) and uses
project-scoped memory.

### Agent: `test-strategist`

Appears in `/agents` as `test-strategist`. It designs *how* a feature should be tested — what to
test, at which level, and the exact assertion each test must make — with a testing ethic baked in:
a test must prove, not assume. It asserts the specific claim (that *the* missing item is missing,
not merely that a count dropped), exercises the feature the way it's actually used, and rejects
tests that can't fail for a real reason. Used by `/base:feature-plan`, and useful standalone for
planning or auditing a test suite. Inherits your session model; uses project-scoped memory.

### Hook: destructive-git safety net

A `PreToolUse` hook on `Bash` that blocks destructive git operations before they run, including:

- `git push --force` / `git push -f`
- `git reset --hard`
- `git checkout -- ` / bulk `git restore` discards
- `git clean -f`
- `git branch -D` (force delete)
- any command using `--no-verify` to bypass git hooks

When blocked, Claude is told to use the safe alternative or ask you to confirm.

> The hook runs `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/block-destructive-git.py`. Python 3 must be
> available on your PATH.

### Hook: block-env-read

A `PreToolUse` hook on `Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Bash` that blocks access to a
real `.env` secrets file before it happens, across every vector:

- File tools (`Read`/`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) targeting a `.env` path — this
  covers both **reading** secrets and **writing/overwriting** a real `.env` (Edit/Write are blocked
  too, so the model can't clobber or recreate one)
- `Grep` via its `path` or `glob`
- `Bash` commands that reference a `.env` file (`cat`, `grep`, `source`, redirects, `vim`, etc.)

Template files (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`) are allowed through.
When blocked, Claude is told to ask the user for the value directly or read a `.env.example`
template instead.

> The hook runs `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/block-env-read.py`. Python 3 must be available
> on your PATH.

## Install

```text
/plugin marketplace add brokdar/claude-plugins
/plugin install base@claude-plugins
```

Replace `brokdar/claude-plugins` with the actual GitHub `owner/repo` if it differs.

## Test locally (no marketplace needed)

```text
claude --plugin-dir ./base
```

Then verify: `/base:feature-specify`, `/base:bug-report`, `/base:feature-plan`, `/base:implement-plan`,
and `/base:push-pr` run, `/agents` lists `qa-engineer` and `test-strategist`, and the git hook blocks
`git push --force` and `git commit --no-verify`.
