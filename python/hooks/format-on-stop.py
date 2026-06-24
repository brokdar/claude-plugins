#!/usr/bin/env python3
"""Stop hook: ruff --fix + format on changed Python files, then gate on what's left.

``ruff check --fix`` fixes and reports leftover violations in a single pass, exiting
non-zero only if unfixable violations remain. ``ruff format`` auto-converges and is
never gated. On leftovers the report goes to stderr and the hook exits 2, which on a
Stop hook blocks stopping and feeds the report back to the agent — so a turn can't end
with code that would fail ``ruff check`` at commit/CI.

Config: defers to the repo's own ruff config when it has one; otherwise falls back to
the plugin's bundled ruff.toml so the standards are enforced even in an unconfigured
repo. Tool: the project's ruff if installed, else ephemeral ``uvx ruff``; no-ops only
when neither ruff nor uv is available.
"""

from __future__ import annotations

import subprocess
import sys

from _pyenv import (
    ROOT,
    bundled_ruff_config,
    changed_py_files,
    repo_has_ruff_config,
    ruff_cmd,
)


def main() -> None:
    files = changed_py_files()
    if not files:
        return
    ruff = ruff_cmd()
    if ruff is None:
        return

    # Repo config wins; bundled ruff.toml only fills in when the repo defines none.
    config: list[str] = []
    if not repo_has_ruff_config():
        bundled = bundled_ruff_config()
        if bundled is not None:
            config = ["--config", str(bundled)]

    proc = subprocess.run(
        [*ruff, "check", *files, *config, "--fix", "--output-format=concise"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    leftover = (proc.stdout + proc.stderr) if proc.returncode != 0 else ""

    # Format last (silent; auto-converges, so it can never block).
    subprocess.run(
        [*ruff, "format", *files, *config, "--quiet"], cwd=str(ROOT), capture_output=True
    )

    if leftover:
        print(
            "Lint issues remain after autofix — these fail at commit/CI. Fix them, then stop:\n"
            + leftover[:6000],
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
