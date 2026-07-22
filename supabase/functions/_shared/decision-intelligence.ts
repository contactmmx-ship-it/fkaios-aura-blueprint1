// ============================================================================
// DECISION INTELLIGENCE ENGINE
// ============================================================================
// Read-only analysis over the Founder Decision Memory Loop's own output
// (fleet_memory, memory_type='decision') — written today by
// DecisionCenter.tsx's decideItem() and ExecutiveCouncil.tsx's execute()
// via the record_enterprise_memory() RPC. Nothing in this file writes
// anywhere. Nothing here is wired into executive-intelligence or
// executive-brain yet — per the Founder Decision Intelligence Readiness
// audit, that remains a deliberately separate, later step, not bundled in.
//
// Reuses the exact statistical-floor discipline already established in
// executive-planner.ts's buildIntuition()/getLearningTrend(): a minimum of
// 5 real observations before reporting a rate, an honest "insufficient
// evidence" result below that floor — never a fabricated percentage from a
// thin sample.
//
// KNOWN DATA SHAPE INCONSISTENCY (found while building this, not hidden):
// two different writers have populated memory_type='decision' rows with two
// different structured_content shapes:
//   - captureDecision() (founder-brain.ts, called only from cognitiveTick,
//     whose only cron entry point — founder-brain-tick — remains
//     undeployed): description, reasoning, expectedOutcome, confidence,
//     tradeoffs, departmentCode, riskLevel (camelCase). This shape never
//     actually recorded a FOUNDER ruling — it captured the AI's own
//     decision, before the Founder Decision Memory Loop existed.
//   - DecisionCenter.tsx / ExecutiveCouncil.tsx (live, real, firing today):
//     source, founder_ruling, decision_outcome, risk_level,
//     original_recommendation, exec_role/conflicts_with (snake_case).
// Every function below reads defensively across both shapes — a legacy
// captureDecision() row is counted in total history but excluded from every
// ruling-based rate (its "ruling" normalizes to null, honestly), rather than
// guessing which of its fields might correspond to an approval.
// ============================================================================

import { getFounderBrainClient, FOUNDER_BRAIN_DEPARTMENT } from "./founder-brain.ts";

const MIN_SAMPLE_SIZE = 5; // same floor as buildIntuition()/getLearningTrend()

type Ruling = "approved" | "rejected";

export interface RawDecisionMemory {
  id: string;
  source: string | null;
  ruling: Ruling | null;
  riskLevel: string | null;
  execRole: string | null;
  originalRecommendation: string | null;
  createdAt: string;
}

function normalizeRuling(raw: Record<string, unknown>): Ruling | null {
  const ruling = raw.founder_ruling as string | undefined;
  if (!ruling) return null;
  if (ruling === "approved" || ruling === "accepted") return "approved";
  if (ruling === "rejected") return "rejected";
  return null;
}

function normalizeRiskLevel(raw: Record<string, unknown>): string | null {
  return (raw.risk_level as string | undefined) ?? (raw.riskLevel as string | undefined) ?? null;
}

async function fetchDecisionMemories(limit = 200): Promise<RawDecisionMemory[]> {
  const client = getFounderBrainClient();
  const { data, error } = await client
    .from("fleet_memory")
    .select("id, structured_content, created_at")
    .eq("source_department", FOUNDER_BRAIN_DEPARTMENT)
    .eq("memory_type", "decision")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<{ id: string; structured_content: Record<string, unknown> | null; created_at: string }>).map((row) => {
    const sc = row.structured_content ?? {};
    return {
      id: row.id,
      source: (sc.source as string | undefined) ?? null,
      ruling: normalizeRuling(sc),
      riskLevel: normalizeRiskLevel(sc),
      execRole: (sc.exec_role as string | undefined) ?? null,
      originalRecommendation: (sc.original_recommendation as string | undefined) ?? (sc.description as string | undefined) ?? null,
      createdAt: row.created_at,
    };
  });
}

