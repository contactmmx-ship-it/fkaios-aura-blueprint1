#!/usr/bin/env python3
"""Fail when production has a migration the repository does not record.

Usage: check_migration_drift.py LIVE_JSON

LIVE_JSON is a JSON array of objects with at least a "version" key (and
optionally "name"), as returned by the Supabase Management API
(GET /v1/projects/{ref}/database/migrations).

Every live version must have a file named "<version>_*.sql" in
supabase/migrations (the forward history) or supabase/live-snapshot/migrations
(the verbatim record of what production ran). A live version with neither is
an out-of-band change and fails the check. Repo files that are not live are
reported but do not fail: some older files were applied under other versions,
and a merged migration may not have been applied yet.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIRS = [ROOT / "supabase" / "migrations", ROOT / "supabase" / "live-snapshot" / "migrations"]


def repo_versions():
    versions = {}
    for d in DIRS:
        for f in d.glob("*.sql"):
            versions.setdefault(f.name.split("_", 1)[0], []).append(str(f.relative_to(ROOT)))
    return versions


def main():
    live = json.loads(pathlib.Path(sys.argv[1]).read_text())
    if not isinstance(live, list) or not live:
        print("::error::live migration list is empty or malformed")
        return 1
    recorded = repo_versions()
    live_versions = {str(m["version"]): m.get("name", "") for m in live}

    missing = sorted(v for v in live_versions if v not in recorded)
    for v in missing:
        print(f"::error::production migration {v} ({live_versions[v]}) is not recorded in the repo")

    forward = {f.name.split("_", 1)[0]: f.name for f in DIRS[0].glob("*.sql")}
    not_live = sorted(v for v in forward if v not in live_versions)
    for v in not_live:
        print(f"note: {forward[v]} has no production migration with the same version")

    print(f"{len(live_versions)} live migrations, {len(missing)} unrecorded, {len(not_live)} repo files not live by version")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
