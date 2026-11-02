import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from fkaios_history_collector import build_bundle, parse_chatgpt, parse_claude, redact, read_zip

class HistoryCollectorTests(unittest.TestCase):
    def test_chatgpt_export_becomes_conversation(self):
        data = [{
            "id": "c-1", "title": "Pricing decision", "create_time": 1700000000,
            "mapping": {
                "a": {"message": {"author": {"role": "user"}, "create_time": 1700000001,
                                  "content": {"content_type": "text", "parts": ["Keep the approved rate."]}}},
                "b": {"message": {"author": {"role": "assistant"}, "create_time": 1700000002,
                                  "content": {"parts": ["I will preserve it."]}}}
            }
        }]
        rows = parse_chatgpt(data, "conversations.json")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["messages"], 2)
        self.assertIn("Keep the approved rate.", rows[0]["text"])

    def test_claude_export_becomes_conversation(self):
        rows = parse_claude([{"uuid": "c-2", "name": "Launch plan", "chat_messages": [
            {"sender": "human", "text": "Plan the launch."},
            {"sender": "assistant", "text": "First verify the budget."}
        ]}], "claude-export.zip")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["tool"], "Claude")
        self.assertEqual(rows[0]["messages"], 2)

    def test_secret_redaction(self):
        text = redact("token=sk-123456789012345678901234567890")
        self.assertIn("[REDACTED_SECRET]", text)
        self.assertNotIn("sk-123456789012345678901234567890", text)

    def test_zip_path_traversal_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "export.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("../outside.txt", "must not be read")
                z.writestr("notes.txt", "safe note")
            rows = read_zip(archive)
            self.assertEqual(len(rows), 1)
            self.assertIn("safe note", rows[0]["text"])

    def test_bundle_matches_existing_ingest_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Downloads"
            out = Path(tmp) / "ready"
            root.mkdir()
            (root / "notes.txt").write_text("Founder decision: reuse the existing memory.", encoding="utf-8")
            result = build_bundle([root], out)
            self.assertEqual(result["documents"], 1)
            archives = list(out.glob("*.zip"))
            self.assertEqual(len(archives), 1)
            with zipfile.ZipFile(archives[0]) as z:
                manifest = json.loads(z.read("manifest.json"))
                self.assertEqual(set(("id", "title", "date", "p", "n")) - set(manifest[0]), set())
                self.assertIn(manifest[0]["id"] + ".md", z.namelist())
                self.assertEqual(manifest[0]["source_tool"], "Local file")

if __name__ == "__main__":
    unittest.main()
