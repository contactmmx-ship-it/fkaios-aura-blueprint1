// Brain Chat helpers (29 Oct 2026). Pure, so they are unit-tested in CI.
// Context: PR #220 deployed main's brain-engine over the live v66 build. The live build added the founder's
// operating principles to every answer and did not crash when no AI provider answered; main's code did neither.

/** Founder operating principles block, same wording the live Brain Chat used before #220. */
export function principlesBlock(rows: { principle: string }[]): string {
  const list = rows.map((r) => String(r.principle || '').trim()).filter(Boolean);
  if (!list.length) return '';
  return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${list.map((p) => `- ${p}`).join('\n')}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
}

/** The shared Founder Brain returns null when every provider fails; say so instead of crashing. */
export const NO_PROVIDER_REPLY = 'No AI provider answered just now, so I have no answer yet. Nothing was saved as fact. Please try again in a minute.';
export function replyText(result: { text?: string | null } | null | undefined): string {
  const text = result?.text?.trim();
  return text ? text : NO_PROVIDER_REPLY;
}
