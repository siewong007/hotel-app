#!/usr/bin/env python3
"""Fail if any relative Markdown link in tracked docs points at a missing file.

Checks every *.md file in the repository (excluding ignored/build/vendor trees)
for `[text](relative/path)` targets that do not exist. External URLs, pure
anchors, and mailto/tel links are skipped — this is a file-existence gate, not
a link crawler.

Exit 0 = clean, 1 = broken links found (each printed as `file -> target`).
"""

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Trees that either aren't documentation or are generated/vendored artifacts.
SKIP_PARTS = {
    "node_modules",
    "target",
    "dist",
    "ds-bundle",
    ".design-sync",
    ".worktrees",
    ".git",
}

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s#]+)(#[^)]*)?\)")
SKIP_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)


def iter_markdown_files():
    for path in ROOT.rglob("*.md"):
        rel = path.relative_to(ROOT)
        if any(part in SKIP_PARTS for part in rel.parts):
            continue
        yield path, rel


def main() -> int:
    broken = []
    checked = 0
    for path, rel in iter_markdown_files():
        checked += 1
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for match in LINK_RE.finditer(text):
            target = match.group(1).strip()
            if not target or target.startswith("#") or SKIP_SCHEME_RE.match(target):
                continue
            target = target.split("#", 1)[0].split("?", 1)[0]
            if not target:
                continue
            if not (path.parent / target).resolve().exists():
                broken.append(f"{rel}: -> {target}")

    if broken:
        print(f"{len(broken)} broken doc link(s) in {checked} files:")
        for line in broken:
            print(f"  {line}")
        return 1
    print(f"doc links OK ({checked} markdown files checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
