#!/usr/bin/env python3
"""Stop hook: type-check changed Python files.

Mirrors the ruff gate. Uses the checker the project configures (deferring to its own
config); otherwise the first available of pyrefly / ty / mypy with the plugin's bundled
strict config. Runs the project's install when present, else ephemeral ``uvx`` — and on
uvx runs adds the checker's tolerate-missing-imports flag, since an ephemeral tool can't
see the project's installed deps.

A fast, changed-files heads-up — NOT the authoritative gate: a type checker is
whole-project by nature and (especially under uvx) can't resolve every import, so keep
the full check on pre-commit/CI. Exit 2 feeds errors back. No-ops when no checker and no uv.
"""

from __future__ import annotations

import subprocess
import sys

from _pyenv import (
    ROOT,
    TYPE_CHECKERS,
    bundled_config,
    changed_py_files,
    project_typechecker,
    tool_or_uvx,
)


def _resolve() -> tuple[dict, list[str], list[str], bool] | None:
    """(spec, cmd_prefix, config_args, used_uvx) for the checker to run, or None."""
    configured = project_typechecker()
    if configured is not None:
        resolved = tool_or_uvx(configured["name"])
        if resolved is None:
            return None  # they chose it but it isn't runnable — stay quiet
        cmd_prefix, used_uvx = resolved
        return (configured, cmd_prefix, [], used_uvx)  # defer to the project's own config

    for spec in TYPE_CHECKERS:
        resolved = tool_or_uvx(spec["name"])
        if resolved is None:
            continue
        cmd_prefix, used_uvx = resolved
        cfg = bundled_config(spec["bundled"])
        config_args = [spec["config_flag"], str(cfg)] if cfg is not None else []
        return (spec, cmd_prefix, config_args, used_uvx)
    return None


def main() -> None:
    files = changed_py_files()
    if not files:
        return
    resolved = _resolve()
    if resolved is None:
        return
    spec, cmd_prefix, config_args, used_uvx = resolved

    tolerate = spec["tolerate"] if used_uvx else []
    cmd = [*cmd_prefix, *spec["argv"], *config_args, *tolerate, *files]
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    if proc.returncode != 0:
        print(
            f"Type errors in changed Python files ({spec['name']}) — fix before stopping:\n"
            + (proc.stdout + proc.stderr)[:6000],
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
