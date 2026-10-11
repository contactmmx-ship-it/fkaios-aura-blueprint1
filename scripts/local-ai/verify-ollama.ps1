param(
  [string]$BaseUrl = "http://127.0.0.1:11434",
  [string]$Model = $(if ($env:SELF_HOSTED_LLM_MODEL) { $env:SELF_HOSTED_LLM_MODEL } else { "qwen2.5:14b" })
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")
$Model = $Model.Trim()

Write-Host "FKAIOS local inference preflight" -ForegroundColor Cyan
Write-Host "Endpoint: $BaseUrl"
Write-Host "Model:    $Model"
Write-Host "No cloud provider APIs are called by this script."

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Error "Ollama CLI was not found. Install Ollama for Windows from https://ollama.com/download/windows, then reopen PowerShell."
  exit 1
}

ollama --version
try {
  $tags = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/tags" -TimeoutSec 5
} catch {
  Write-Error "Ollama is not reachable at $BaseUrl. Start the Ollama app/service and retry. Do not expose port 11434 publicly."
  exit 1
}

$installed = @($tags.models | ForEach-Object { [string]$_.name })
if ($installed -notcontains $Model) {
  Write-Host "Model '$Model' is not installed." -ForegroundColor Yellow
  Write-Host "Available models: $($installed -join ', ')"
  Write-Host "If the machine has enough RAM, install it explicitly with: ollama pull $Model"
  exit 2
}

$body = @{
  model = $Model
  stream = $false
  messages = @(
    @{ role = "system"; content = "Return exactly the token LOCAL_OK and nothing else." },
    @{ role = "user"; content = "LOCAL_OK" }
  )
  options = @{ temperature = 0; num_predict = 24 }
} | ConvertTo-Json -Depth 8

try {
  $result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/chat" -ContentType "application/json" -Body $body -TimeoutSec 120
} catch {
  Write-Error "Local inference request failed: $($_.Exception.Message)"
  exit 3
}

$response = [string]$result.message.content
if ($response -notmatch "LOCAL_OK") {
  Write-Error "Ollama responded, but the smoke-test output did not match. Output: $response"
  exit 4
}

Write-Host "PASS: local model answered without a paid API." -ForegroundColor Green
Write-Host "For a local FKAIOS runtime, set these in the same shell before starting the local function:"
Write-Host '$env:SELF_HOSTED_LLM_BASE_URL = "' + "$BaseUrl/v1" + '"'
Write-Host '$env:SELF_HOSTED_LLM_MODEL = "' + $Model + '"'
Write-Host '$env:PROVIDER_SELF_HOSTED_ENABLED = "true"'
Write-Host ""
Write-Host "Boundary: these variables affect processes started from this shell. They do not configure hosted Supabase Edge Functions."
