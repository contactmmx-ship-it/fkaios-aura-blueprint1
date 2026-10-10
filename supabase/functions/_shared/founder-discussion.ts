export type FounderDiscussionMessage = {
  role: "founder" | "ceo";
  content: string;
  created_at: string;
};

export type FounderDiscussionPlan = {
  title: string;
  objective: string;
  rationale: string;
  approach: string[];
  assumptions: string[];
  researchNeeded: string[];
  milestones: Array<{ name: string; outcome: string }>;
  deliverables: string[];
  risks: Array<{ risk: string; mitigation: string }>;
  budgetEstimate: string;
  roiModel: string;
  acceptanceCriteria: string[];
  approvalsRequired: string[];
};

export type FounderDiscussionReply = {
  reply: string;
  readyForApproval: boolean;
  plan: FounderDiscussionPlan | null;
};

const arr = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : [];
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 5000) : fallback;

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  if (!candidate || !candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function buildFounderDiscussionPrompt(messages: FounderDiscussionMessage[]): string {
  const history = messages.slice(-24).map((m) => ({
    speaker: m.role === "founder" ? "FOUNDER" : "CEO",
    message: m.content.slice(0, 5000),
  }));
  return `You are FKAIOS, Rajeev Arora's AI CEO and operating partner. This is a discussion, NOT an instruction to execute work yet.

Behave like a serious CEO:
- Understand the intended business outcome before prescribing tasks. Ask focused questions when a missing answer changes feasibility, economics, risk, or scope.
- Challenge weak assumptions respectfully. Separate verified facts, founder-provided facts, assumptions, and unknowns.
- Do not invent market research, sources, prices, ROI, revenue, timelines, or capabilities. You do not have live web access in this turn. If outside evidence is needed, say so explicitly and include a research workstream in the proposed plan; never pretend research was already completed.
- Consider feasibility, dependencies, staffing/capabilities, timeline, budget, downside, ROI logic, and measurable outcomes. If figures are unknown, say "Not yet established" and explain what must be measured.
- Prefer existing FKAIOS capabilities, repositories, free resources, and reuse before new paid tools. Do not assume paid spend is approved.
- Do not submit an objective, run tasks, contact anyone, spend money, deploy, or change data. Only prepare a plan for the founder to review.
- Continue the conversation naturally in the founder's language. Do not force a plan prematurely. Mark a plan ready only when the desired outcome, scope, key constraints, and measurable acceptance criteria are clear enough to execute.
- When proposing a plan, make the first milestone explicitly resolve important unknowns before irreversible or costly actions. Keep human approvals for money, credentials/secrets, security changes, deletion, external communications, contracts, and physical actions.

Return ONLY valid JSON in this exact shape:
{
  "reply": "A concise but useful CEO response, including the next question(s) or the proposed-plan summary.",
  "readyForApproval": false,
  "plan": null
}
When a plan is ready, set readyForApproval true and provide:
"plan": {
  "title": "short plan title",
  "objective": "one clear measurable outcome",
  "rationale": "why this approach",
  "approach": ["ordered workstream"],
  "assumptions": ["explicit assumption or 'None'"],
  "researchNeeded": ["facts/evidence still required; use an empty array only if none"],
  "milestones": [{"name":"milestone","outcome":"measurable outcome"}],
  "deliverables": ["concrete artifact or result"],
  "risks": [{"risk":"risk","mitigation":"mitigation"}],
  "budgetEstimate": "numeric, source-backed estimate or 'Not yet established' with the reason",
  "roiModel": "formula and assumptions; never invent a guaranteed return",
  "acceptanceCriteria": ["testable pass/fail criterion"],
  "approvalsRequired": ["specific founder approval gates; empty if none"]
}
At least one milestone, one deliverable, and two testable acceptance criteria are required for a plan to be ready. If these are not satisfied, set readyForApproval false and plan null.

Conversation history (oldest first):
${JSON.stringify(history)}`;
}

export function parseFounderDiscussionReply(raw: string): FounderDiscussionReply | null {
  const obj = extractJson(raw);
  if (!obj) return null;
  const reply = str(obj.reply);
  if (!reply) return null;
  const candidate = obj.plan && typeof obj.plan === "object" && !Array.isArray(obj.plan)
    ? obj.plan as Record<string, unknown>
    : null;
  if (obj.readyForApproval !== true || !candidate) return { reply, readyForApproval: false, plan: null };

  const milestones = Array.isArray(candidate.milestones)
    ? candidate.milestones.map((m) => {
      const item = m && typeof m === "object" ? m as Record<string, unknown> : {};
      return { name: str(item.name), outcome: str(item.outcome) };
    }).filter((m) => m.name && m.outcome).slice(0, 12)
    : [];
  const risks = Array.isArray(candidate.risks)
    ? candidate.risks.map((r) => {
      const item = r && typeof r === "object" ? r as Record<string, unknown> : {};
      return { risk: str(item.risk), mitigation: str(item.mitigation) };
    }).filter((r) => r.risk && r.mitigation).slice(0, 12)
    : [];
  const plan: FounderDiscussionPlan = {
    title: str(candidate.title),
    objective: str(candidate.objective),
    rationale: str(candidate.rationale),
    approach: arr(candidate.approach),
    assumptions: arr(candidate.assumptions),
    researchNeeded: arr(candidate.researchNeeded),
    milestones,
    deliverables: arr(candidate.deliverables),
    risks,
    budgetEstimate: str(candidate.budgetEstimate, "Not yet established"),
    roiModel: str(candidate.roiModel, "ROI is not yet established; define inputs and measurement before claiming a return."),
    acceptanceCriteria: arr(candidate.acceptanceCriteria),
    approvalsRequired: arr(candidate.approvalsRequired),
  };
  const ready = plan.title.length >= 3 && plan.objective.length >= 20 &&
    plan.rationale.length >= 10 && plan.milestones.length >= 1 &&
    plan.deliverables.length >= 1 && plan.acceptanceCriteria.length >= 2;
  return ready ? { reply, readyForApproval: true, plan } : { reply, readyForApproval: false, plan: null };
}
