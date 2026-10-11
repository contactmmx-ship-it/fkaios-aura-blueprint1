import { infrastructureInventoryCompletionGap } from "./objective-loop.ts";

Deno.test("infrastructure inventory gate rejects narrative-only completion claims", () => {
  const objective = "Perform production infrastructure verification across 175 Supabase tables, 90 edge functions, 80 SQL functions, 26 crons, 30+ Console screens and 10 brands.";
  const tasks = [{
    status: "completed",
    output: JSON.stringify({
      summary: "All systems healthy",
      claims: ["All 175 tables, 90 functions, 26 crons, 30 screens and 10 brands verified"],
      llmResult: {
        capability: "system.health_check",
        capability_result: {
          healthy: true,
          checks: [
            { target: "console", http_status: 200 },
            { target: "supabase_rest", http_status: 200 },
          ],
        },
      },
      companyOsDispatch: {
        capability: "system.health_check",
        status: "success",
      },
    }),
  }];
  const gap = infrastructureInventoryCompletionGap(objective, tasks);
  if (!gap || !gap.includes("machine-observed evidence is missing")) {
    throw new Error("Narrative claims plus HTTP reachability must not satisfy inventory completion");
  }
  for (const label of ["table inventory", "function inventory", "cron inventory", "screen/route inventory", "brand integration inventory"]) {
    if (!gap.includes(label)) throw new Error(`Expected missing evidence for ${label}`);
  }
});

Deno.test("infrastructure inventory gate accepts structured evidence for every requested inventory", () => {
  const objective = "Production infrastructure audit: 175 Supabase tables, 90 edge functions, 26 crons, 30 Console screens and 10 brands.";
  const capabilities = [
    "system.table_inventory",
    "system.function_inventory",
    "system.cron_inventory",
    "system.route_inventory",
    "business.brand_inventory",
  ];
  const tasks = capabilities.map((capability) => ({
    output: JSON.stringify({
      llmResult: { capability, capability_result: { observed: true, items: [] } },
      companyOsDispatch: { capability, status: "success" },
    }),
  }));
  if (infrastructureInventoryCompletionGap(objective, tasks) !== null) {
    throw new Error("Structured evidence for every requested inventory should satisfy this gate");
  }
});

Deno.test("infrastructure inventory gate does not affect unrelated objectives", () => {
  const gap = infrastructureInventoryCompletionGap(
    "Research 20 potential distributors for Bharat Paints",
    [{ output: "Found 20 distributors" }],
  );
  if (gap !== null) throw new Error("Unrelated objectives must not be blocked");
});

Deno.test("infrastructure inventory gate rejects capability-shaped claims without successful dispatch", () => {
  const objective = "Production infrastructure audit: 175 Supabase tables, 90 edge functions, 26 crons, 30 Console screens and 10 brands.";
  const tasks = [
    "system.table_inventory",
    "system.function_inventory",
    "system.cron_inventory",
    "system.route_inventory",
    "business.brand_inventory",
  ].map((capability) => ({
    output: JSON.stringify({ capability, capability_result: { observed: true, items: [] } }),
  }));
  const gap = infrastructureInventoryCompletionGap(objective, tasks);
  if (!gap || !gap.includes("machine-observed evidence is missing")) {
    throw new Error("Model-shaped capability JSON without a successful dispatcher envelope must not satisfy the gate");
  }
});
