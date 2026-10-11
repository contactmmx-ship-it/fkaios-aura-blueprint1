"""Offline unit tests for fkaios-local-worker.py; never call Ollama or Supabase."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

WORKER_PATH = pathlib.Path(__file__).with_name("fkaios-local-worker.py")
SPEC = importlib.util.spec_from_file_location("fkaios_local_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(worker)


class LocalWorkerTests(unittest.TestCase):
    def test_inference_parses_openai_compatible_ollama_response(self):
        with patch.object(worker, "ALLOWED_MODELS", {"qwen2.5:7b"}), patch.object(
            worker, "http_json", return_value={
                "id": "mock-response",
                "choices": [{"message": {"content": "LOCAL_OK"}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3},
            }
        ) as request:
            result = worker.infer({
                "model": "qwen2.5:7b",
                "system_prompt": "Return a token",
                "user_content": "LOCAL_OK",
                "max_tokens": 12,
            })
        self.assertEqual(result["content"], "LOCAL_OK")
        self.assertEqual(result["provider"], "self_hosted")
        self.assertEqual(result["model"], "qwen2.5:7b")
        self.assertEqual(result["input_tokens"], 12)
        self.assertEqual(result["output_tokens"], 3)
        self.assertEqual(result["evidence"]["transport"], "outbound_local_worker")
        self.assertTrue(request.called)

    def test_rejects_model_outside_allowlist_before_network(self):
        with patch.object(worker, "ALLOWED_MODELS", {"qwen2.5:7b"}), patch.object(
            worker, "http_json"
        ) as request:
            with self.assertRaisesRegex(RuntimeError, "model_not_allowlisted"):
                worker.infer({"model": "unapproved-model", "user_content": "hello"})
        request.assert_not_called()

    def test_rejects_empty_prompt(self):
        with patch.object(worker, "ALLOWED_MODELS", {"qwen2.5:7b"}), patch.object(
            worker, "http_json"
        ) as request:
            with self.assertRaisesRegex(RuntimeError, "empty_prompt"):
                worker.infer({"model": "qwen2.5:7b"})
        request.assert_not_called()

    def test_rejects_invalid_or_empty_model_response(self):
        with patch.object(worker, "ALLOWED_MODELS", {"qwen2.5:7b"}), patch.object(
            worker, "http_json", return_value={"choices": [{"message": {"content": ""}}]}
        ):
            with self.assertRaisesRegex(RuntimeError, "invalid_model_response"):
                worker.infer({"model": "qwen2.5:7b", "user_content": "hello"})


if __name__ == "__main__":
    unittest.main()
