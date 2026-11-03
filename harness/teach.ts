/**
 * Teach (Blake, 2026-11-03), pure parts: the day's lesson deck (theory cards
 * from the scheduler, whatever the practice window) and the bullet points of
 * the popup that opens Teach, from the current unlocked chapter. Locking and
 * graduation stay in the theory module (src/modules/theory/practice.ts).
 */
import { goalQueue } from '../src/index.ts';
import type { Library } from '../src/index.ts';
import { CURRICULUM_CHAPTERS, LESSONS } from '../src/modules/theory/curriculum.ts';
import type { LessonState } from '../src/modules/theory/practice.ts';
import type { Objective } from './today.ts';

/**
 * The day's Teach deck: the theory module's cards from the same scheduler as
 * Home (due first, riskiest first; then new, in teaching order). Unlike Home,
 * it does not depend on the window: you sat down to study.
 */
export function teachDeck(library: Library, now: number, moduleId: string): { due: string[]; fresh: string[] } {
  const mine = (cardId: string) => library.items.get(library.cards.get(cardId)?.itemId ?? '')?.module === moduleId;
  const q = goalQueue(library, now);
  return { due: q.due.map((d) => d.memory.cardId).filter(mine), fresh: q.fresh.filter(mine) };
}

/** "Chapter 1 · Sound itself", and how far through it the course is. */
export function chapterLine(state: LessonState): string {
  const inChapter = LESSONS.filter((l) => l.chapter === state.lesson.chapter);
  const at = inChapter.findIndex((l) => l.n === state.lesson.n) + 1;
  return `Chapter ${state.lesson.chapter} · ${CURRICULUM_CHAPTERS[state.lesson.chapter] ?? ''} · lesson ${at} of ${inChapter.length}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Today's Teach objectives for the current lesson (null once every lesson
 * has graduated): read it if it is new, learn the new cards, review what is
 * due, and what unlocks the next lesson.
 */
export function teachObjectives(state: LessonState | null, deck: { due: number; fresh: number }): Objective[] {
  const out: Objective[] = [];
  if (!state) {
    out.push({ kind: 'none', text: 'Every lesson has graduated.' });
    if (deck.due > 0) out.push({ kind: 'deck', text: `Review ${plural(deck.due, 'card', 'cards')} due` });
    return out;
  }
  if (state.started === 0) out.push({ kind: 'lesson', text: `Read the lesson: ${state.lesson.title}` });
  if (deck.fresh > 0) out.push({ kind: 'deck', text: `Learn ${plural(deck.fresh, 'new card', 'new cards')}` });
  if (deck.due > 0) out.push({ kind: 'deck', text: `Review ${plural(deck.due, 'card', 'cards')} due` });
  const next = LESSONS[state.lesson.n];
  const goal = next ? `unlock Lesson ${next.n} · ${next.title}` : 'finish the course';
  out.push({ kind: 'block', text: `Make all ${state.total} cards solid to ${goal} (${state.ready} of ${state.total} so far)`, done: state.ready === state.total });
  if (deck.fresh === 0 && deck.due === 0) {
    out.push({ kind: 'none', text: 'Nothing due right now. The cards come back on a later day, and getting them right then is what unlocks the next lesson.' });
  }
  return out;
}
