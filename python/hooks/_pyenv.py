#!/usr/bin/env python3
"""Shared helpers for the python plugin's stop-hook gates.

Stack-neutral: discovers the project root, resolves tools (project install first,
then ephemeral ``uvx``), lists changed Python files, detects which lint/type config
the project defines, and locates the plugin's bundled fallback configs. Imported by
path, so this module lives next to the gate scripts.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def _project_dir() -> Path:
    # ${CLAUDE_PROJECT_DIR} is exported into hook processes; fall back to the git
    # toplevel, then cwd, so the script also works when run outside a hook.
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env)
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip())
    except OSError:
        pass
    return Path.cwd()


ROOT = _project_dir()


def changed_py_files() -> list[str]:
    """Changed/added .py files (repo-relative). New dirs are expanded; deletions dropped.

    Parses ``--porcelain -z`` rather than ``--short``: the NUL-separated format keeps
    paths with spaces or non-ASCII chars intact (``--short`` would split or git-quote
    them), and renames/copies arrive as ``XY <dest>\\0<source>\\0`` so we take the
    destination and skip the trailing source token.
    """
    res = subprocess.run(
        ["git", "-C", str(ROOT), "status", "--porcelain", "-uall", "-z"],
        capture_output=True,
        text=True,
    )
    tokens = res.stdout.split("\0")
    files: list[str] = []
    i = 0
    while i < len(tokens):
        entry = tokens[i]
        if not entry:
            i += 1
            continue
        status, path = entry[:2], entry[3:]
        # Renames/copies emit a second NUL-separated token (the source); skip it.
        i += 2 if status[0] in ("R", "C") else 1
        if path.endswith(".py"):
            files.append(path)
    return [f for f in files if (ROOT / f).is_file()]


_uv: bool | None = None


def _has_uv() -> bool:
    global _uv
    if _uv is None:
        _uv = shutil.which("uv") is not None and (ROOT / "pyproject.toml").is_file()
    return _uv


def tool_cmd(tool: str) -> list[str] | None:
    """An argv prefix to run a LOCAL ``tool`` (``uv run`` in uv projects, else PATH), or None.

    Probes with ``--version`` so a tool that isn't a declared dependency under
    ``uv run`` is skipped rather than reported as a failure.
    """
    candidates: list[list[str]] = []
    if _has_uv():
        candidates.append(["uv", "run", "--quiet", tool])
    if shutil.which(tool):
        candidates.append([tool])
    for cmd in candidates:
        try:
            probe = subprocess.run(
                [*cmd, "--version"], cwd=str(ROOT), capture_output=True, text=True, timeout=120
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if probe.returncode == 0:
            return cmd
    return None


def tool_or_uvx(tool: str) -> tuple[list[str], bool] | None:
    """``(argv-prefix, used_uvx)`` for ``tool``: a local install first, else ephemeral uvx.

    ``uvx`` / ``uv tool run`` fetch the latest tool on demand (uv-cached), so a gate
    runs even when the tool isn't installed — as long as ``uv`` is. Returns None when
    neither a local install nor uv is available. Only safe for tools that don't need
    the project's deps (ruff, type checkers); NOT for pytest. To pin a version, append
    ``@<version>`` to the tool name at the uvx call site.
    """
    local = tool_cmd(tool)
    if local is not None:
        return (local, False)
    if shutil.which("uvx"):
        return (["uvx", tool], True)
    if shutil.which("uv"):
        return (["uv", "tool", "run", tool], True)
    return None


def ruff_cmd() -> list[str] | None:
    """Invoke ruff: project install first, else ephemeral uvx (ruff is a standalone
    static analyzer — an ephemeral copy works because it needs no project deps).
    """
    resolved = tool_or_uvx("ruff")
    return resolved[0] if resolved is not None else None


def _plugin_root() -> Path:
    env = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if env:
        return Path(env)
    # Fallback when run outside a hook: this file lives in <plugin>/hooks/.
    return Path(__file__).resolve().parent.parent


def bundled_config(rel: str) -> Path | None:
    """A config file bundled with the plugin (e.g. 'ruff.toml', 'mypy.ini'), or None."""
    cfg = _plugin_root() / rel
    return cfg if cfg.is_file() else None


def bundled_ruff_config() -> Path | None:
    return bundled_config("ruff.toml")


def repo_has_ruff_config() -> bool:
    """True if the project defines its own ruff config — then we defer to it entirely."""
    if (ROOT / "ruff.toml").is_file() or (ROOT / ".ruff.toml").is_file():
        return True
    pyproject = ROOT / "pyproject.toml"
    if pyproject.is_file():
        try:
            return "[tool.ruff" in pyproject.read_text(encoding="utf-8")
        except OSError:
            return False
    return False


# Type checkers in fallback-preference order. pyrefly/ty are standalone (no project
# deps needed); mypy needs them, so it's last. `argv` is the subcommand before files;
# `config_flag` points the tool at an explicit config; `tolerate` suppresses missing-
# import errors and is added only on ephemeral uvx runs (which lack the project's deps).
TYPE_CHECKERS: list[dict] = [
    {
        "name": "pyrefly",
        "argv": ["check"],
        "config_flag": "--config",
        "bundled": "pyrefly.toml",
        "tolerate": ["--ignore-missing-imports", "*"],
        "files": ["pyrefly.toml"],
        "sections": [("pyproject.toml", "[tool.pyrefly]")],
    },
    {
        "name": "ty",
        "argv": ["check"],
        "config_flag": "--config-file",
        "bundled": "ty.toml",
        "tolerate": ["-c", 'analysis.allowed-unresolved-imports=["**"]'],
        "files": ["ty.toml"],
        "sections": [("pyproject.toml", "[tool.ty]")],
    },
    {
        "name": "mypy",
        "argv": [],
        "config_flag": "--config-file",
        "bundled": "mypy.ini",
        "tolerate": ["--ignore-missing-imports"],
        "files": ["mypy.ini", ".mypy.ini"],
        "sections": [("pyproject.toml", "[tool.mypy]"), ("setup.cfg", "[mypy]")],
    },
]


def _has_section(path: Path, section: str) -> bool:
    if not path.is_file():
        return False
    try:
        return section in path.read_text(encoding="utf-8")
    except OSError:
        return False


def project_typechecker() -> dict | None:
    """The checker the project configures (first match in preference order), or None."""
    for spec in TYPE_CHECKERS:
        if any((ROOT / f).is_file() for f in spec["files"]):
            return spec
        if any(_has_section(ROOT / fname, section) for fname, section in spec["sections"]):
            return spec
    return None
