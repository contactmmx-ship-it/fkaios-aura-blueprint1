// Draft Studio (My Brain) memory grounding — 29 Oct 2026.
// The Maker used to draft from the brief alone. It now receives what the founder's one memory
// (fkaios_knowledge_*, same recall as Brain Chat) already holds about the brief, so drafts reuse
// real past figures and decisions and cite where they came from.
/** Same shape as brain-recall.ts Recalled (kept local so this helper has no network imports). */
export interface Recalled { title: string; page: number | null; excerpt: string }

/** Words that describe the drafting task, not its subject; they crowd the subject out of recall's first 6 terms. */
const TASK_WORDS = new Set(('test draft studio memory acceptance project brief summary objective create new one page pager ' +
  'document deck doc write writing prepare jan feb mar apr may jun jul aug sep oct nov dec').split(' '));

/** Words to search the memory with: the subject only — client, the brief's heading line, the title — minus task words.
 *  The brief body is used only when those give nothing.
 *  29 Oct acceptance test: title-first put "test draft studio memory acceptance oct" in recall's 6 terms and the
 *  GoMax scheme document was missed; brief-body words ("clear concise commercial") pushed it to rank 5.
 *  Subject-only ("gomax dealer scheme") finds it at rank 1. */
export function draftMemoryQuery(p: { title?: string | null; client_name?: string | null; brief?: string | null }): string {
  const clean = (t: string) => (t.match(/[\p{L}\p{N}%₹.]+/gu) || []).filter((w) => !TASK_WORDS.has(w.toLowerCase())).join(' ');
  const brief = typeof p.brief === 'string' ? p.brief : '';
  const heading = brief.split('\n').find((l) => l.trim()) || '';
  const subject = clean([p.client_name || '', heading, p.title || ''].join(' '));
  return (subject || clean(brief)).slice(0, 600);
}

/** Characters of each recalled page given to the Maker (recall returns up to 1,500).
 *  29 Oct: at 500 the GoMax scheme page was cited but its figures (chars 775–932) were cut off. */
export const EXCERPT_CHARS = 1500;

/** Memory block appended to the Maker's input. Empty when nothing relevant was recalled. */
export function draftMemoryBlock(items: Recalled[]): string {
  if (!items.length) return '';
  return '\n\n=== FROM THE FOUNDER\'S MEMORY (past chats, register, documents; may be outdated) ===\n' +
    items.map((r, i) => `${i + 1}. [${r.title}${r.page ? `, p.${r.page}` : ''}] ${r.excerpt.replace(/\s+/g, ' ').slice(0, EXCERPT_CHARS)}`).join('\n') +
    '\n=== END MEMORY ===\nUse these facts where they fit the brief and name the source in brackets. Do not invent figures that are not in the brief or the memory.';
}

/** The Maker's user message: brief, last Critic feedback, then the memory block. */
export function makerInput(brief: string, lastCritic: string | null, memory: string): string {
  return `Brief: ${brief}\n${lastCritic ? `Previous Critic feedback to address: ${lastCritic}` : 'This is the first draft.'}${memory}`;
}

/** The Critic's user message. It sees the same memory the Maker saw, so real recalled figures are not
 *  rejected as "fabricated" (29 Oct acceptance run 3) and figures in neither brief nor memory are flagged. */
export function criticInput(brief: string, makerOutput: string, memory: string): string {
  const base = `Brief: ${brief}\n\nMaker's output:\n${makerOutput}`;
  if (!memory) return base;
  return base + memory.replace('=== FROM THE FOUNDER\'S MEMORY', '=== THE MAKER WAS GIVEN THIS FROM THE FOUNDER\'S MEMORY') +
    '\nCritic: figures and facts that match this memory are real (they override placeholders in the brief) and their [source] tags are valid; ' +
    'flag any figure or claim that is in neither the brief nor this memory as invented.';
}

/** The planner's (brief writer's) user message. Without memory it turned "the exact figures we agreed" into
 *  "[XX%] placeholders" (29 Oct acceptance run 4), and every later round deferred to that brief. */
export function plannerInput(request: string, memory: string): string {
  if (!memory) return request;
  return request + memory +
    '\nPlanner: put the figures and facts from this memory that the request refers to into the brief, with their source; ' +
    'use placeholders only for what neither the request nor this memory gives.';
}
