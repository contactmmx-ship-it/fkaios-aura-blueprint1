// Draft Studio (My Brain) memory grounding — 29 Oct 2026.
// The Maker used to draft from the brief alone. It now receives what the founder's one memory
// (fkaios_knowledge_*, same recall as Brain Chat) already holds about the brief, so drafts reuse
// real past figures and decisions and cite where they came from.
import type { Recalled } from './brain-recall.ts';

/** Words to search the memory with: the project's title, client and brief. */
export function draftMemoryQuery(p: { title?: string | null; client_name?: string | null; brief?: string | null }): string {
  return [p.title, p.client_name, p.brief].filter((x) => typeof x === 'string' && x.trim()).join(' ').slice(0, 600);
}

/** Memory block appended to the Maker's input. Empty when nothing relevant was recalled. */
export function draftMemoryBlock(items: Recalled[]): string {
  if (!items.length) return '';
  return '\n\n=== FROM THE FOUNDER\'S MEMORY (past chats, register, documents; may be outdated) ===\n' +
    items.map((r, i) => `${i + 1}. [${r.title}${r.page ? `, p.${r.page}` : ''}] ${r.excerpt.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n') +
    '\n=== END MEMORY ===\nUse these facts where they fit the brief and name the source in brackets. Do not invent figures that are not in the brief or the memory.';
}

/** The Maker's user message: brief, last Critic feedback, then the memory block. */
export function makerInput(brief: string, lastCritic: string | null, memory: string): string {
  return `Brief: ${brief}\n${lastCritic ? `Previous Critic feedback to address: ${lastCritic}` : 'This is the first draft.'}${memory}`;
}
