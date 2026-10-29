import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const route = readFileSync("src/app/api/brand-discovery-guide/route.ts", "utf8");
const page = readFileSync("src/app/brand-discovery-preview/page.tsx", "utf8");
const standalone = readFileSync("preview-static/src/App.tsx", "utf8");

assert.match(route, /FKAIOS_BRAND_DISCOVERY_AI_ENABLED\s*===\s*"true"/, "AI must be explicitly enabled server-side");
assert.match(route, /!enabled\s*\|\|\s*!apiKey\s*\|\|\s*!model/, "AI must remain disabled without explicit toggle, key and model");
assert.match(route, /mode:\s*"local"/, "No-spend local guidance path must exist");
assert.match(route, /https:\/\/ai-gateway\.vercel\.sh\/v1\/chat\/completions/, "Enabled model calls must use the approved gateway endpoint");
assert.match(route, /max_tokens:\s*350/, "Guide output must be bounded");
assert.match(route, /AbortSignal\.timeout\(20_000\)/, "Guide request must have a timeout");
assert.match(route, /OWNER_REPORTED|self-reported|self reported/i, "Guide must distinguish owner reports from verified evidence");
assert.doesNotMatch(page, /AI_GATEWAY_API_KEY|FKAIOS_BRAND_DISCOVERY_MODEL/, "Gateway credentials/model configuration must not be exposed to the browser");
assert.doesNotMatch(standalone, /AI_GATEWAY_API_KEY|FKAIOS_BRAND_DISCOVERY_MODEL/, "Standalone preview must not contain gateway credentials/model configuration");
assert.match(page, /\/api\/brand-discovery-guide/, "Next.js preview must use the guide API");
assert.match(page, /setGuideMode\(payload\.mode/, "UI must reflect the actual guide mode");
assert.match(page, /continue without the guide/i, "User must have a clear fallback");
assert.match(standalone, /local guidance/i, "Static preview must explain local guidance mode");

console.log("Brand discovery guide safety checks passed (no model call executed).");
