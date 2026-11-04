import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifierBackoffMs } from "./verifier-backoff.ts";

const U = "Independent verification unavailable: the selected verifier is the same model as a producer.";
const at = (iso: string, notes: string) => ({ created_at: iso, verification_notes: notes });
const NOW = new Date("2026-11-03T16:40:00Z");

Deno.test("no unavailable streak: verify now", () => {
  assertEquals(verifierBackoffMs([], NOW).waitMs, 0);
  assertEquals(verifierBackoffMs([at("2026-11-03T16:39:00Z", "Failed: missing section"), at("2026-11-03T16:38:00Z", U)], NOW).waitMs, 0);
});

Deno.test("one unavailable 1 min ago waits 1 more minute; three in a row wait 8 min from the last", () => {
  assertEquals(verifierBackoffMs([at("2026-11-03T16:39:00Z", U)], NOW), { waitMs: 60_000, unavailableStreak: 1 });
  const three = [at("2026-11-03T16:38:00Z", U), at("2026-11-03T16:37:00Z", U), at("2026-11-03T16:36:00Z", U)];
  assertEquals(verifierBackoffMs(three, NOW), { waitMs: 6 * 60_000, unavailableStreak: 3 });
});

Deno.test("backoff is capped at 60 minutes and expires", () => {
  const many = Array.from({ length: 9 }, () => at("2026-11-03T16:00:00Z", U));
  assertEquals(verifierBackoffMs(many, NOW).waitMs, 20 * 60_000);
  assertEquals(verifierBackoffMs(many, new Date("2026-11-03T17:01:00Z")).waitMs, 0);
});
