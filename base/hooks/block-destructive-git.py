#!/usr/bin/env python3
# PreToolUse hook (Bash matcher): block destructive git commands.
# Reads JSON on stdin, extracts tool_input.command, and prints
# {"decision":"block","reason":"..."} to stdout (exit 0) on the first match.

import json
import sys


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        return
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return

    cmd = data.get("tool_input", {}).get("command") or ""
    if not cmd:
        return

    def block(reason: str) -> None:
        print(json.dumps({"decision": "block", "reason": reason}))
        sys.exit(0)

    # "git push -f " keeps its trailing space: it matches the flag, not "-force".
    if (
        "git push --force" in cmd
        or "git push -f " in cmd
        or ("git push " in cmd and (" --force" in cmd or " -f " in cmd))
    ):
        block("Force push blocked. Use regular push or ask the user to confirm.")
    if "git reset --hard" in cmd:
        block(
            "Hard reset blocked — this discards uncommitted work. "
            "Use 'git stash' or ask the user to confirm."
        )
    if "git checkout -- " in cmd or "git restore --staged --worktree" in cmd:
        block(
            "Bulk discard blocked — this throws away uncommitted changes. "
            "Ask the user to confirm."
        )
    if "git clean -f" in cmd:
        block(
            "git clean blocked — this permanently deletes untracked files. "
            "Ask the user to confirm."
        )
    if "git branch -D " in cmd or ("git branch " in cmd and " -D" in cmd):
        block(
            "Force branch delete blocked. "
            "Use -d (safe delete) or ask the user to confirm."
        )
    if "--no-verify" in cmd:
        block(
            "Bypassing git hooks with --no-verify is not allowed. "
            "Fix the issues instead."
        )


if __name__ == "__main__":
    main()