function rateFor(rulings: Ruling[]): { rate: number | null; evidence: string } {
  const n = rulings.length;
  if (n < MIN_SAMPLE_SIZE) {
    return { rate: null, evidence: `only ${n} observation(s) recorded — below the ${MIN_SAMPLE_SIZE}-observation floor, no rate reported` };
  }
  const approved = rulings.filter((r) => r === "approved").length;
  return { rate: Math.round((approved / n) * 100), evidence: `${approved} of ${n} decisions approved` };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

// ============================================================================
// 1. DECISION HISTORY ANALYZER
// ============================================================================
export interface DecisionHistorySummary {
  totalDecisions: number;
  rulingsRecorded: number; // excludes the pre-loop captureDecision() shape, which never recorded a real founder ruling
  approvedCount: number;
  rejectedCount: number;
  oldestDecision: string | null;
  newestDecision: string | null;
  evidence: string;
}

export async function analyzeDecisionHistory(limit = 200): Promise<DecisionHistorySummary> {
  const memories = await fetchDecisionMemories(limit);
  const withRuling = memories.filter((m) => m.ruling !== null);
  const approved = withRuling.filter((m) => m.ruling === "approved").length;
  const rejected = withRuling.filter((m) => m.ruling === "rejected").length;
  return {
    totalDecisions: memories.length,
    rulingsRecorded: withRuling.length,
    approvedCount: approved,
    rejectedCount: rejected,
    oldestDecision: memories.length > 0 ? memories[memories.length - 1].createdAt : null,
    newestDecision: memories.length > 0 ? memories[0].createdAt : null,
    evidence: withRuling.length < MIN_SAMPLE_SIZE
      ? `${withRuling.length} founder ruling(s) recorded — below the ${MIN_SAMPLE_SIZE}-observation floor for any pattern analysis`
      : `${withRuling.length} founder rulings recorded (${approved} approved, ${rejected} rejected)`,
  };
}

// ============================================================================
// 2. FOUNDER DECISION PATTERN EXTRACTION
// ============================================================================
export interface DecisionPattern {
  scope: string; // "overall" | "source:<name>"
  sampleSize: number;
  approvalRate: number | null;
  evidence: string;
}

export async function extractDecisionPatterns(limit = 200): Promise<DecisionPattern[]> {
  const memories = await fetchDecisionMemories(limit);
  const withRuling = memories.filter((m) => m.ruling !== null) as Array<RawDecisionMemory & { ruling: Ruling }>;

  const patterns: DecisionPattern[] = [];
  const overall = rateFor(withRuling.map((m) => m.ruling));
  patterns.push({ scope: "overall", sampleSize: withRuling.length, approvalRate: overall.rate, evidence: overall.evidence });

  const bySource = groupBy(withRuling, (m) => m.source);
  for (const [source, group] of bySource.entries()) {
    const r = rateFor(group.map((m) => m.ruling));
    patterns.push({ scope: `source:${source}`, sampleSize: group.length, approvalRate: r.rate, evidence: r.evidence });
  }

  return patterns;
}

// ============================================================================
// 3. RISK PREFERENCE ANALYSIS
// ============================================================================
export interface RiskPreference {
  riskLevel: string;
  sampleSize: number;
  approvalRate: number | null;
  evidence: string;
}
export interface RiskPreferenceSummary {
  byRiskLevel: RiskPreference[];
  overallRead: string;
}

export async function analyzeRiskPreference(limit = 200): Promise<RiskPreferenceSummary> {
  const memories = await fetchDecisionMemories(limit);
  const withRuling = memories.filter((m) => m.ruling !== null && m.riskLevel !== null) as Array<RawDecisionMemory & { ruling: Ruling; riskLevel: string }>;

  const byLevel = groupBy(withRuling, (m) => m.riskLevel);
  const byRiskLevel: RiskPreference[] = Array.from(byLevel.entries()).map(([riskLevel, group]) => {
    const r = rateFor(group.map((m) => m.ruling));
    return { riskLevel, sampleSize: group.length, approvalRate: r.rate, evidence: r.evidence };
  });

  const highRisk = byRiskLevel.find((r) => (r.riskLevel === "high" || r.riskLevel === "critical") && r.approvalRate !== null);
  const lowRisk = byRiskLevel.find((r) => r.riskLevel === "low" && r.approvalRate !== null);

  let overallRead = "insufficient evidence — no risk tier has reached the 5-observation floor yet";
  if (highRisk && lowRisk) {
    overallRead = highRisk.approvalRate! < lowRisk.approvalRate!
      ? `Founder is measurably more cautious at higher risk: ${highRisk.riskLevel} approval rate ${highRisk.approvalRate}% vs. ${lowRisk.riskLevel} at ${lowRisk.approvalRate}%`
      : `No measurable risk-aversion pattern yet: ${highRisk.riskLevel} approval rate (${highRisk.approvalRate}%) is not lower than ${lowRisk.riskLevel}'s (${lowRisk.approvalRate}%)`;
  } else if (byRiskLevel.some((r) => r.approvalRate !== null)) {
    overallRead = "partial evidence — at least one risk tier has enough observations, but not enough tiers to compare";
  }

  return { byRiskLevel, overallRead };
}

// ============================================================================
// 4. EXECUTIVE PERSONA ACCEPTANCE PATTERN ANALYSIS
// ============================================================================
export interface PersonaAcceptance {
  execRole: string;
  sampleSize: number;
  acceptanceRate: number | null;
  evidence: string;
}

export async function analyzeExecutivePersonaAcceptance(limit = 200): Promise<PersonaAcceptance[]> {
  const memories = await fetchDecisionMemories(limit);
  const councilRulings = memories.filter(
    (m) => m.source === "executive-council" && m.execRole !== null && m.ruling !== null,
  ) as Array<RawDecisionMemory & { ruling: Ruling; execRole: string }>;

  const byRole = groupBy(councilRulings, (m) => m.execRole);
  return Array.from(byRole.entries()).map(([execRole, group]) => {
    const r = rateFor(group.map((m) => m.ruling));
    return {
      execRole,
      sampleSize: group.length,
      acceptanceRate: r.rate,
      evidence: r.rate === null ? r.evidence : `ruled in favor of ${execRole} ${r.rate}% of the time (${group.length} rulings)`,
    };
  });
}

// ============================================================================
// 5. FOUNDER DECISION PROFILE GENERATOR
// ============================================================================
export interface FounderDecisionProfile {
  history: DecisionHistorySummary;
  patterns: DecisionPattern[];
  riskPreference: RiskPreferenceSummary;
  personaAcceptance: PersonaAcceptance[];
  generatedAt: string;
  readiness: string;
}

export async function generateFounderDecisionProfile(): Promise<FounderDecisionProfile> {
  const [history, patterns, riskPreference, personaAcceptance] = await Promise.all([
    analyzeDecisionHistory(),
    extractDecisionPatterns(),
    analyzeRiskPreference(),
    analyzeExecutivePersonaAcceptance(),
  ]);
  const readiness = history.rulingsRecorded < MIN_SAMPLE_SIZE
    ? `Insufficient evidence — only ${history.rulingsRecorded} founder ruling(s) recorded so far. Every rate above below the ${MIN_SAMPLE_SIZE}-observation floor honestly reports null rather than a guess.`
    : `${history.rulingsRecorded} founder rulings recorded — patterns that reached the evidence floor are reported above; others still honestly report insufficient evidence.`;
  return { history, patterns, riskPreference, personaAcceptance, generatedAt: new Date().toISOString(), readiness };
}
