// FKAIOS RESOURCE INTELLIGENCE — production bridge
// Connects the merged workable resource-intelligence model to the Supabase
// execution runtime without duplicating the resource UI/application.
//
// V1 deliberately makes only decisions backed by real runtime state.
// Research currently has one real external resource: the configured Apify
// connection used by research-engine. If it is unavailable, dispatch is
// blocked before an external call is attempted.
// Future providers can be added here as they become real, verified adapters.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

export interface RuntimeResourceDecision {
  status: "selected" | "blocked" | "not_required";
  capability: string;
  resourceId?: string;
  resourceName?: string;
  costMode?: "free" | "credit" | "paid";
  reason: string[];
}

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

/**
 * Resolve a real execution resource for a registered capability.
 *
 * This is intentionally conservative: no resource is invented merely because
 * it appears in a static catalog. A provider is selectable only when FKAIOS
 * has a real, configured runtime connection for that provider.
 */
export async function resolveRuntimeResource(
  capability: string,
  payload: Record<string, unknown> = {},
): Promise<RuntimeResourceDecision> {
  if (capability !== "research.run") {
    // The existing Company OS capability registry remains the source of truth
    // for non-research business capabilities. Resource intelligence does not
    // pretend to have a provider adapter where one has not been wired.
    return {
      status: "not_required",
      capability,
      reason: ["no runtime resource selection required for this capability"],
    };
  }

  const client = db();
  const { data, error } = await client
    .from("apify_connections")
    .select("id, is_active, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      status: "blocked",
      capability,
      resourceId: "apify",
      resourceName: "Apify",
      costMode: "credit",
      reason: ["resource_state_lookup_failed", error.message.slice(0, 200)],
    };
  }

  if (!data) {
    return {
      status: "blocked",
      capability,
      resourceId: "apify",
      resourceName: "Apify",
      costMode: "credit",
      reason: [
        "no_active_resource_connection",
        "research.run requires the configured Apify research resource",
      ],
    };
  }

  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  return {
    status: "selected",
    capability,
    resourceId: "apify",
    resourceName: "Apify",
    costMode: "credit",
    reason: [
      "capability=research.run",
      "resource=apify",
      "active_connection=true",
      ...(query ? ["query_present=true"] : ["query_present=false"]),
    ],
  };
}
