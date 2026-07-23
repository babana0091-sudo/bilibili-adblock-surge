#!/usr/bin/env python3
"""Validate bilibili-adblock.sgmodule script-path isolation & integrity.

Rules:
1. Every script-path must be absolute https raw.githubusercontent.com URL
   (relative js/*.js fails on remote Surge modules → 资源不存在).
2. On branch main / dev (or GITHUB_REF), all script-path must reference
   THAT same branch segment (.../main/js/... or .../dev/js/...).
3. No cross-branch references (main must not use /dev/, dev must not use /main/).
4. Referenced js files must exist in the working tree.
5. #!version must be present and non-empty.
6. Argument keys must be ASCII alphanumeric/underscore (no Chinese keys).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "bilibili-adblock.sgmodule"
REPO = "babana0091-sudo/bilibili-adblock-surge"
RAW_PREFIX = f"https://raw.githubusercontent.com/{REPO}/"

SCRIPT_PATH_RE = re.compile(r"script-path\s*=\s*([^,\s]+)")
VERSION_RE = re.compile(r"^#!version=(.+)$", re.M)
ARGS_RE = re.compile(r"^#!arguments=(.+)$", re.M)


def git_branch() -> str:
    env = os.environ.get("VALIDATE_BRANCH") or os.environ.get("GITHUB_REF_NAME")
    if env:
        return env.strip()
    # pull_request: GITHUB_HEAD_REF / GITHUB_BASE_REF
    head = os.environ.get("GITHUB_HEAD_REF")
    if head:
        return head.strip()
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=ROOT,
            text=True,
        ).strip()
        if out and out != "HEAD":
            return out
    except Exception:
        pass
    return "unknown"


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def main() -> int:
    errors: list[str] = []
    if not MODULE.is_file():
        fail(f"missing {MODULE}")
        return 1

    text = MODULE.read_text(encoding="utf-8")
    branch = git_branch()
    print(f"validate: branch={branch}")
    print(f"validate: module={MODULE}")

    # version
    vm = VERSION_RE.search(text)
    if not vm or not vm.group(1).strip():
        errors.append("#!version missing or empty")
    else:
        print(f"validate: version={vm.group(1).strip()}")

    # argument keys ASCII
    am = ARGS_RE.search(text)
    if am:
        for part in am.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            key = part.split(":", 1)[0].strip()
            if not re.fullmatch(r"[A-Za-z0-9_]+", key):
                errors.append(f"non-ASCII/invalid argument key: {key!r}")

    paths = SCRIPT_PATH_RE.findall(text)
    if not paths:
        errors.append("no script-path found")
    print(f"validate: script-path count={len(paths)}")

    expected_branch_seg = None
    if branch in ("main", "dev"):
        expected_branch_seg = branch

    for raw in paths:
        path = raw.strip().strip('"').strip("'")
        print(f"  - {path}")

        # must be absolute raw URL
        if path.startswith("js/") or not path.startswith("https://"):
            errors.append(
                f"script-path must be absolute raw URL (not relative): {path}"
            )
            continue
        if not path.startswith(RAW_PREFIX):
            errors.append(
                f"script-path must be under {RAW_PREFIX}: {path}"
            )
            continue

        rest = path[len(RAW_PREFIX) :]  # e.g. main/js/checkin.js
        parts = rest.split("/")
        if len(parts) < 3 or parts[1] != "js":
            errors.append(f"unexpected raw path shape: {path}")
            continue
        ref = parts[0]  # main or dev
        fname = "/".join(parts[1:])  # js/checkin.js

        if ref not in ("main", "dev"):
            errors.append(f"script-path ref must be main or dev, got {ref!r}: {path}")

        if expected_branch_seg and ref != expected_branch_seg:
            errors.append(
                f"cross-branch script-path on branch {expected_branch_seg}: {path}"
            )

        # forbid explicit wrong pair when we know both
        if expected_branch_seg == "main" and "/dev/js/" in path:
            errors.append(f"main module must not reference /dev/js/: {path}")
        if expected_branch_seg == "dev" and "/main/js/" in path:
            errors.append(f"dev module must not reference /main/js/: {path}")

        local = ROOT / fname
        if not local.is_file():
            errors.append(f"local file missing for script-path: {fname}")
        else:
            # basic JS syntax if node available
            pass

    # node --check all js
    js_dir = ROOT / "js"
    if js_dir.is_dir():
        for js in sorted(js_dir.glob("*.js")):
            try:
                r = subprocess.run(
                    ["node", "--check", str(js)],
                    capture_output=True,
                    text=True,
                )
                if r.returncode != 0:
                    errors.append(f"node --check failed: {js.name}: {r.stderr.strip()}")
                else:
                    print(f"validate: syntax ok {js.name}")
            except FileNotFoundError:
                print("validate: node not found, skip syntax check")
                break

    if errors:
        print("\nFAILED:", file=sys.stderr)
        for e in errors:
            fail(e)
        return 1
    print("\nOK: module script-path isolation validated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
