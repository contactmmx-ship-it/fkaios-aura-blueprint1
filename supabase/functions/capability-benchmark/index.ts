import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

type BenchmarkInput = {
  action: "record" | "evaluate";
  capability_id?: string;
  resource_key?: string;
  provider?: string;
  model?: string;
  task_type?: string;
  benchmark_suite?: string;
  success?: boolean;
  verified?: boolean;
  quality_score?: number;
  latency_ms?: number;
  estimated_cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  evidence?: Record<string, unknown>;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const body = (await req.json()) as BenchmarkInput;

    if (!body.action) return json({ error: "action is required" }, 400);
    if (!body.capability_id) return json({ error: "capability_id is required" }, 400);

    const { data: capability, error: capabilityError } = await db
      .from("capability_registry")
      .select("id,name,provider,availability,auth_state,cost_state")
      .eq("id", body.capability_id)
      .maybeSingle();

    if (capabilityError) throw new Error(capabilityError.message);
    if (!capability) return json({ error: "capability not found" }, 404);

    if (body.action === "record") {
      if (!body.resource_key || !body.benchmark_suite) {
        return json({ error: "resource_key and benchmark_suite are required" }, 400);
      }

      const quality = Math.max(0, Math.min(100, Number(body.quality_score ?? 0)));

      const { data, error } = await db
        .from("capability_benchmarks")
        .insert({
          capability_id: body.capability_id,
          resource_key: body.resource_key,
          provider: body.provider ?? capability.provider ?? null,
          model: body.model ?? null,
          task_type: body.task_type ?? null,
          benchmark_suite: body.benchmark_suite,
          success: body.success === true,
          verified: body.verified === true,
          quality_score: quality,
          latency_ms: body.latency_ms ?? null,
          estimated_cost_usd: body.estimated_cost_usd ?? null,
          input_tokens: body.input_tokens ?? null,
          output_tokens: body.output_tokens ?? null,
          evidence: body.evidence ?? {},
        })
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      return json({ ok: true, benchmark: data });
    }

    const { data: ranking, error: rankingError } = await db
      .rpc("fkaios_rank_benchmarked_resources", {
        p_capability_id: body.capability_id,
        p_task_type: body.task_type ?? null,
        p_benchmark_suite: body.benchmark_suite ?? null,
      });

    if (rankingError) throw new Error(rankingError.message);

    const ranked = Array.isArray(ranking) ? ranking : [];
    const incumbent = ranked[0] ?? null;
    const candidate = body.resource_key
      ? ranked.find((r: any) => r.resource_key === body.resource_key) ?? null
      : null;

    if (candidate && incumbent && candidate.resource_key !== incumbent.resource_key) {
      const base = Number(incumbent.benchmark_score ?? 0);
      const score = Number(candidate.benchmark_score ?? 0);
      const improvement = base > 0 ? ((score - base) / base) * 100 : 0;
      const confidence = Math.min(
        100,
        Number(candidate.verified_attempts ?? 0) * 10 +
        Number(incumbent.verified_attempts ?? 0) * 10,
      );

      const recommendation =
        improvement >= 10 && confidence >= 70 ? "candidate" :
        improvement >= 5 && confidence >= 40 ? "test" :
        "observe";

      const { data: proposal, error: proposalError } = await db
        .from("capability_adoption_proposals")
        .insert({
          capability_id: body.capability_id,
          candidate_resource_key: candidate.resource_key,
          incumbent_resource_key: incumbent.resource_key,
          benchmark_suite: body.benchmark_suite ?? "all",
          candidate_score: score,
          incumbent_score: base,
          improvement_pct: Number(improvement.toFixed(2)),
          confidence_pct: confidence,
          recommendation,
          evidence: { ranking: ranked },
        })
        .select("*")
        .single();

      if (proposalError) throw new Error(proposalError.message);

      return json({ ok: true, capability, ranking: ranked, proposal });
    }

    return json({ ok: true, capability, ranking: ranked, proposal: null });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
