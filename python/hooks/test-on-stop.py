#!/usr/bin/env python3
"""Stop hook: run pytest for changed Python files.

Runs changed test files directly, and maps a changed source file to its test by stem
(``foo.py`` -> ``test_foo.py`` / ``foo_test.py``) when one exists in the repo. Skips
integration/e2e tests, which usually need external services. Exit 2 blocks stopping on
failure. No-ops if pytest isn't available or nothing maps to a test.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from _pyenv import ROOT, changed_py_files, tool_cmd

_TEST_NAME = re.compile(r"^test_.*\.py$|.*_test\.py$|^conftest\.py$")
_SKIP_DIRS = re.compile(r"(^|/)(integration|e2e)(/|$)")


def _is_test(path: str) -> bool:
    return bool(_TEST_NAME.match(Path(path).name)) or "/tests/" in f"/{path}"


def _all_test_files() -> list[str]:
    res = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "*.py"],
        capture_output=True,
        text=True,
    )
    return [p for p in res.stdout.splitlines() if _is_test(p)]


def _resolve(changed: list[str]) -> list[str]:
    by_stem: dict[str, list[str]] = {}
    for t in _all_test_files():
        by_stem.setdefault(Path(t).stem, []).append(t)

    selected: set[str] = set()
    for f in changed:
        if _is_test(f):
            selected.add(f)
            continue
        stem = Path(f).stem
        for cand in (f"test_{stem}", f"{stem}_test"):
            selected.update(by_stem.get(cand, []))

    return sorted(s for s in selected if (ROOT / s).is_file() and not _SKIP_DIRS.search(s))


def main() -> None:
    changed = changed_py_files()
    if not changed:
        return
    tests = _resolve(changed)
    if not tests:
        return
    pytest = tool_cmd("pytest")
    if pytest is None:
        return

    proc = subprocess.run([*pytest, *tests, "-q"], cwd=str(ROOT))
    if proc.returncode != 0:
        print("Tests failing for changed Python files — fix before stopping.", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
