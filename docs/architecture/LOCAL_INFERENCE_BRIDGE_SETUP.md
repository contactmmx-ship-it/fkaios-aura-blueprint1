# Local inference bridge: operator setup

This guide describes the configuration needed after the bridge PR is reviewed and its migration/function are deployed. **Do not set these production secrets until the PR has passed checks and the Windows Ollama preflight has passed.**

## 1. Required hosted configuration

Configure these as Supabase Edge Function secrets (never in frontend environment variables):

- `FKAIOS_LOCAL_INFERENCE_BRIDGE_ENABLED=true` — opts the shared router into the durable queue adapter.
- `FKAIOS_LOCAL_WORKER_TOKEN=<high-entropy random secret, at least 32 characters>` — authenticates only the worker gateway. Generate a fresh value locally and keep it private.
- `SELF_HOSTED_LLM_MODEL=qwen2.5:14b` — exact Ollama model tag; use a smaller installed model if needed.
- Keep `PROVIDER_SELF_HOSTED_ENABLED` unset or set to `true`; setting it to `false` is a hard kill switch.\n- Leave `FKAIOS_ALLOW_CLOUD_FALLBACK` unset for zero-key operation. Setting it to `true` explicitly allows the router to continue to cloud providers after local failure; do not enable it without the required approval/budget policy.

The worker token must be configured in the Edge Function runtime and in the Windows worker environment. It is not a Supabase service-role key. Never put the service-role key on Windows.

The gateway uses custom bearer-token authentication, so it must be deployed with Supabase JWT verification disabled for this function only. Its handler then fails closed unless the dedicated worker token is present and correct. Do not disable JWT verification on other functions as part of this setup.

## 2. Windows worker environment

1. Install Ollama from https://ollama.com/download/windows.
2. Run `scripts/local-ai/verify-ollama.ps1` first. It verifies the model is already installed and local inference works; it does not call paid APIs.
3. Configure the following in the PowerShell session used to start the worker:
   - `FKAIOS_BRIDGE_URL=https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/local-inference-bridge`
   - `FKAIOS_LOCAL_WORKER_TOKEN=<the same dedicated worker token>`
   - `FKAIOS_LOCAL_WORKER_ID=windows-ollama-01`
   - `OLLAMA_MODEL=qwen2.5:14b` (or the exact installed tag)
   - `FKAIOS_LOCAL_ALLOWED_MODELS=qwen2.5:14b` (allowlist exact installed model tags)
4. Run `python scripts/local-ai/fkaios-local-worker.py`.

The worker initiates outbound HTTPS requests. Ollama must remain local on `127.0.0.1:11434`; do not port-forward it or expose it to the internet. The worker does not install/download models and does not require a paid API key.

## 3. Current rollout is intentionally incomplete

The migration, gateway, worker, and router adapter are a staged implementation. They are not production-ready merely because source files exist in a branch. Before enabling the hosted flag, verify:

- migration is applied through the reviewed migration workflow;
- gateway is deployed with `verify_jwt=false` and custom token auth verified;
- secret is configured on the server and Windows without being printed or committed;
- CI covers queue leases, auth failures, retry/expiry, router fallback, and malformed payloads;
- Windows smoke test succeeds;
- end-to-end inference returns a real result and `fkaios_execution_steps` records provider `self_hosted` and the actual model;
- a controlled test proves the tested path succeeds without invoking paid cloud providers.

Until then, leave `FKAIOS_LOCAL_INFERENCE_BRIDGE_ENABLED` unset. This prevents an untested queue from becoming the first production provider and avoids silently queuing work with no worker online.
