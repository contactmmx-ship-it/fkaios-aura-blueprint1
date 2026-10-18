import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { restrictProvidersForFreeTier } from "./provider-policy.ts";

const providers = [
  { name: "anthropic" },
  { name: "gemini" },
  { name: "openai" },
  { name: "groq" },
  { name: "self_hosted" },
];

Deno.test("explicit free-tier mode excludes paid providers by default", () => {
  assertEquals(restrictProvidersForFreeTier(providers, ["groq"], false).map(p => p.name), ["groq", "self_hosted"]);
});

Deno.test("explicit free-tier mode keeps all explicitly free providers", () => {
  assertEquals(restrictProvidersForFreeTier(providers, ["gemini", "groq"], false).map(p => p.name), ["gemini", "groq", "self_hosted"]);
});

Deno.test("paid fallback only returns when operator explicitly opts in", () => {
  assertEquals(restrictProvidersForFreeTier(providers, ["groq"], true).map(p => p.name), ["anthropic", "gemini", "openai", "groq", "self_hosted"]);
});

Deno.test("without a free-tier marker, only self-hosted inference remains eligible", () => {
  assertEquals(restrictProvidersForFreeTier(providers, [], false).map(p => p.name), ["self_hosted"]);
});

Deno.test("without a free-tier marker and without self-hosted, no provider is silently enabled", () => {
  assertEquals(restrictProvidersForFreeTier(providers.filter(p => p.name !== "self_hosted"), [], false), []);
});
