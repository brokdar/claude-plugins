#!/usr/bin/env python3
# PostToolUse hook: best-effort redaction of secret VALUES when reading a
# .env.<suffix> variant file (.env.local, .env.test, .env.production, ...).
#
# The companion PreToolUse hook (block-env-read.py) hard-blocks the bare `.env`
# file. The variants are allowed through so configs / test settings can be read,
# but any assignment whose KEY looks secret (contains TOKEN/PASSWORD/KEY/SECRET
# and friends) has its VALUE replaced with [REDACTED] before the model sees it.
#
# This is a safety net, not a guarantee: it is name-based (it trusts the var
# name to advertise that its value is sensitive) and cannot catch a secret
# stored under an innocuous name. It deliberately over-redacts (e.g. PUBLIC_KEY)
# rather than risk leaking.
#
# Mechanism: PostToolUse reads the hook JSON on stdin, and when it redacts
# something it prints
#   {"hookSpecificOutput": {"hookEventName": "PostToolUse",
#                           "updatedToolOutput": "<redacted text>", ...}}
# which REPLACES the tool result the model receives. When nothing matches it
# prints nothing, so the original output passes through untouched.
#
# Covered vectors (must target a .env.<suffix> variant):
#   - Read            -> re-reads tool_input.file_path raw, redacts, replaces
#   - Bash / Grep     -> redacts the command's stdout (tool_response)

import json
import os
import re
import sys

# Substrings that, when present in a variable NAME, mark its value as secret.
SECRET_KEYWORDS = (
    "PASSWORD",
    "PASSWD",
    "PASSPHRASE",
    "PWD",
    "SECRET",
    "TOKEN",
    "APIKEY",
    "KEY",            # API_KEY, SECRET_KEY, PRIVATE_KEY, ACCESS_KEY, ...
    "CREDENTIAL",     # CREDENTIAL / CREDENTIALS
    "PRIVATE",
    "SIGNATURE",
    "SIGNING",
    "SALT",
)

# Names that contain a secret keyword but are NOT secrets and should pass
# through: publishable by definition (a public key), an identifier or location
# rather than the value itself (a key id / path / file), or a reference to a
# secret store (the ARN/name, not the secret). Matched case-insensitively, as
# the whole name or as a trailing `_`-delimited segment (so AWS_PUBLIC_KEY and
# API_KEY_ID are covered too). Checked BEFORE the keyword match.
SAFE_NAMES = (
    "PUBLIC_KEY",
    "KEY_ID",
    "KEY_PATH",
    "KEYFILE",
    "KEY_FILE",
    "KEY_NAME",
    "SECRET_NAME",
    "SECRET_ARN",
    "TOKEN_URL",
    "TOKEN_ENDPOINT",
    "TOKEN_EXPIRY",
    "TOKEN_TTL",
)

REPLACEMENT = "[REDACTED]"

# Matches `KEY=value` style assignments (the env-file shape) on a single line.
# Tolerates a leading prefix so it still fires on `cat -n` line numbers
# ("   5\tAPI_KEY=..."), `grep -n` filename prefixes ("file:3:API_KEY=...")
# and `export `. Only the value (everything after `=`) is replaced.
SECRET_ASSIGN_RE = re.compile(
    r"(?im)^(?P<pre>.*?)"
    r"(?P<key>[A-Za-z0-9_]*(?:" + "|".join(SECRET_KEYWORDS) + r")[A-Za-z0-9_]*)"
    r"(?P<sep>\s*=\s*)"
    r"(?P<val>\S.*)$"
)

# A shell command references a dotenv VARIANT (.env.<x> / .env-<x>), not bare .env.
BASH_VARIANT_RE = re.compile(r"\.env[.\-][A-Za-z0-9_.\-]+", re.IGNORECASE)


def is_env_variant_path(path: str) -> bool:
    """True if `path`'s basename is a .env.<suffix> / .env-<suffix> variant."""
    if not path:
        return False
    base = os.path.basename(str(path).replace("\\", "/")).lower()
    return base.startswith(".env.") or base.startswith(".env-")


def is_safe_name(key: str) -> bool:
    """True if `key` is a known non-secret despite containing a keyword."""
    upper = key.upper()
    return any(upper == safe or upper.endswith("_" + safe) for safe in SAFE_NAMES)


def redact(text: str):
    """Return (redacted_text, count). Replaces secret values with REDACTED.

    `count` is the number of values ACTUALLY redacted — safe-name matches that
    are left intact do not count, so callers don't replace output needlessly.
    """
    if not text:
        return text, 0

    redactions = [0]

    def _sub(m: "re.Match") -> str:
        if is_safe_name(m.group("key")):
            return m.group(0)  # known non-secret: leave the value intact
        redactions[0] += 1
        return f"{m.group('pre')}{m.group('key')}{m.group('sep')}{REPLACEMENT}"

    redacted = SECRET_ASSIGN_RE.sub(_sub, text)
    return redacted, redactions[0]


def extract_text(resp):
    """Pull the textual payload out of a PostToolUse `tool_response`."""
    if isinstance(resp, str):
        return resp
    if isinstance(resp, dict):
        for k in ("stdout", "content", "output", "result", "text"):
            v = resp.get(k)
            if isinstance(v, str):
                return v
        f = resp.get("file")
        if isinstance(f, dict) and isinstance(f.get("content"), str):
            return f["content"]
    if isinstance(resp, list):
        parts = [
            item["text"]
            for item in resp
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        if parts:
            return "\n".join(parts)
    return None


def emit(redacted: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "updatedToolOutput": redacted,
            "additionalContext": (
                "Secret values in this .env variant were redacted by the base "
                "plugin (name-based, best-effort). Ask the user for any value "
                "you actually need."
            ),
        }
    }))


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

    text = None

    if tool in ("Read", "Edit", "MultiEdit", "NotebookEdit"):
        path = ti.get("file_path") or ti.get("notebook_path") or ""
        if is_env_variant_path(path):
            # Re-read raw so redaction is independent of how the tool framed it.
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                text = extract_text(data.get("tool_response"))

    elif tool == "Grep":
        if is_env_variant_path(ti.get("path", "")) or is_env_variant_path(ti.get("glob", "")):
            text = extract_text(data.get("tool_response"))

    elif tool == "Bash":
        cmd = ti.get("command") or ""
        if cmd and BASH_VARIANT_RE.search(cmd):
            text = extract_text(data.get("tool_response"))

    if text is None:
        return

    redacted, count = redact(text)
    if count > 0:
        emit(redacted)


if __name__ == "__main__":
    main()
