# python — Claude Code plugin

Stack-neutral Python standards as **two layers that deliberately don't overlap**:

- **Skills teach the judgment** a linter can't check — path-scoped, auto-applied while you edit Python.
- **Hooks enforce the mechanics** a tool *can* check, at the stop gate — running your repo's *own* `ruff` / `pyrefly`|`mypy` / `pytest`.

The split is the point: anything a linter can verify lives in the hook (deterministic, costs nothing until it fires, matches your commit/CI bar); only the judgment a tool *can't* verify lives in the skills. Each skill also opens with a compact **"gate-clean checklist"** — the surface forms the gate checks — so the agent writes compliant code the first time and the stop-gates rarely fire. That bounded overlap is deliberate: a 12-line checklist is far cheaper than a write → gate-fails → re-edit-everything roundtrip at the end of a turn.

**The skills defer to your project.** Both the hooks and the skills respect the repo's own config: the hooks run *your* ruff / type-check / pytest, and the skills mark which rules are universal vs. project-dependent (docstring convention, logging library, mocking library, typing style) and tell the agent to follow the repo's `pyproject.toml` / `ruff.toml` and existing code over any default. They won't steer toward a style your project doesn't use. The bundled `ruff.toml` is opt-in and never overrides your config.

## Components

### Skills (auto-applied by file path)

- **`python-coding`** — applies to `**/*.py`. Comment intent (WHY, not WHAT), exception design, structlog conventions, anti-patterns, and a one-line strict-type-hint reminder.
- **`python-testing`** — applies to test files (`test_*.py`, `*_test.py`, `tests/**`, `conftest.py`). `mocker`/`AsyncMock(spec=)` patterns, `pytest.raises(match=)`, the fixture-scope and "before you write a test" decision trees, edge-case + naming conventions, TDD import-safety, and SQL-structure assertions.

Both use the skill `paths:` frontmatter, so they load automatically only when you're working with matching files — the plugin-native equivalent of path-scoped rules. They're `user-invocable: false` (background knowledge, not commands).

> **Version note:** requires a Claude Code version that supports the `paths` skill frontmatter field. Verify with a quick `--plugin-dir` load before relying on the auto-apply behavior.

### Hooks (Stop gate, changed files only)

On every stop, for the Python files you changed in the turn:

- **`format-on-stop`** — `ruff check --fix` + `ruff format`; blocks stop on unfixable lint. Uses the repo's own ruff config, falling back to the bundled `ruff.toml` only when the repo defines none. Runs the project's ruff if installed, else ephemeral `uvx ruff` (so the lint gate works even without ruff installed, as long as `uv` is). ruff alone gets this treatment — the type-checker and pytest need the project's installed deps, so they can't run from an ephemeral environment.
- **`typecheck-on-stop`** — `pyrefly`, `ty`, or `mypy`; a fast scoped heads-up, blocks stop on type errors. Uses the checker your project configures (deferring to its config), else the first available with the plugin's bundled strict config. Like ruff, it falls back to ephemeral `uvx` when the checker isn't installed — and on uvx runs it tolerates unresolved imports (an ephemeral env has no project deps), so it still checks annotations without import noise.
- **`test-on-stop`** — `pytest` for changed test files and the tests mapped to changed sources; blocks stop on failure.

**Tool resolution** — each gate prefers the project's tool (`uv run <tool>` in uv projects, else a PATH binary). ruff and the type checkers additionally fall back to ephemeral `uvx <tool>` when not installed (they need no project deps); **pytest does not** — it needs your installed deps to import the code, so it no-ops when absent. **Config resolution** — every gate runs your repo's *own* config when present; only when the repo defines none does ruff / the type-checker fall back to the plugin's bundled config.

> Requires a Python interpreter on PATH to execute the hook scripts. The hooks probe
> `python3`, then `python`, then the `py` launcher, so any one of them works (relevant on
> Windows, where the official installer provides `python`/`py` but not `python3`). If none
> is found, each gate prints a notice and is skipped rather than blocking.

## Install

```
/plugin marketplace add brokdar/claude-plugins
/plugin install python@dev-workflow-plugins
```

## Bundled fallback configs

The plugin ships strict configs that apply **only when your repo defines none** for that tool — it never overrides a config you already have:

- **`ruff.toml`** — maps each standard the skills teach (annotation, exception, logging, import, docstring rules) to a stable ruff rule.
- **`pyrefly.toml` / `ty.toml` / `mypy.ini`** — strict type-checker configs (max annotation coverage, Any-leakage flags), each tolerant of unresolved imports so they stay clean under ephemeral `uvx`.

For each tool:

- **Repo has its own config** → the plugin **defers to it entirely**; the bundled file is ignored. To also enforce these rules, fold them into your config or point the tool at the bundled file (`ruff --config …`, `mypy --config-file …`, etc.).
- **Repo has no config** → the gate **falls back to the bundled file** automatically, so the standards are enforced out-of-the-box rather than only taught by the skills.

> The type-checker configs are a strong starting point; `ty` in particular is early/preview, so tune its config if a rule proves noisy.
