# Run FKAIOS local inference without paid API keys (Windows)

## 1. Install and start Ollama

Install the Windows application from https://ollama.com/download/windows. Start Ollama normally; keep its local service bound to the machine. Do not expose port `11434` to the public internet.

Open PowerShell in the FKAIOS repository and check the runtime:

```powershell
ollama --version
ollama list
```

The default FKAIOS self-hosted model is `qwen2.5:14b`. Model size and speed depend on available RAM/VRAM. If that model is too large for the development machine, select a smaller model explicitly (for example `qwen2.5:7b`) and use the same name in the FKAIOS configuration.

Pulling a model downloads it to the machine and does not call a paid model API. It uses disk space and bandwidth. The script never downloads a model automatically.

## 2. Run a real local-only smoke test

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-ai\verify-ollama.ps1
```

Or specify a model already installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-ai\verify-ollama.ps1 -Model qwen2.5:7b
```

The script checks that Ollama is installed, that its local API is reachable, that the requested model is already installed, and that the model returns the expected response through Ollama's local chat API. It does not call Anthropic, Gemini, OpenAI, or another cloud model provider.

If the requested model is missing, the script prints the explicit `ollama pull <model>` command and exits without downloading it.

## 3. Configure a process running locally

For a local development process started from the same PowerShell window, set:

```powershell
$env:SELF_HOSTED_LLM_BASE_URL = "http://127.0.0.1:11434/v1"
$env:SELF_HOSTED_LLM_MODEL = "qwen2.5:14b"
$env:PROVIDER_SELF_HOSTED_ENABLED = "true"
```

Use the exact model name verified by the smoke test. The endpoint is OpenAI-compatible, while the smoke test uses Ollama's native `/api/chat` endpoint.

## 4. Important production boundary

The production FKAIOS Edge Functions execute inside Supabase's hosted runtime. There, `127.0.0.1` refers to the hosted function container, **not** this Windows machine. Setting a localhost URL in Supabase would not connect production to your PC.

Current code now selects a configured local model ahead of cloud-only objective policies, and fails over through the existing router if the local attempt is unavailable. But production local inference requires one of these deliberate architectures:

1. A secured, reachable self-hosted inference endpoint that Supabase can access; or
2. An outbound local worker/queue bridge, so the PC initiates the connection and executes local inference without opening an inbound public port.

Do not add a paid tunnel, purchase hosting, expose Ollama, or alter production secrets without explicit authorization. Until a real endpoint/bridge is configured and verified, this change does not mean production objectives are running locally.

## 5. Zero-key development acceptance

- Run the router regression suite: `deno test --no-check --node-modules-dir=auto --allow-env --allow-net supabase/functions/_shared/llm-router.test.ts`
- Run objective resource-selection regression tests: `deno test --no-check --node-modules-dir=auto --allow-env --allow-net supabase/functions/_shared/resource-selection.test.ts`
- Run the smoke script on the actual Windows development machine.
- Test an objective end-to-end with cloud keys absent and verify its evidence, provider/model, cost, and terminal status. Never treat a mocked test as proof of a live local inference run.
