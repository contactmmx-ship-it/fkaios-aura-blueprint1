/// <reference lib="deno.ns" />
function assertEquals(a: unknown, b: unknown): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
import { latestGoals, missingGoals } from "./goal-hierarchy.ts";

const row = (level: string, description: string, at: string) => ({ structured_content: { kind: "goal", level, description, deadline: "2030", created_at: at }, created_at: at });

Deno.test("latestGoals keeps one row per level+description, newest first", () => {
  const rows = [
    row("annual", "₹5 Crore revenue gate", "2026-11-05T04:49:12Z"),
    row("vision", "₹1,100 Crore revenue", "2026-11-05T04:49:11Z"),
    row("annual", "₹5 Crore revenue gate", "2026-11-04T04:49:12Z"),
    row("vision", "₹1,100 crore revenue ", "2026-11-04T04:49:11Z"),
    { structured_content: null, created_at: "2026-11-01T00:00:00Z" },
  ];
  const g = latestGoals(rows);
  assertEquals(g.length, 2);
  assertEquals(g[0].created_at, "2026-11-05T04:49:12Z");
  assertEquals(g.map((x) => x.level), ["annual", "vision"]);
});

Deno.test("missingGoals writes nothing when the goals already exist", () => {
  const existing = [{ level: "vision", description: "₹1,100 Crore revenue" }, { level: "annual", description: "₹5 Crore revenue gate" }];
  assertEquals(missingGoals(existing, existing), []);
  assertEquals(missingGoals([existing[0]], existing), [existing[1]]);
  assertEquals(missingGoals([], existing).length, 2);
});
