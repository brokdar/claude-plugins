#!/usr/bin/env python3
# PreToolUse hook: block reading secrets out of a .env file via any vector.
#
# Reads the hook JSON on stdin, inspects tool_name + tool_input, and prints
# {"decision": "block", "reason": "..."} (exit 0) the moment it sees an attempt
# to read a real .env file. Template files (.env.example/.sample/.template/.dist)
# are allowed through.
#
# Covered vectors:
#   - Read / Edit / Write / MultiEdit / NotebookEdit  -> tool_input.file_path
#   - Grep                                            -> tool_input.path / glob
#   - Bash  (cat, grep, less, more, head, tail, sed, awk, cut, strings, od, xxd,
#            nl, source, ".", export $(cat .env), redirects, vim/nano, etc.)

import json
import os
import re
import sys

# Basenames that are conventionally placeholder templates, not real secrets.
TEMPLATE_BASENAMES = {
    ".env.example",
    ".env.sample",
    ".env.template",
    ".env.dist",
}

# Matches a real dotenv reference inside a shell command, but not templates and
# not unrelated words like ".environment". Case-insensitive for .ENV etc.
BASH_ENV_RE = re.compile(
    r"\.env\b(?!\.(?:example|sample|template|dist)\b)",
    re.IGNORECASE,
)


def is_env_secret_path(path: str) -> bool:
    """True if `path` points at a real .env secrets file (not a template)."""
    if not path:
        return False
    base = os.path.basename(str(path).replace("\\", "/")).lower()
    if base in TEMPLATE_BASENAMES:
        return False
    return (
        base == ".env"
        or base.startswith(".env.")
        or base.startswith(".env-")
        or base.endswith(".env")
    )


def block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}))
    sys.exit(0)


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        return
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return

    tool = data.get("tool_name") or ""
    ti = data.get("tool_input") or {}

    advice = (
        " Reading it would expose environment variables / secrets to the model. "
        "Ask the user for the value directly, or read a .env.example template instead."
    )

    # Path-based tools: Read, Edit, Write, MultiEdit, NotebookEdit, Grep.
    for field in ("file_path", "path", "notebook_path"):
        if is_env_secret_path(ti.get(field, "")):
            block(f"Blocked: {tool} on a .env secrets file.{advice}")

    # Grep can also target .env through its glob.
    if is_env_secret_path(ti.get("glob", "")):
        block(f"Blocked: {tool} glob targeting a .env secrets file.{advice}")

    # Shell: any command that references a real .env file.
    cmd = ti.get("command") or ""
    if cmd and BASH_ENV_RE.search(cmd):
        block(
            "Blocked: shell command references a .env secrets file." + advice
        )


if __name__ == "__main__":
    main()
