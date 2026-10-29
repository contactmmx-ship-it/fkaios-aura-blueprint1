#!/usr/bin/env python3
"""Assemble the full migration history for `supabase db push` (CI workspace only, never committed).

Why: production's ledger records the versions under which changes were really applied. Their files
live in supabase/live-snapshot/migrations (written by sync-production-snapshot), while hand-written
forward migrations live in supabase/migrations. `db push` reads one directory and refuses to run when
a recorded version has no local file, so the preview step failed on every run.

What it does, in the CI checkout only:
  1. copies live-snapshot migration files into supabase/migrations (never overwriting a file);
  2. moves aside files the CLI cannot track one-to-one: versions that are not 14 digits, and second
     files that share a version with another file. Every one of these is either comment-only or its
     effect is already recorded in production under a live version (ledger reconcile, 29 Oct 2026).

Prints what it did. Exit code 0 always unless the directories are missing.
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORWARD = ROOT / "supabase" / "migrations"
LIVE = ROOT / "supabase" / "live-snapshot" / "migrations"
ASIDE = ROOT / "supabase" / ".migrations-set-aside"
PATTERN = re.compile(r"^(\d+)_(.+)\.sql$")


def assemble(forward: Path = FORWARD, live: Path = LIVE, aside: Path = ASIDE) -> dict:
    if not forward.is_dir():
        sys.exit(f"missing {forward}")
    copied, moved = [], []
    live_names = set()
    if live.is_dir():
        for f in sorted(live.glob("*.sql")):
            live_names.add(f.name)
            target = forward / f.name
            if not target.exists():
                shutil.copy2(f, target)
                copied.append(f.name)
    by_version: dict = {}
    for f in sorted(forward.glob("*.sql")):
        m = PATTERN.match(f.name)
        if not m or len(m.group(1)) != 14:
            aside.mkdir(parents=True, exist_ok=True)
            shutil.move(str(f), aside / f.name)
            moved.append(f.name)
            continue
        by_version.setdefault(m.group(1), []).append(f)
    for version, files in by_version.items():
        if len(files) < 2:
            continue
        keep = next((f for f in files if f.name in live_names), files[0])
        for f in files:
            if f is not keep:
                aside.mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), aside / f.name)
                moved.append(f.name)
    return {"copied": copied, "moved_aside": moved}


if __name__ == "__main__":
    result = assemble()
    print(f"Copied {len(result['copied'])} live-snapshot file(s) into supabase/migrations.")
    print(f"Set aside {len(result['moved_aside'])} file(s) the CLI cannot track:")
    for name in result["moved_aside"]:
        print(f"  - {name}")
