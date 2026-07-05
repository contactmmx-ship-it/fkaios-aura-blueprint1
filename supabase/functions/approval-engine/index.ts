import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

/**
 * Evaluate a single condition against the request_data.
 * Supports: amount_gt, amount_lt, amount_gte, amount_lte, amount_eq,
 *           entity_count_gt, any, risk_score_gt, field_equals
 */
function evaluateCondition(
  condition: Record<string, unknown>,
  requestData: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case "amount_gt": {
        const amount = Number(requestData.amount || 0);
        if (!(amount > Number(value))) return false;
        break;
      }
      case "amount_lt": {
        const amount = Number(requestData.amount || 0);
        if (!(amount < Number(value))) return false;
        break;
      }
      case "amount_gte": {
        const amount = Number(requestData.amount || 0);
        if (!(amount >= Number(value))) return false;
        break;
      }
      case "amount_lte": {
        const amount = Number(requestData.amount || 0);
        if (!(amount <= Number(value))) return false;
        break;
      }
      case "amount_eq": {
        const amount = Number(requestData.amount || 0);
        if (amount !== Number(value)) return false;
        break;
      }
      case "entity_count_gt": {
        const count = Number(requestData.entity_count || requestData.count || 0);
        if (!(count > Number(value))) return false;
        break;
      }
      case "entity_count_gte": {
        const count = Number(requestData.entity_count || requestData.count || 0);
        if (!(count >= Number(value))) return false;
        break;
      }
      case "risk_score_gt": {
        const score = Number(requestData.risk_score || 0);
        if (!(score > Number(value))) return false;
        break;
      }
      case "field_equals": {
        const fieldConfig = value as { field: string; value: unknown };
        const fieldValue = requestData[fieldConfig.field];
        if (fieldValue !== fieldConfig.value) return false;
        break;
      }
      case "field_in": {
        const fieldConfig = value as { field: string; values: unknown[] };
        const fieldValue = requestData[fieldConfig.field];
        if (!fieldConfig.values.includes(fieldValue)) return false;
        break;
      }
      case "any": {
        // 'any: true' means always matches
        if (value !== true) return false;
        break;
      }
      case "brand_id": {
        if (value === "any") break;
        const brandId = requestData.brand_id || requestData.brandId;
        if (brandId !== value) return false;
        break;
      }
      default:
        // Unknown condition keys are ignored
        break;
    }
  }
  return true;
}

/**
 * Determine the risk level based on request data and the matching rule.
 */
function determineRiskLevel(
  requestData: Record<string, unknown>,
  thresholdType: string | null,
  thresholdValue: number | null
): "low" | "medium" | "high" | "critical" {
  if (!thresholdType || thresholdValue === null) return "medium";

  switch (thresholdType) {
    case "amount": {
      const amount = Number(requestData.amount || 0);
      if (amount >= thresholdValue * 5) return "critical";
      if (amount >= thresholdValue * 2) return "high";
      if (amount >= thresholdValue) return "medium";
      return "low";
    }
    case "count": {
      const count = Number(
        requestData.entity_count || requestData.count || 0
      );
      if (count >= thresholdValue * 10) return "critical";
      if (count >= thresholdValue * 3) return "high";
      if (count >= thresholdValue) return "medium";
      return "low";
    }
    case "percentage": {
      const pct = Number(requestData.percentage || 0);
      if (pct >= 50) return "critical";
      if (pct >= 25) return "high";
      if (pct >= 10) return "medium";
      return "low";
    }
    case "risk_score": {
      const score = Number(requestData.risk_score || 0);
      if (score >= 80) return "critical";
      if (score >= 60) return "high";
      if (score >= 30) return "medium";
      return "low";
    }
    default:
      return "medium";
  }
}

// ---------------------------------------------------------------------------
// Route: check — Determine if an action needs approval
// ---------------------------------------------------------------------------

