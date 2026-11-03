// Figures contract for objective work (3 Nov 2026).
//
// Why: the first live GoMax objective (2cceed20) produced a plan built on a
// receivables figure that its own cited source marked "unverified — do not
// use", and invented dealer counts, team structure and monthly targets as if
// they were facts. It also ignored the client's recorded situation (an open fee
// dispute and stated losses). This contract is added to every task prompt that
// belongs to a founder objective so each number has a declared origin.

export const FIGURES_CONTRACT = `

FIGURES RULE (mandatory for this objective):
1. Every number you write (money, counts, percentages, headcount, dates, targets) must have ONE declared origin:
   a) SOURCE: quoted from the supplied evidence or founder memory; name the source next to it.
   b) FOUNDER-STATED: given by the founder in the objective text; write "(founder-stated, unverified)" next to it.
   c) ASSUMPTION: a projection or target you derive; prefix it with "Assumption:" and show the formula using only (a) or (b) figures.
2. Never present an invented count, split, team structure or per-person target as a fact. If you cannot derive it from (a) or (b), write "unknown" and list it under missing information.
3. If any source says a figure is unverified, disputed, or must not be used, do NOT build the plan on it. Report it under missing or conflicting information instead.
4. If two sources disagree on a figure, show both with their sources and list the conflict.
5. Before recommending actions, check the evidence for this client's open issues (disputes, unpaid fees, stated losses, paused systems, recorded next steps). State them first and make the plan address them.`;

/** Returns the contract for jobs that belong to a founder objective; empty otherwise. */
export function figuresContract(payload: Record<string, unknown> | null | undefined): string {
  const objectiveId = payload?.objective_id;
  return typeof objectiveId === "string" && objectiveId.length > 0 ? FIGURES_CONTRACT : "";
}
