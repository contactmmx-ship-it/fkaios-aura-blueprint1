#!/usr/bin/env python3
"""FKAIOS outbound local inference worker (stdlib only).

The worker makes outbound HTTPS requests to the FKAIOS gateway and calls
Ollama on loopback only. It never needs a Supabase service-role key, never
downloads models, and never opens an inbound port.
"""
from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any

BRIDGE_URL = os.environ.get("FKAIOS_BRIDGE_URL", "").rstrip("/")
BRIDGE_TOKEN = os.environ.get("FKAIOS_LOCAL_WORKER_TOKEN", "")
WORKER_ID = os.environ.get("FKAIOS_LOCAL_WORKER_ID", "windows-ollama-01")
OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")
ALLOWED_MODELS = {
    item.strip()
    for item in os.environ.get("FKAIOS_LOCAL_ALLOWED_MODELS", DEFAULT_MODEL).split(",")
    if item.strip()
}
POLL_SECONDS = max(1, min(30, int(os.environ.get("FKAIOS_LOCAL_POLL_SECONDS", "3"))))
LEASE_SECONDS = 300
MAX_PROMPT_CHARS = 250_000
MAX_OUTPUT_CHARS = 900_000
STOP = threading.Event()


def http_json(url: str, payload: dict[str, Any], timeout: int, token: str | None = None) -> Any:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read(1_100_001)
        if len(raw) > 1_100_000:
            raise RuntimeError("response_too_large")
        return json.loads(raw.decode("utf-8"))


def gateway(payload: dict[str, Any], timeout: int = 20) -> Any:
    return http_json(BRIDGE_URL, {"worker_id": WORKER_ID, **payload}, timeout, BRIDGE_TOKEN)


def heartbeat_loop(job_id: str, lease_token: str, stop: threading.Event) -> None:
    while not stop.wait(45):
        try:
            result = gateway({
                "action": "heartbeat",
                "job_id": job_id,
                "lease_token": lease_token,
                "lease_seconds": LEASE_SECONDS,
            }, timeout=15)
            if not result.get("ok"):
                print(f"job {job_id}: lease lost; stopping heartbeat", flush=True)
                return
        except Exception as exc:
            # Do not log URLs, headers, tokens, prompts, or response bodies.
            print(f"job {job_id}: heartbeat temporarily failed ({type(exc).__name__})", flush=True)


def infer(request: dict[str, Any]) -> dict[str, Any]:
    model = str(request.get("model") or DEFAULT_MODEL)
    if model not in ALLOWED_MODELS:
        raise RuntimeError("model_not_allowlisted")
    system_prompt = str(request.get("system_prompt") or "")
    user_content = str(request.get("user_content") or "")
    if not system_prompt and not user_content:
        raise RuntimeError("empty_prompt")
    if len(system_prompt) + len(user_content) > MAX_PROMPT_CHARS:
        raise RuntimeError("prompt_too_large")

    body = {
        "model": model,
        "messages": [
            *([{"role": "system", "content": system_prompt}] if system_prompt else []),
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "temperature": request.get("temperature", 0.2),
        "max_tokens": min(8192, max(1, int(request.get("max_tokens") or 2048))),
    }
    started = time.monotonic()
    response = http_json(OLLAMA_URL + "/v1/chat/completions", body, timeout=240)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    choices = response.get("choices") or []
    message = choices[0].get("message") if choices else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("invalid_model_response")
    if len(content) > MAX_OUTPUT_CHARS:
        raise RuntimeError("output_too_large")
    usage = response.get("usage") or {}
    return {
        "content": content,
        "provider": "self_hosted",
        "model": model,
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
        "latency_ms": elapsed_ms,
        "evidence": {
            "worker_id": WORKER_ID,
            "transport": "outbound_local_worker",
            "ollama_endpoint": "loopback",
            "response_id": response.get("id"),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    }


def handle_job(job: dict[str, Any]) -> None:
    job_id = str(job.get("id") or "")
    lease_token = str(job.get("lease_token") or "")
    request = job.get("request_payload")
    if not job_id or not lease_token or not isinstance(request, dict):
        print("gateway returned a malformed job; ignoring it", flush=True)
        return

    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=heartbeat_loop, args=(job_id, lease_token, stop_heartbeat), daemon=True
    )
    heartbeat.start()
    try:
        result = infer(request)
        response = gateway({
            "action": "complete",
            "job_id": job_id,
            "lease_token": lease_token,
            "result_payload": result,
        }, timeout=30)
        if not response.get("ok"):
            print(f"job {job_id}: result rejected ({response.get('reason', 'unknown')})", flush=True)
        else:
            print(f"job {job_id}: completed via local model in {result['latency_ms']} ms", flush=True)
    except urllib.error.HTTPError as exc:
        detail = f"ollama_http_{exc.code}" if "ollama" in exc.geturl() else f"http_{exc.code}"
        fail_job(job_id, lease_token, detail, "Local inference HTTP request failed")
    except Exception as exc:
        # Do not persist exception strings: HTTP libraries may include request
        # details. Typed codes are safer and sufficient for bounded retry.
        code = str(exc) if str(exc) in {
            "model_not_allowlisted", "empty_prompt", "prompt_too_large",
            "invalid_model_response", "output_too_large", "response_too_large",
        } else type(exc).__name__.lower()
        fail_job(job_id, lease_token, code, "Local inference failed; details withheld")
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=1)


def fail_job(job_id: str, lease_token: str, code: str, detail: str) -> None:
    try:
        response = gateway({
            "action": "fail", "job_id": job_id, "lease_token": lease_token,
            "error_code": code[:120], "error_detail": detail,
        }, timeout=20)
        print(f"job {job_id}: failed ({response.get('status', response.get('reason', 'unknown'))})", flush=True)
    except Exception as exc:
        print(f"job {job_id}: failure report unavailable ({type(exc).__name__}); lease will expire", flush=True)


def stop_handler(_signum: int, _frame: Any) -> None:
    STOP.set()


def main() -> int:
    if not BRIDGE_URL.startswith("https://"):
        print("ERROR: FKAIOS_BRIDGE_URL must be an HTTPS URL.", file=sys.stderr)
        return 2
    if len(BRIDGE_TOKEN) < 32:
        print("ERROR: set FKAIOS_LOCAL_WORKER_TOKEN to the gateway secret.", file=sys.stderr)
        return 2
    if not WORKER_ID or len(WORKER_ID) > 120:
        print("ERROR: invalid FKAIOS_LOCAL_WORKER_ID.", file=sys.stderr)
        return 2

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)
    print(f"FKAIOS local worker online: {WORKER_ID}; Ollama loopback; models={','.join(sorted(ALLOWED_MODELS))}", flush=True)

    while not STOP.is_set():
        try:
            response = gateway({"action": "claim", "limit": 1, "lease_seconds": LEASE_SECONDS}, timeout=20)
            jobs = response.get("jobs") or []
            if not jobs:
                STOP.wait(POLL_SECONDS)
                continue
            for job in jobs:
                if STOP.is_set():
                    break
                handle_job(job)
        except urllib.error.HTTPError as exc:
            print(f"gateway HTTP error {exc.code}; retrying after backoff", flush=True)
            STOP.wait(min(30, POLL_SECONDS * 3))
        except Exception as exc:
            print(f"gateway unavailable ({type(exc).__name__}); retrying after backoff", flush=True)
            STOP.wait(min(30, POLL_SECONDS * 3))

    print("FKAIOS local worker stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
