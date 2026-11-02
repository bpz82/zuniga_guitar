/**
 * Theory and physics flashcards as an engine module (contract v1). Every
 * card is tagged pocket-silent: off the instrument, no sound, fine at work.
 * Two card types: "qa" (show answer, rate Again/Hard/Good/Easy) and "mc"
 * (pick one of four; right is Good, wrong is Again).
 *
 * The curriculum (Blake, 2026-11-02): one course from both books, lesson by
 * lesson (curriculum.ts). A lesson's cards enter the log only when the lesson
 * unlocks, so the scheduler never serves locked material. Lesson 1 is open
 * from the start; each next lesson unlocks when the one before graduates.
 *
 * Graduation rule (GRADUATE_STABILITY_DAYS): a lesson graduates when every one
 * of its cards (1) has been answered, (2) was answered right the last time
 * (not Again), and (3) has a memory stability of at least 7 days, meaning the
 * scheduler's memory model expects you to still recall it (90% likely) a week
 * from now. In practice: right once, then right again on a later day (a Q/A
 * card rated Easy the very first time also counts at once; a multiple-choice
 * answer is at most Good, so it always needs the later day). Unlocking is
 * permanent: a later slip does not lock the next lesson again.
 *
 * Superseded (2026-11-02): the 2026-10-31 topic deck's book cards are retired
 * on first launch (history kept). Its "general" cards (guitar theory, cassette
 * gear, not from the books) stay as Extras, off by default, switchable on the
 * Cards screen. Topic switching (topics, setTopic) is kept for the record only.
 */
import type { ModuleHost, ModuleManifest } from '../../contract.ts';
import type { DayStart, Rating } from '../../model.ts';
import { DEFAULT_DAY_START } from '../../model.ts';
import { memoryOf } from '../../scheduler.ts';
import type { Validation } from '../../validate.ts';
import { cardById, DECK, TOPICS } from './deck.ts';
import type { McCard, QaCard, TheoryCard, Topic } from './deck.ts';
import { CURRICULUM_CHAPTERS, lessonCardById, LESSONS } from './curriculum.ts';
import type { Lesson, LessonCard, LessonMc } from './curriculum.ts';

export const THEORY: ModuleManifest = Object.freeze({
  id: 'theory',
  contract: 1,
  templates: Object.freeze([
    Object.freeze({ template: 'qa', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'mc', tags: Object.freeze(['pocket-silent'] as const) }),
  ]),
});

/** Days of memory stability every card of a lesson needs before the next lesson unlocks. */
export const GRADUATE_STABILITY_DAYS = 7;

export const itemIdOf = (id: string) => `th-${id}`;
export const cardIdOf = (id: string) => `th-${id}-c`;
const deckIdOf = (cardId: string) => (cardId.startsWith('th-') && cardId.endsWith('-c') ? cardId.slice(3, -2) : null);

/** A card's content: a curriculum card, or one from the superseded topic deck (the Extras among them). */
export type Content = LessonCard | TheoryCard;
export type McContent = LessonMc | McCard;

const isExtra = (c: TheoryCard) => c.source.book === 'general';
/** The superseded deck's general cards, kept as Extras. */
export const EXTRAS: readonly TheoryCard[] = Object.freeze(DECK.filter(isExtra));
const LEGACY_BOOK: readonly TheoryCard[] = Object.freeze(DECK.filter((c) => !isExtra(c)));

/** The content behind an engine card id, if this module owns it. */
export function contentOf(host: ModuleHost, cardId: string): Content | undefined {
  const id = deckIdOf(cardId);
  if (id === null || !host.cards().some((c) => c.id === cardId)) return undefined;
  return lessonCardById(id) ?? cardById(id);
}

/** The lesson a card belongs to, if it is a curriculum card. */
export const lessonOfCard = (host: ModuleHost, cardId: string): Lesson | undefined => {
  const c = contentOf(host, cardId);
  return c && 'lesson' in c ? LESSONS[c.lesson - 1] : undefined;
};

// ------------------------------------------------------------ graduation --

/** Whether one card meets the graduation rule. */
function cardReady(host: ModuleHost, cardId: string, dayStart: DayStart): boolean {
  const reviews = host.reviews(cardId);
  const last = reviews.at(-1);
  if (!last || last.rating === 'again') return false;
  return memoryOf(cardId, reviews, 0.9, dayStart).stability >= GRADUATE_STABILITY_DAYS;
}

export type LessonStatus = 'graduated' | 'current' | 'locked';

