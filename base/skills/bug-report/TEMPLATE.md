<!--
This is the BODY of the report — it becomes the GitHub issue body verbatim. Don't add a top-level
`# H1` title (the bug summary is the issue's title field) or a date/status footer (GitHub tracks
that). When this falls back to a file, publish-spec.md prepends the title as an `# H1`.

Fill these in as free prose — write what you actually have, keep it tight, and skip a line if it
genuinely doesn't apply. The headings are the questions the report must answer, not a form to pad.
The one hard rule: keep observation (fact — what was seen) separate from conclusion (inference —
what we think causes it).
-->

> One-line summary of what's broken.

## What's the issue?

**Expected:** what we expected it to do.

**Actual:** what it actually does instead.

**Error / evidence:** the real error message or stack trace (quoted verbatim), the observed wrong
behaviour, or a screenshot / log snippet. This is fact — what was seen, not the suspected cause.

## How to reproduce & investigate

The shortest steps, command, or failing test that triggers it — so the fixer can see it themselves,
confirm it's gone once fixed, and build a regression test around it. ("Run
`pytest tests/auth/test_login.py::test_safari` — fails with the 403 above; should pass once fixed.")

Then what we investigated and how — the scenarios we tried, the commands we ran, the code we read,
the logs or traces we inspected. Enough that someone could retrace it. Note anything we couldn't
check, and if we *couldn't* reproduce it, say so and give the closest we got.

## What we think the root cause is

The suspected cause and the chain from it to the symptom — why this mechanism produces *exactly*
what we saw. Distinguish the root cause from where the symptom merely surfaces. If it isn't proven
yet, say so and give the leading hypothesis rather than a confident guess.

## How we reached that conclusion

The evidence and reasoning that point to that cause — the reproduction, the log/trace, or the
failing test that captures it — and which alternative explanations the evidence killed.

## How confident are we?

How sure we are and what would make us surer — e.g. "High — confirmed by a failing test that goes
green with the fix" or "Medium — fits all the evidence, but we couldn't verify X".
