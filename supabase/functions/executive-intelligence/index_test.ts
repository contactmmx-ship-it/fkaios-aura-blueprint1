/// <reference lib="deno.ns" />
import { hasValidCronSecret, resolveCronSecret } from "../_shared/cron-auth.ts";

Deno.test("accepts the shared secret in x-heartbeat-secret", () => {
  const req = new Request("https://example.test/functions/v1/executive-intelligence", {
    headers: { "x-heartbeat-secret": "test-secret" },
  });
  if (!hasValidCronSecret(req, "test-secret")) throw new Error("expected valid header");
});

Deno.test("retains query-secret compatibility during migration", () => {
  const req = new Request("https://example.test/functions/v1/executive-intelligence?secret=test-secret");
  if (!hasValidCronSecret(req, "test-secret")) throw new Error("expected valid query secret");
});

Deno.test("rejects missing or incorrect secrets", () => {
  const missing = new Request("https://example.test/functions/v1/executive-intelligence");
  const incorrect = new Request("https://example.test/functions/v1/executive-intelligence?secret=wrong");
  if (hasValidCronSecret(missing, "test-secret")) throw new Error("missing secret must fail");
  if (hasValidCronSecret(incorrect, "test-secret")) throw new Error("incorrect secret must fail");
  if (hasValidCronSecret(missing, "")) throw new Error("unset configured secret must fail");
});

Deno.test("prefers CRON_SECRET and falls back to HEARTBEAT_SECRET", () => {
  if (resolveCronSecret("cron-value", "heartbeat-value") !== "cron-value") {
    throw new Error("CRON_SECRET must take precedence");
  }
  if (resolveCronSecret(undefined, "heartbeat-value") !== "heartbeat-value") {
    throw new Error("HEARTBEAT_SECRET fallback must be supported");
  }
  if (resolveCronSecret("", undefined) !== "") {
    throw new Error("missing secrets must resolve to empty string");
  }
});
