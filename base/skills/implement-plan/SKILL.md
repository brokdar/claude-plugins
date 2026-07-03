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
   - `verifyOnly: true` (optional) — implement nothing; run only the whole-feature verification
     against the plan's acceptance criteria. Requires every phase to already be committed — if any
     phase isn't, the run returns `note: "verify-only-blocked"` with the pending phase numbers
     instead of verifying. Use it to restore the final safety net after phases were finished
     manually (see "After it returns").
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

- **Always build `args` as an actual JSON object yourself — never pass `$ARGUMENTS` through
  verbatim as a string.** If the user (or a slash-command wrapper) asked for specific phases in
  plain words ("focus on Phase 1", "just phase 2", "phases 2-4"), that is exactly what
  `onlyPhase`/`fromPhase`/`toPhase` are for — translate it into the object before calling
  `Workflow`. Do this even when a command's auto-generated hint suggests invoking with a raw
  string; that hint is a convenience echo of the command text, not a validated call.
- The script *does* also parse a bare string arg (plan path + common scoping phrases like the
  ones above) as a safety net for hand-launches or older callers, but that is a fallback, not a
  substitute for building the object yourself — freeform phrasing it doesn't recognize (unusual
  wording, multiple disjoint ranges, etc.) still falls through to "no window found," which means
  every pending phase runs. **When you built the args yourself as an object, this doesn't apply.**
- Omit `spec` if there isn't a separate spec file. Omit the window fields to run all pending phases.
- The workflow runs in the background; you'll get a notification when it finishes. Watch live
  progress with `/workflows`. For anything narrower than "all pending phases," it's worth a quick
  non-blocking `TaskOutput` check a few seconds after launch — the first line the script logs is
  `Launch args: raw=... parsed=... → window [...]`; confirm the window matches what you intended
  before letting a long unattended run continue.

## After it returns

Report the outcome from the workflow's result:

- **Completed**: list the phases committed (with their SHAs) and relay the final whole-feature
  verification verdict if one was produced.
- **Hard-stopped** (`stoppedAt`): surface the phase and the reason — `"qa"` (failed QA after the
  fix loop: relay the `qa-engineer`'s gaps and what needs a human decision), `"implement-failed"`
  (the developer agent died twice, usually transient API trouble — re-launching resumes at that
  phase, but see the tree-hygiene rule below first), or `"commit-failed"` (the phase is QA-approved
  but uncommitted — the tree needs a human look before anything else runs). Do **not** silently
  retry the whole run on a `"qa"` stop.

  **Tree hygiene before any re-launch:** check `git status` first. A relaunch snapshots every
  currently-dirty file as *pre-existing* and excludes it from all phase commits — so a dead
  attempt's partial, uncommitted work must be reverted/stashed (or the phase finished by hand)
  before re-launching, or the redone phase will silently commit without those files.
- **Nothing to do / scoped**: say which phases were already committed or skipped.

**If the run was recovered manually** (a hard-stop or crash made you — or the user — finish the
remaining phases by hand): once every phase is committed, re-launch the workflow with
`args: { plan: "<plan.md>", verifyOnly: true }`. The whole-feature verification is the one gate
that sees cross-phase issues (duplicate work between phases, one surface breaking another), and a
manual takeover otherwise silently drops it.

Do not re-run phases the workflow already committed; to redo a committed phase, the user must revert
its commit first (the workflow intentionally won't clobber committed work).