export interface LessonState {
  readonly lesson: Lesson;
  readonly chapterTitle: string;
  readonly status: LessonStatus;
  /** Cards that meet the graduation rule now. */
  readonly ready: number;
  /** Cards answered at least once. */
  readonly started: number;
  readonly total: number;
}

/**
 * Every lesson's state. A lesson is unlocked once any of its cards is in the
 * log; the highest unlocked lesson is current until all its cards are ready.
 */
export function lessonStates(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): LessonState[] {
  const inLog = new Set(host.cards().map((c) => c.id));
  const unlocked = LESSONS.filter((l) => l.cards.some((c) => inLog.has(cardIdOf(c.id)))).length;
  return LESSONS.map((lesson) => {
    const ids = lesson.cards.map((c) => cardIdOf(c.id)).filter((id) => inLog.has(id));
    const ready = ids.filter((id) => cardReady(host, id, dayStart)).length;
    const started = ids.filter((id) => host.reviews(id).length > 0).length;
    const total = lesson.cards.length;
    const status: LessonStatus =
      lesson.n > Math.max(1, unlocked) ? 'locked' : lesson.n < unlocked || ready === total ? 'graduated' : 'current';
    return { lesson, chapterTitle: CURRICULUM_CHAPTERS[lesson.chapter] ?? '', status, ready, started, total };
  });
}

/** The lesson being worked on now (null once the whole course has graduated). */
export function currentLesson(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): LessonState | null {
  return lessonStates(host, dayStart).find((s) => s.status === 'current') ?? null;
}

// --------------------------------------------------------------- seeding --

async function addCard(host: ModuleHost, id: string, type: 'qa' | 'mc', fields: Record<string, string | number>): Promise<boolean> {
  if (!host.items().some((i) => i.id === itemIdOf(id))) await host.addItem(itemIdOf(id), fields);
  if (host.cards().some((c) => c.id === cardIdOf(id))) return false;
  await host.addCard(cardIdOf(id), itemIdOf(id), type);
  return true;
}

/**
 * Brings the log up to date; safe on every launch and after every answer.
 *   1. The first time after the rebuild: retires the superseded deck's book
 *      cards and switches the Extras off (both keep their history).
 *   2. Adds the cards of every unlocked lesson, unlocking the next lesson when
 *      the current one has graduated (one at a time).
 *   3. Adds any Extras not yet in the log, off unless the Extras are on.
 * Returns how many cards it added.
 */
export async function seedTheory(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): Promise<number> {
  const byId = () => new Map(host.cards().map((c) => [c.id, c]));
  const before = byId();
  const firstAfterRebuild = LEGACY_BOOK.some((c) => before.get(cardIdOf(c.id))?.retired === false);
  if (firstAfterRebuild) {
    for (const c of [...LEGACY_BOOK, ...EXTRAS]) if (before.get(cardIdOf(c.id))?.retired === false) await host.retireCard(cardIdOf(c.id));
  }
  let added = 0;
  // Lessons: everything already unlocked (completing any half-written one),
  // then the next lesson if the one before it meets the graduation rule.
  let states = lessonStates(host, dayStart);
  for (const lesson of LESSONS) {
    if (states[lesson.n - 1]!.status === 'locked') {
      const previous = states[lesson.n - 2];
      if (!previous || previous.ready < previous.total) break;
    }
    let changed = false;
    for (const c of lesson.cards) {
      if (await addCard(host, c.id, c.type, { lesson: lesson.n })) {
        added++;
        changed = true;
      }
    }
    if (changed) states = lessonStates(host, dayStart);
  }
  const extrasOn = extras(host).on > 0;
  for (const c of EXTRAS) {
    if (await addCard(host, c.id, c.type, { topic: c.topic })) {
      added++;
      if (!extrasOn) await host.retireCard(cardIdOf(c.id));
    }
  }
  return added;
}

// ---------------------------------------------------------------- extras --

export interface ExtrasState {
  readonly total: number;
  readonly on: number;
}

export function extras(host: ModuleHost): ExtrasState {
  const byId = new Map(host.cards().map((c) => [c.id, c]));
  const mine = EXTRAS.map((c) => byId.get(cardIdOf(c.id))).filter((c) => c !== undefined);
  return { total: mine.length, on: mine.filter((c) => !c.retired).length };
}

