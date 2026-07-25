// FKAIOS Shared Cost Intelligence Layer — Phase 6A.4.1
//
// Read-only aggregator over the two currently-fragmented cost-tracking
// systems found in the Pricing Authority Audit:
//
//   USD system: agent_performance_metrics.estimated_cost_usd
//     written by llm-router.ts, ai-engine, avatar-orchestrator, auto-agents-engine
//
//   INR system: execution_log.cost_estimate_inr
//     written by brain-chat, heartbeat-engine, orchestrator-brain,
//     workday-engine, orchestrator-engine
//
// This module does not write anything and does not modify either existing
// writer. It exists so both systems can be read through one shared
// interface, instead of each consumer (executive-planner.ts's
// getTokenEconomyReport(), Dashboard.tsx's client-side 500-row/24h rollup)
// re-implementing its own query.

/// <reference lib="deno.ns" />
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

export interface CostSummary {
  totalUsd: number;
  totalInr: number;
  executionCount: number;
  inputTokens: number;
  outputTokens: number;

  byAgent: Record<string, number>;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;

  periodStart: string;
  periodEnd: string;
}

export interface CostSummaryOptions {
  /** Defaults to 24 hours before periodEnd. */
  periodStart?: Date;
  /** Defaults to now. */
  periodEnd?: Date;
}

/**
 * DESIGN DECISION — flagged explicitly, not silently assumed:
 *
 * `byAgent` / `byProvider` / `byModel` are populated from the USD system
 * (agent_performance_metrics) only, and are USD-denominated — consistent
 * with `totalUsd`. Reasons:
 *   1. `execution_log` (the INR system) has no `provider` column at all.
 *   2. Its `function_name` values are a different identifier space than
 *      `agent_id` — they are not the same dimension.
 *   3. Summing a USD figure and an INR figure into one numeric bucket would
 *      produce a meaningless number (e.g. "5 USD + 500 INR = 505"), which is
 *      a Truth Before Beauty violation this module refuses to introduce.
 *
 * `totalInr` fully captures the INR system's aggregate contribution.
 * `executionCount` / `inputTokens` / `outputTokens` are currency-agnostic
 * and are safely combined across both systems.
 *
 * If a per-agent or per-model INR breakdown is needed later, that should be
 * an explicit, separately-named field (e.g. `byFunctionInr`) added on
 * purpose — not folded into the existing USD-denominated maps.
 */
export async function getCostSummary(options: CostSummaryOptions = {}): Promise<CostSummary> {
  const periodEnd = options.periodEnd ?? new Date();
  const periodStart = options.periodStart ?? new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
  const startIso = periodStart.toISOString();
  const endIso = periodEnd.toISOString();

  const client = getClient();

  const [usdRes, inrRes] = await Promise.all([
    client
      .from("agent_performance_metrics")
      .select("agent_id, provider, model, estimated_cost_usd, input_tokens, output_tokens, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    client
      .from("execution_log")
      .select("function_name, model, cost_estimate_inr, input_tokens, output_tokens, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
  ]);

  if (usdRes.error) {
    throw new Error(`cost-aggregator: failed to read agent_performance_metrics: ${usdRes.error.message}`);
  }
  if (inrRes.error) {
    throw new Error(`cost-aggregator: failed to read execution_log: ${inrRes.error.message}`);
  }

  const usdRows = (usdRes.data ?? []) as Array<{
    agent_id: string | null;
    provider: string | null;
    model: string | null;
    estimated_cost_usd: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
  }>;
  const inrRows = (inrRes.data ?? []) as Array<{
    function_name: string | null;
    model: string | null;
    cost_estimate_inr: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
  }>;

  let totalUsd = 0;
  let totalInr = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const byAgent: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const byModel: Record<string, number> = {};

  for (const row of usdRows) {
    const cost = row.estimated_cost_usd ?? 0;
    totalUsd += cost;
    inputTokens += row.input_tokens ?? 0;
    outputTokens += row.output_tokens ?? 0;

    const agentKey = row.agent_id ?? "unknown";
    byAgent[agentKey] = (byAgent[agentKey] ?? 0) + cost;

    const providerKey = row.provider ?? "unknown";
    byProvider[providerKey] = (byProvider[providerKey] ?? 0) + cost;

    const modelKey = row.model ?? "unknown";
    byModel[modelKey] = (byModel[modelKey] ?? 0) + cost;
  }

  for (const row of inrRows) {
    totalInr += row.cost_estimate_inr ?? 0;
    inputTokens += row.input_tokens ?? 0;
    outputTokens += row.output_tokens ?? 0;
    // Deliberately not added to byAgent/byProvider/byModel — see design
    // decision above.
  }

  return {
    totalUsd: Math.round(totalUsd * 10_000) / 10_000,
    totalInr: Math.round(totalInr * 100) / 100,
    executionCount: usdRows.length + inrRows.length,
    inputTokens,
    outputTokens,
    byAgent,
    byProvider,
    byModel,
    periodStart: startIso,
    periodEnd: endIso,
  };
}
