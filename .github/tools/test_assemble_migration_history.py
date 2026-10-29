import tempfile
import unittest
from pathlib import Path

from assemble_migration_history import assemble


def touch(d: Path, name: str, body: str = "select 1;"):
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(body)


class AssembleTest(unittest.TestCase):
    def test_copies_live_files_and_sets_aside_untrackable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fwd, live, aside = root / "m", root / "live", root / "aside"
            touch(fwd, "20260629_old_short_version.sql")
            touch(fwd, "20260713006000_first.sql")
            touch(fwd, "20260713006000_second.sql")
            touch(fwd, "20261029090311_forward.sql", "forward")
            touch(live, "20260628132610_live_only.sql")
            touch(live, "20261029090311_forward.sql", "live copy")
            r = assemble(fwd, live, aside)
            names = sorted(p.name for p in fwd.glob("*.sql"))
            self.assertEqual(names, ["20260628132610_live_only.sql", "20260713006000_first.sql", "20261029090311_forward.sql"])
            self.assertEqual((fwd / "20261029090311_forward.sql").read_text(), "forward")  # never overwritten
            self.assertEqual(sorted(r["moved_aside"]), ["20260629_old_short_version.sql", "20260713006000_second.sql"])
            self.assertEqual(r["copied"], ["20260628132610_live_only.sql"])

    def test_keeps_the_live_named_file_when_versions_collide(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fwd, live, aside = root / "m", root / "live", root / "aside"
            touch(fwd, "20261012145521_a_hand_written.sql")
            touch(live, "20261012145521_b_live.sql")
            assemble(fwd, live, aside)
            self.assertEqual(sorted(p.name for p in fwd.glob("*.sql")), ["20261012145521_b_live.sql"])


if __name__ == "__main__":
    unittest.main()