/** Turns the Extras on or off. Writes only the cards that change; history is kept either way. */
export async function setExtras(host: ModuleHost, on: boolean): Promise<Validation<ExtrasState>> {
  if (typeof on !== 'boolean') return { ok: false, error: 'on must be true or false' };
  for (const c of host.cards().filter((x) => EXTRAS.some((e) => cardIdOf(e.id) === x.id))) {
    if (c.retired !== on) continue;
    if (on) await host.addCard(c.id, c.itemId, c.template);
    else await host.retireCard(c.id);
  }
  return { ok: true, value: extras(host) };
}

// ------------------------------------------- superseded: topics (2026-10-31) --

export interface TopicState {
  readonly topic: Topic;
  readonly label: string;
  /** Cards of this topic in the log. */
  readonly total: number;
  /** Of those, how many are switched on. */
  readonly on: number;
}

/** Superseded by the curriculum (2026-11-02); kept for the record. */
export function topics(host: ModuleHost): TopicState[] {
  const byId = new Map(host.cards().map((c) => [c.id, c]));
  return TOPICS.map(({ id, label }) => {
    const mine = DECK.filter((c) => c.topic === id).map((c) => byId.get(cardIdOf(c.id))).filter((c) => c !== undefined);
    return { topic: id, label, total: mine.length, on: mine.filter((c) => !c.retired).length };
  });
}

/** Superseded by the curriculum and setExtras (2026-11-02); kept for the record. */
export async function setTopic(host: ModuleHost, topic: Topic, on: boolean): Promise<Validation<TopicState>> {
  if (!TOPICS.some((t) => t.id === topic)) return { ok: false, error: `no topic ${String(topic)}` };
  const byId = new Map(host.cards().map((c) => [c.id, c]));
  for (const c of DECK.filter((x) => x.topic === topic)) {
    const card = byId.get(cardIdOf(c.id));
    if (!card || card.retired !== on) continue;
    if (on) await host.addCard(card.id, card.itemId, card.template);
    else await host.retireCard(card.id);
  }
  return { ok: true, value: topics(host).find((t) => t.topic === topic)! };
}

// --------------------------------------------------------------- answers --

/** The four options of a multiple-choice card, in an order set by `seed` (so position is never the cue). */
export function optionsFor(card: McContent, seed: number): string[] {
  const opts = [card.answer, ...card.wrong];
  let s = (seed >>> 0) || 1;
  for (let i = opts.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [opts[i], opts[j]] = [opts[j]!, opts[i]!];
  }
  return opts;
}

const clampMs = (ms: number) => Math.round(Math.min(Math.max(0, Number.isFinite(ms) ? ms : 0), 10 * 60 * 1000));
const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];
/** What a review records about the card: its lesson, or its old topic. */
const detailsOf = (c: Content) => ('lesson' in c ? { lesson: c.lesson } : { topic: c.topic });

/** Logs a rating for a Q/A card. */
export async function rateQa(host: ModuleHost, cardId: string, rating: Rating, durationMs: number): Promise<Validation<Content & { type: 'qa' }>> {
  const card = contentOf(host, cardId);
  if (!card) return { ok: false, error: `no theory card ${cardId}` };
  if (card.type !== 'qa') return { ok: false, error: 'multiple-choice cards are answered by picking an option' };
  if (!RATINGS.includes(rating)) return { ok: false, error: `bad rating ${String(rating)}` };
  if (host.cards().find((c) => c.id === cardId)?.retired) return { ok: false, error: 'that card is switched off' };
  await host.reportRep(cardId, rating, clampMs(durationMs), detailsOf(card));
  return { ok: true, value: card as (QaCard | LessonCard) & { type: 'qa' } };
}

/** Logs a multiple-choice answer: right is Good, wrong is Again. */
export async function answerMc(host: ModuleHost, cardId: string, choice: string, durationMs: number): Promise<Validation<{ correct: boolean; card: McContent }>> {
  const card = contentOf(host, cardId);
  if (!card) return { ok: false, error: `no theory card ${cardId}` };
  if (card.type !== 'mc') return { ok: false, error: 'Q/A cards are rated after showing the answer' };
  if (![card.answer, ...card.wrong].includes(choice)) return { ok: false, error: 'not one of the options' };
  if (host.cards().find((c) => c.id === cardId)?.retired) return { ok: false, error: 'that card is switched off' };
  const correct = choice === card.answer;
  await host.reportRep(cardId, correct ? 'good' : 'again', clampMs(durationMs), { ...detailsOf(card), correct });
  return { ok: true, value: { correct, card } };
}
