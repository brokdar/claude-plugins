---
name: push-pr
description: Push the current branch and open a pull request that closes its originating GitHub issue, with a body explaining the why (for a feature — intent and what changed; for a bug — root cause, the fix, and the consequences). Use when the work is already committed and it's time to push and open a PR — "push pr", "open a pull request", "raise a PR", "ship this branch", or right after /base:implement-plan. Does NOT commit, and omits test/validation plans (CI/CD covers that).
argument-hint: "[issue-number | base-branch]"
---

## Context

Run these and read the output before acting:

- `git status`
- `git branch --show-current`
- `git log <base>..HEAD --stat` and `git diff <base>...HEAD` — the full commit messages (the decision record) and the actual changes across the whole feature
- `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` — the base branch (override with `$ARGUMENTS` if a base was passed)

## Your task

The commits are already done — do **NOT** commit. Push the branch and open the PR, in this exact sequence:

1. If `HEAD` is the default branch, stop — there is no feature branch to PR. If the working tree is dirty, stop and tell the user to commit first (those changes won't be in the PR).
2. Find the originating issue: use `$ARGUMENTS` if given, else a `#N` reference in the branch name or the branch's commit messages, else `gh issue list`. Read it with `gh issue view <N>` for the intent and its label (`feature` vs `bug`). If there is genuinely no issue, skip the `Closes` line.
3. Push: `git push -u origin HEAD`.
4. Write the PR body to a temp file using the template below that matches the issue label. End it with `Closes #<N>`. Do not add a "Testing" / "How to validate" section. Fill `## Notes` by actively comparing the issue's intent against what actually shipped — pull in any decision/tradeoff recorded in the commit messages, plus any deviation you spot between the spec and the diff (built X instead of the specified Y, scope trimmed, an approach changed). Omit the section only if that comparison genuinely turns up nothing.
5. Open the PR: `gh pr create --base <base> --title "<concise, specific title>" --body-file <tmpfile>`. If a PR for this branch already exists, report it instead of creating a duplicate.
6. Report the PR URL.

## PR body templates

Include `## Notes` only when there is something real to record — a genuine decision/tradeoff, or a
point where the implementation **deviated from or refined the original spec/issue**. Omit the section
entirely when there's nothing worth saying; don't pad it.

**Feature:**

```markdown
## Why
<The intent: the problem this solves and what we set out to build.>

## What changed
<What actually shipped, grounded in the real diff.>

## Notes
<Decisions and tradeoffs, or where this deviated from / refined the original spec. Omit if none.>

Closes #<N>
```

**Bug:**

```markdown
## Root cause
<What was actually causing the bug.>

## The fix
<How it was fixed.>

## Impact
<What happened while the bug was live — who/what was affected and how it showed up.>

## Notes
<Decisions and tradeoffs, or anything a reviewer should know that the diff and issue don't show. Omit if none.>

Closes #<N>
```
