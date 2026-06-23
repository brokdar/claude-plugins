---
name: implement-plan
description: Implement a phased, TDD-first plan end to end, fire-and-forget — for each phase it runs a developer (TDD), gates the result through the qa-engineer, then commits that phase alone, hard-stopping if a phase can't go green. Use when the user wants to execute or build out an existing implementation plan (e.g. one produced by /base:feature-plan), run a plan to completion, or implement specific phases of a plan. Triggers on "implement the plan", "build out this plan", "run the implementation plan", "do phase N of the plan", or handing over a `<feature>-plan.md` to be executed. (For producing the plan in the first place, that's feature-plan; this skill executes one that already exists.)
argument-hint: "[plan-file.md] [spec-file.md] [phase window e.g. 'phase 2' or 'phases 2-4']"
---

# Implement a Plan (autonomous, phase-by-phase)

This skill runs the bundled `implement-plan` **workflow**, which drives a phased plan to completion
without supervision: it parses the plan into phases, then for each pending phase runs one developer
agent (TDD) → a `qa-engineer` validation gate (with a bounded fix↔re-QA loop of up to 2 cycles) → a
commit of *only* that phase's files. It hard-stops on any phase still REJECTED after those fix cycles,
and runs a whole-feature verification at the end only when the entire plan is committed.

Workflows can't be auto-registered by a plugin, so this skill launches it explicitly via the
`Workflow` tool with its `scriptPath`.

## Before you launch

1. **Confirm there is a plan file.** This skill executes an *existing* plan — it does not write one.
   The argument is `$ARGUMENTS`; if no plan path was given, ask the user for it (or, if they want a
   plan made first, point them at `/base:feature-plan`). The plan should be the phased, TDD-first
   format `/base:feature-plan` produces (per-phase gates, build steps, and a commit per phase).
2. **Resolve the inputs** from `$ARGUMENTS`:
   - `plan` (**required**) — path to the `<feature>-plan.md`.
   - `spec` (optional) — the source-of-truth spec the plan derives from (e.g. the
     `/base:feature-specify` output). If omitted, the plan itself is treated as the source of truth.
   - phase window (optional) — if the user asked for specific phases, map it to **one** of:
     `onlyPhase: K`, `fromPhase: N`, `toPhase: M` (combine `fromPhase`/`toPhase` for a range).
     Default (no window) is every not-yet-committed phase.
3. **Sanity-check git state.** The workflow snapshots pre-existing dirty files and keeps them out of
   every phase commit, and it derives "already done" from `git log` (not the plan's status markers),
   so re-running is safe. Still, tell the user which phases will run before you launch — it's a
   natural checkpoint, and the run commits to the current branch.

## Launch

Call the `Workflow` tool with the script path and the resolved args, for example:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/implement-plan.js",
  args: { plan: "<feature>-plan.md", spec: "<feature>.md", onlyPhase: 2 }
})
```

- Always pass `args` as an actual JSON object (not a stringified one).
- Omit `spec` if there isn't a separate spec file. Omit the window fields to run all pending phases.
- The workflow runs in the background; you'll get a notification when it finishes. Watch live
  progress with `/workflows`.

## After it returns

Report the outcome from the workflow's result:

- **Completed**: list the phases committed (with their SHAs) and relay the final whole-feature
  verification verdict if one was produced.
- **Hard-stopped** (`stoppedAt`): a phase failed QA after the fix loop — surface that phase, the
  `qa-engineer`'s gaps, and what needs a human decision. Do **not** silently retry the whole run.
- **Nothing to do / scoped**: say which phases were already committed or skipped.

Do not re-run phases the workflow already committed; to redo a committed phase, the user must revert
its commit first (the workflow intentionally won't clobber committed work).