async function handleCheck(body: Record<string, unknown>) {
  const {
    action_type,
    entity_type,
    entity_id,
    request_data,
    requested_by_agent_id,
    requested_by_user_id,
  } = body as {
    action_type: string;
    entity_type: string;
    entity_id?: string;
    request_data: Record<string, unknown>;
    requested_by_agent_id?: string;
    requested_by_user_id?: string;
  };

  if (!action_type || !entity_type || !request_data) {
    return errorResponse(
      "action_type, entity_type, and request_data are required"
    );
  }

  // Fetch all active approval rules for this action type
  const { data: rules, error: rulesErr } = await supabase
    .from("approval_rules")
    .select("*")
    .eq("action_type", action_type)
    .eq("is_active", true);

  if (rulesErr) {
    return errorResponse(`Failed to fetch approval rules: ${rulesErr.message}`, 500);
  }

  if (!rules || rules.length === 0) {
    // No rules match this action type — auto-approve
    return jsonResponse({
      needs_approval: false,
      auto_approved: true,
      reason: "No approval rules found for this action type",
    });
  }

  // Evaluate each rule
  for (const rule of rules) {
    const conditions = rule.conditions as Record<string, unknown>;

    const matches = evaluateCondition(conditions, request_data);

    if (!matches) continue;

    // Rule matched — check if we're below the auto-approve threshold
    if (rule.auto_approve_below && rule.auto_approve_threshold !== null) {
      const threshold = Number(rule.auto_approve_threshold);

      let requestValue: number;
      switch (rule.threshold_type) {
        case "amount":
          requestValue = Number(request_data.amount || 0);
          break;
        case "count":
          requestValue = Number(
            request_data.entity_count || request_data.count || 0
          );
          break;
        case "percentage":
          requestValue = Number(request_data.percentage || 0);
          break;
        case "risk_score":
          requestValue = Number(request_data.risk_score || 0);
          break;
        default:
          requestValue = Number(request_data.amount || 0);
      }

      if (requestValue < threshold) {
        // Below auto-approve threshold
        return jsonResponse({
          needs_approval: false,
          auto_approved: true,
          reason: `Below auto-approve threshold for rule "${rule.rule_name}"`,
          matching_rule: rule.rule_name,
        });
      }
    }

    // Above threshold — create approval queue entry
    const riskLevel = determineRiskLevel(
      request_data,
      rule.threshold_type,
      rule.threshold_value ? Number(rule.threshold_value) : null
    );

    // Calculate expiration based on escalation timeout
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + (rule.escalation_timeout_hours || 48)
    );

    const approvalEntry = {
      action_type,
      entity_type,
      entity_id: entity_id || null,
      request_data,
      requested_by_agent_id: requested_by_agent_id || null,
      requested_by_user_id: requested_by_user_id || null,
      risk_level: riskLevel,
      status: "pending",
      threshold_rule: rule.rule_name,
      expires_at: expiresAt.toISOString(),
      // reviewer_id will be auto-assigned by the trigger
    };

    const { data: created, error: insertErr } = await supabase
      .from("approval_queue")
      .insert(approvalEntry)
      .select("id, risk_level, status, threshold_rule, expires_at, reviewer_id")
      .single();

    if (insertErr) {
      return errorResponse(
        `Failed to create approval entry: ${insertErr.message}`,
        500
      );
    }

    return jsonResponse({
      needs_approval: true,
      approval_id: created.id,
      risk_level: created.risk_level,
      status: created.status,
      matching_rule: created.threshold_rule,
      expires_at: created.expires_at,
      reviewer_id: created.reviewer_id,
    });
  }

  // No rules matched — auto-approve
  return jsonResponse({
    needs_approval: false,
    auto_approved: true,
    reason: "No approval rules matched the request conditions",
  });
}

// ---------------------------------------------------------------------------
// Route: queue — List pending approvals for a reviewer
// ---------------------------------------------------------------------------

