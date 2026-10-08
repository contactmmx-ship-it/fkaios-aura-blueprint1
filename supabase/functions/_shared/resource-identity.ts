// One identity convention for every execution resource FKAIOS can use. Every
// subsystem (routing, evidence, learning, benchmarks, adoption, handoffs)
// names resources with these helpers, so a performance record written by one
// subsystem is always found by the others.
//
//   model:<provider>:<model>    a specific model of a specific provider
//   worker:<id>                 an AI employee (ai_agents row) or external worker
//   tool:<provider>:<tool>      a deterministic tool or integration
//   capability:<id>             a capability (e.g. capability:llm:reasoning)

export type ResourceKind = "model" | "worker" | "tool" | "capability";

export function modelRef(provider: string, model: string): string {
  return `model:${provider}:${model}`;
}

export function workerRef(id: string): string {
  return `worker:${id}`;
}

export function toolRef(provider: string, tool: string): string {
  return `tool:${provider}:${tool}`;
}

export function capabilityRef(id: string): string {
  return `capability:${id}`;
}

export function parseRef(ref: string): { kind: ResourceKind; provider?: string; name: string } | null {
  const m = /^(model|worker|tool|capability):(.+)$/.exec(ref);
  if (!m) return null;
  const kind = m[1] as ResourceKind;
  if (kind === "model" || kind === "tool") {
    const i = m[2].indexOf(":");
    if (i <= 0) return null;
    return { kind, provider: m[2].slice(0, i), name: m[2].slice(i + 1) };
  }
  return { kind, name: m[2] };
}

// The task classes FKAIOS routes, evaluates and learns by. Kept small on
// purpose: a class needs enough samples to learn from.
export const TASK_CLASSES = [
  "reasoning", "extraction", "planning", "writing", "verification", "coding", "research_synthesis", "general",
] as const;
export type TaskClass = typeof TASK_CLASSES[number];

/** Deterministic task classification from the task's own text (no LLM call). */
export function classifyTaskClass(title: string, description = ""): TaskClass {
  const t = `${title}\n${description}`.toLowerCase();
  const head = title.toLowerCase();
  if (/^\s*(verify|validate|check|review|audit)\b/.test(head) || /\bverif(y|ication)\b.*\b(against|claims?|sources?|criteria)\b/.test(t)) return "verification";
  if (/\b(code|function|script|implement|refactor|bug|typescript|python|sql|api endpoint|unit test)\b/.test(t)) return "coding";
  if (/^\s*(plan|design|outline|roadmap|break down|decompose)\b/.test(head) || /\b(plan|roadmap|milestones?|step-by-step plan)\b/.test(head)) return "planning";
  if (/\b(research|sources?|market|competitors?|industry|trends?)\b/.test(t)) return "research_synthesis";
  if (/\b(extract|list (the|all)|parse|classify|categori[sz]e|tabulate|identify the)\b/.test(t)) return "extraction";
  if (/\b(write|draft|compose|report|summari[sz]e|email|proposal|article|copy)\b/.test(t)) return "writing";
  if (/\b(analy[sz]e|reason|evaluate|compare|decide|calculate|estimate|why)\b/.test(t)) return "reasoning";
  return "general";
}
