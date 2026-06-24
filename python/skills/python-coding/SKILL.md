---
name: python-coding
description: Python coding judgment a linter can't enforce — comment intent, exception design, logging conventions, and anti-patterns to avoid. Applies when editing Python source files.
paths:
  - "**/*.py"
user-invocable: false
---

A ruff + type-check gate runs on stop. Produce gate-clean code the **first time** using
the checklist below so the gate stays quiet — then apply the judgment beneath it, which
the gate can't check.

**Defer to the project.** The gate runs the *repo's own* ruff / type-check config (or, for
ruff, the plugin's bundled `ruff.toml` only when the repo defines none), so that config —
not this skill — is the real bar. The items below are sensible defaults;
where the repo has an opinion, it wins. If its `pyproject.toml` / `ruff.toml` sets a rule
set, line length, or docstring convention, or its modules use a particular typing or
logging style, follow that and mirror nearby files. Never introduce a convention the repo
doesn't already use.

## Gate-clean checklist — write it this way first time (unless the repo differs)

- **Types** *(universal)*: annotate every function (args + return) and module-level
  variable. Prefer `X | None`, `list[str]`, `dict[str, int]` over `Optional`/`List`/`Dict`
  and avoid bare `Any` — unless the repo's existing typing style differs.
- **Imports** *(universal)*: all at the top of the file, grouped stdlib / third-party /
  local. (A deliberate lazy import to break a cycle or guard an optional dependency is the
  rare, commented exception.)
- **Exceptions** *(universal)*: catch the specific type — never bare `except` or
  `except Exception`. Re-raise with `raise ... from e`.
- **Logging**: use the repo's logging library (structlog, stdlib `logging`, loguru…).
  Never pass an f-string into a log call, and don't use `print()` for application logging.
- **Docstrings**: on public modules, classes, and functions, in the repo's convention
  (Google / NumPy / reST — check `[tool.ruff.lint.pydocstyle]` or a nearby module).
- Leave no commented-out code behind.

## Comments — WHY, never WHAT

- Comment sparingly; most code should be self-explanatory.
- Comment only the WHY: reasoning, constraints, workarounds. Never the WHAT.
- If a comment is needed to explain WHAT code does, refactor the code to be clearer instead.
- FORBIDDEN: `# Check if admin`, `# Increment counter`, `# Create user`, `# Return result`
- ACCEPTABLE: `# Batch size 500: memory issues >1000, perf degrades <100`,
  `# Workaround for upstream bug v2.1.0 — remove after v2.2.0`

## Exception design

- Design specific exception classes that carry full context: what failed, where, why, and the actual values.
- Never return `None` to signal failure — raise.

## Logging conventions

- Never log secrets (passwords, tokens) — whatever the library.
- If the project uses **structlog**: bind structured `snake_case` `verb_noun` events
  (`logger.info("user_created", user_id=user.pk)`); use DEBUG for diagnostics, INFO for
  business events, WARNING for concerning states; don't log ERROR directly — let
  exceptions propagate to the central handler.

## Anti-patterns to avoid

- No backward-compatibility wrappers — delete deprecated code immediately rather than shimming around it.
- No over-engineered abstractions (`AbstractFactoryBuilderStrategy`). Build the simplest thing that works, then improve.
- Fix root causes, not symptoms.