async function handleQueue(url: URL) {
  const status = url.searchParams.get("status") || "pending";
  const reviewerId = url.searchParams.get("reviewer_id");
  const actionType = url.searchParams.get("action_type");
  const riskLevel = url.searchParams.get("risk_level");
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const validStatuses = [
    "pending",
    "approved",
    "rejected",
    "expired",
    "auto_approved",
  ];
  if (!validStatuses.includes(status)) {
    return errorResponse(
      `Invalid status. Must be one of: ${validStatuses.join(", ")}`
    );
  }

  let query = supabase
    .from("approval_queue")
    .select(
      `
      id,
      action_type,
      entity_type,
      entity_id,
      request_data,
      requested_by_agent_id,
      requested_by_user_id,
      risk_level,
      status,
      threshold_rule,
      reviewer_id,
      review_notes,
      reviewed_at,
      expires_at,
      resolution_data,
      created_at,
      requested_by_agent:ai_agents!requested_by_agent_id(id, name, agent_type),
      requested_by_user:consultants!requested_by_user_id(id, name, email, role),
      reviewer:consultants!reviewer_id(id, name, email, role)
    `
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (reviewerId) {
    query = query.eq("reviewer_id", reviewerId);
  }

  if (actionType) {
    query = query.eq("action_type", actionType);
  }

  if (riskLevel) {
    const validRiskLevels = ["low", "medium", "high", "critical"];
    if (validRiskLevels.includes(riskLevel)) {
      query = query.eq("risk_level", riskLevel);
    }
  }

  const { data: approvals, error: fetchErr, count } = await query;

  if (fetchErr) {
    return errorResponse(
      `Failed to fetch approval queue: ${fetchErr.message}`,
      500
    );
  }

  // Get total count for pagination
  let countQuery = supabase
    .from("approval_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", status);

  if (reviewerId) {
    countQuery = countQuery.eq("reviewer_id", reviewerId);
  }
  if (actionType) {
    countQuery = countQuery.eq("action_type", actionType);
  }
  if (riskLevel) {
    countQuery = countQuery.eq("risk_level", riskLevel);
  }

  const { count: totalCount } = await countQuery;

  return jsonResponse({
    approvals: approvals || [],
    total: totalCount || 0,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// Route: approve — Approve an approval queue item
// ---------------------------------------------------------------------------

async function handleApprove(body: Record<string, unknown>) {
  const { approval_id, reviewer_id, notes, resolution_data } = body as {
    approval_id: string;
    reviewer_id: string;
    notes?: string;
    resolution_data?: Record<string, unknown>;
  };

  if (!approval_id || !reviewer_id) {
    return errorResponse("approval_id and reviewer_id are required");
  }

  // Fetch the approval entry
  const { data: approval, error: fetchErr } = await supabase
    .from("approval_queue")
    .select("*")
    .eq("id", approval_id)
    .single();

  if (fetchErr || !approval) {
    return errorResponse("Approval entry not found", 404);
  }

  if (approval.status !== "pending") {
    return errorResponse(
      `Approval entry is not pending. Current status: ${approval.status}`,
      409
    );
  }

  // Check expiration
  if (new Date(approval.expires_at) < new Date()) {
    // Mark as expired
    await supabase
      .from("approval_queue")
      .update({ status: "expired" })
      .eq("id", approval_id);
    return errorResponse("Approval entry has expired", 410);
  }

  // Verify reviewer has permission by checking the matching approval rule
  if (approval.threshold_rule) {
    const { data: rule } = await supabase
      .from("approval_rules")
      .select("required_roles")
      .eq("rule_name", approval.threshold_rule)
      .eq("is_active", true)
      .single();

    if (rule) {
      // Fetch the reviewer's role
      const { data: reviewer } = await supabase
        .from("consultants")
        .select("id, role, is_active")
        .eq("id", reviewer_id)
        .single();

      if (!reviewer) {
        return errorResponse("Reviewer not found in consultants table", 404);
      }

      if (!reviewer.is_active) {
        return errorResponse("Reviewer account is not active", 403);
      }

      const requiredRoles = rule.required_roles as string[];
      if (requiredRoles.length > 0 && !requiredRoles.includes(reviewer.role)) {
        return errorResponse(
          `Reviewer with role "${reviewer.role}" does not have permission. Required roles: ${requiredRoles.join(", ")}`,
          403
        );
      }
    }
  }

  // Approve the entry
  const updatePayload: Record<string, unknown> = {
    status: "approved",
    reviewer_id,
    review_notes: notes || null,
    reviewed_at: new Date().toISOString(),
    resolution_data: resolution_data || null,
  };

  const { data: updated, error: updateErr } = await supabase
    .from("approval_queue")
    .update(updatePayload)
    .eq("id", approval_id)
    .select(
      `
      id,
      action_type,
      entity_type,
      entity_id,
      request_data,
      risk_level,
      status,
      threshold_rule,
      reviewer_id,
      review_notes,
      reviewed_at,
      expires_at,
      resolution_data,
      created_at,
      reviewer:consultants!reviewer_id(id, name, email, role)
    `
    )
    .single();

  if (updateErr) {
    return errorResponse(`Failed to approve: ${updateErr.message}`, 500);
  }

  return jsonResponse({
    approval: updated,
    message: "Approval granted successfully",
  });
}

// ---------------------------------------------------------------------------
// Route: reject — Reject an approval queue item
// ---------------------------------------------------------------------------

async function handleReject(body: Record<string, unknown>) {
  const { approval_id, reviewer_id, notes } = body as {
    approval_id: string;
    reviewer_id: string;
    notes: string;
  };

  if (!approval_id || !reviewer_id) {
    return errorResponse("approval_id and reviewer_id are required");
  }

  if (!notes || notes.trim().length === 0) {
    return errorResponse("notes (rejection reason) is required");
  }

  // Fetch the approval entry
  const { data: approval, error: fetchErr } = await supabase
    .from("approval_queue")
    .select("*")
    .eq("id", approval_id)
    .single();

  if (fetchErr || !approval) {
    return errorResponse("Approval entry not found", 404);
  }

  if (approval.status !== "pending") {
    return errorResponse(
      `Approval entry is not pending. Current status: ${approval.status}`,
      409
    );
  }

  // Check expiration
  if (new Date(approval.expires_at) < new Date()) {
    await supabase
      .from("approval_queue")
      .update({ status: "expired" })
      .eq("id", approval_id);
    return errorResponse("Approval entry has expired", 410);
  }

  // Verify reviewer has permission
  if (approval.threshold_rule) {
    const { data: rule } = await supabase
      .from("approval_rules")
      .select("required_roles")
      .eq("rule_name", approval.threshold_rule)
      .eq("is_active", true)
      .single();

    if (rule) {
      const { data: reviewer } = await supabase
        .from("consultants")
        .select("id, role, is_active")
        .eq("id", reviewer_id)
        .single();

      if (!reviewer) {
        return errorResponse("Reviewer not found in consultants table", 404);
      }

      if (!reviewer.is_active) {
        return errorResponse("Reviewer account is not active", 403);
      }

      const requiredRoles = rule.required_roles as string[];
      if (requiredRoles.length > 0 && !requiredRoles.includes(reviewer.role)) {
        return errorResponse(
          `Reviewer with role "${reviewer.role}" does not have permission. Required roles: ${requiredRoles.join(", ")}`,
          403
        );
      }
    }
  }

  // Reject the entry
  const { data: updated, error: updateErr } = await supabase
    .from("approval_queue")
    .update({
      status: "rejected",
      reviewer_id,
      review_notes: notes,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", approval_id)
    .select(
      `
      id,
      action_type,
      entity_type,
      entity_id,
      request_data,
      risk_level,
      status,
      threshold_rule,
      reviewer_id,
      review_notes,
      reviewed_at,
      expires_at,
      created_at,
      reviewer:consultants!reviewer_id(id, name, email, role)
    `
    )
    .single();

  if (updateErr) {
    return errorResponse(`Failed to reject: ${updateErr.message}`, 500);
  }

  return jsonResponse({
    approval: updated,
    message: "Approval rejected",
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/functions\/v1\/approval-engine\/?/, "");

  try {
    switch (path) {
      case "check": {
        if (req.method !== "POST") {
          return errorResponse("Method not allowed. Use POST.", 405);
        }
        const body = await req.json();
        return await handleCheck(body);
      }

      case "queue": {
        if (req.method !== "GET") {
          return errorResponse("Method not allowed. Use GET.", 405);
        }
        return await handleQueue(url);
      }

      case "approve": {
        if (req.method !== "POST") {
          return errorResponse("Method not allowed. Use POST.", 405);
        }
        const body = await req.json();
        return await handleApprove(body);
      }

      case "reject": {
        if (req.method !== "POST") {
          return errorResponse("Method not allowed. Use POST.", 405);
        }
        const body = await req.json();
        return await handleReject(body);
      }

      default:
        return errorResponse(
          `Unknown route: ${path}. Valid routes: check, queue, approve, reject`,
          404
        );
    }
  } catch (err) {
    console.error("Approval engine error:", err);
    return errorResponse(
      `Internal server error: ${err instanceof Error ? err.message : "Unknown error"}`,
      500
    );
  }
});
