/**
 * Theory and physics flashcards as an engine module (contract v1). Every
 * card is tagged pocket-silent: off the instrument, no sound, fine at work.
 * Two card types: "qa" (show answer, rate Again/Hard/Good/Easy) and "mc"
 * (pick one of four; right is Good, wrong is Again).
 *
 * The curriculum (Blake, 2026-11-02): one course from both books, lesson by
 * lesson (curriculum.ts). A lesson's cards enter the log only when the lesson
 * is open, so the scheduler never serves material beyond the horizon.
 *
 * Guided exploration (Blake, 2026-11-08): no rigid later-chapter locking. The
 * horizon is the chapter of the first lesson not yet graduated plus
 * CHAPTER_HORIZON (3) chapters ahead: every lesson up to there is open, so
 * new cards can be learned ahead of strict order until the available new
 * cards run out. Beyond the horizon a lesson stays locked and its cards are
 * not in the log. (Superseded: 2026-11-02, a lesson opened only when the one
 * before it graduated.)
 *
 * Graduation rule (GRADUATE_STABILITY_DAYS): a lesson graduates when every one
 * of its cards (1) has been answered, (2) was answered right the last time
 * (not Again), and (3) has a memory stability of at least 7 days, meaning the
 * scheduler's memory model expects you to still recall it (90% likely) a week
 * from now. In practice: right once, then right again on a later day (a Q/A
 * card rated Easy the very first time also counts at once; a multiple-choice
 * answer is at most Good, so it always needs the later day). Graduation moves
 * the horizon forward. Cards already in the log are never taken away: a later
 * slip pulls the horizon back for new lessons only.
 *
 * Superseded (2026-11-02): the 2026-10-31 topic deck's book cards are retired
 * on first launch (history kept). Topic switching (topics, setTopic) is kept
 * for the record only.
 *
 * Course rebuild (2026-11-13): nine chapters, with the electric guitar on
 * stage (chapter 3) and music theory (chapter 4). Cards keep their ids
 * whatever lesson they now sit in. Several topic-deck cards are back in the
 * course under their old ids (the old guitar-theory and cassette Extras among
 * them): seeding switches each one on again when its lesson opens, history
 * and all. Cards taken out of the course (RETIRED_COURSE_IDS) are switched
 * off. The Extras are now advanced cards beside a lesson's reading (dBu and
 * dBV, the 7th harmonic, the NIOSH guideline), still off by default; their
 * on/off state follows db-exposure, the one card that was an Extra before and
 * still is, so an old log keeps the choice it had.
 */
import type { ModuleHost, ModuleManifest } from '../../contract.ts';
import type { DayStart, Rating } from '../../model.ts';
import { DEFAULT_DAY_START } from '../../model.ts';
import { isExtraReview, memoryOf } from '../../scheduler.ts';
import type { Validation } from '../../validate.ts';
import { cardById, DECK, TOPICS } from './deck.ts';
import type { McCard, QaCard, TheoryCard, Topic } from './deck.ts';
import { CURRICULUM_CHAPTERS, EXTRA_CARDS, lessonCardById, LESSON_CARDS, LESSONS, RETIRED_COURSE_IDS } from './curriculum.ts';
import type { Lesson, LessonCard, LessonMc } from './curriculum.ts';

export const THEORY: ModuleManifest = Object.freeze({
  id: 'theory',
  contract: 1,
  templates: Object.freeze([
    Object.freeze({ template: 'qa', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'mc', tags: Object.freeze(['pocket-silent'] as const) }),
  ]),
});

/** Days of memory stability every card of a lesson needs before it counts as graduated. */
export const GRADUATE_STABILITY_DAYS = 7;

/**
 * Chapters ahead of current progress that are open for review (Blake,
 * 2026-11-08: "two or three chapters ahead"; three is used).
 */
export const CHAPTER_HORIZON = 3;

export const itemIdOf = (id: string) => `th-${id}`;
export const cardIdOf = (id: string) => `th-${id}-c`;
const deckIdOf = (cardId: string) => (cardId.startsWith('th-') && cardId.endsWith('-c') ? cardId.slice(3, -2) : null);

/** A card's content: a curriculum card (or Extra), or one from the superseded topic deck. */
export type Content = LessonCard | TheoryCard;
export type McContent = LessonMc | McCard;

/** The Extras (2026-11-13): advanced cards beside a lesson's reading, off by default. */
export const EXTRAS: readonly LessonCard[] = EXTRA_CARDS;
/** The Extra whose state decides the rest: it was an Extra before the 2026-11-13 rebuild and still is. */
export const EXTRA_ANCHOR = 'db-exposure';
const IN_COURSE = new Set([...LESSON_CARDS, ...EXTRA_CARDS].map((c) => c.id));
/** The superseded deck's book cards that stayed out of the course: retired once, at the 2026-11-02 rebuild. */
const LEGACY_BOOK: readonly TheoryCard[] = Object.freeze(DECK.filter((c) => c.source.book !== 'general' && !IN_COURSE.has(c.id)));

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
  // Extra reviews (practice before a card is due) never count towards graduating.
  const reviews = host.reviews(cardId).filter((r) => !isExtraReview(r));
  const last = reviews.at(-1);
  if (!last || last.rating === 'again') return false;
  return memoryOf(cardId, reviews, 0.9, dayStart).stability >= GRADUATE_STABILITY_DAYS;
}

/** graduated: done. current: the first lesson not yet graduated. open: inside the horizon, after the current one. locked: beyond the horizon. */
export type LessonStatus = 'graduated' | 'current' | 'open' | 'locked';

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

export interface Horizon {
  /** The current lesson (the first not yet graduated), or null once the whole course has graduated. */
  readonly current: Lesson | null;
  /** The chapter of the current lesson (the last chapter once the course is done). */
  readonly chapter: number;
  /** The last chapter open for review: chapter + CHAPTER_HORIZON. */
  readonly last: number;
}

/** Whether every card of a lesson is in the log and meets the graduation rule. */
function graduated(host: ModuleHost, lesson: Lesson, dayStart: DayStart, inLog: ReadonlySet<string>): boolean {
  return lesson.cards.every((c) => inLog.has(cardIdOf(c.id)) && cardReady(host, cardIdOf(c.id), dayStart));
}

/** Where progress is and how far ahead new lessons are open. */
export function horizon(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): Horizon {
  const inLog = new Set(host.cards().map((c) => c.id));
  const current = LESSONS.find((l) => !graduated(host, l, dayStart, inLog)) ?? null;
  const chapter = current?.chapter ?? LESSONS.at(-1)!.chapter;
  return { current, chapter, last: chapter + CHAPTER_HORIZON };
}

/**
 * Every lesson's state. Lessons up to the horizon are open: the first one not
 * yet graduated is current, the rest (even earlier ones left unfinished) are
 * graduated or open.
 */
export function lessonStates(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): LessonState[] {
  const inLog = new Set(host.cards().map((c) => c.id));
  const h = horizon(host, dayStart);
  return LESSONS.map((lesson) => {
    const ids = lesson.cards.map((c) => cardIdOf(c.id)).filter((id) => inLog.has(id));
    const ready = ids.filter((id) => cardReady(host, id, dayStart)).length;
    const started = ids.filter((id) => host.reviews(id).length > 0).length;
    const total = lesson.cards.length;
    const status: LessonStatus =
      ready === total ? 'graduated' : h.current?.n === lesson.n ? 'current' : lesson.chapter <= h.last || ids.length > 0 ? 'open' : 'locked';
    return { lesson, chapterTitle: CURRICULUM_CHAPTERS[lesson.chapter] ?? '', status, ready, started, total };
  });
}

/** The lesson being worked on now (null once the whole course has graduated). */
export function currentLesson(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): LessonState | null {
  return lessonStates(host, dayStart).find((s) => s.status === 'current') ?? null;
}

/**
 * Whether a card may be served as NEW: curriculum cards only inside the
 * horizon; any other card (the Extras, other modules') always. Cards already
 * started are not affected: they are reviewed whenever due.
 */
export function withinHorizon(host: ModuleHost, cardId: string, dayStart: DayStart = DEFAULT_DAY_START): boolean {
  return newCardFilter(host, dayStart)(cardId);
}

/** withinHorizon for many cards: the horizon is worked out once. */
export function newCardFilter(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): (cardId: string) => boolean {
  const last = horizon(host, dayStart).last;
  return (cardId) => {
    const lesson = lessonOfCard(host, cardId);
    return lesson === undefined || lesson.chapter <= last;
  };
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
 *   1. The first time after the 2026-11-02 rebuild: retires the superseded
 *      deck's cards (history kept), except those back in an open lesson.
 *   2. Switches off cards taken out of the course (RETIRED_COURSE_IDS).
 *   3. Adds the cards of every open lesson: all lessons up to the horizon
 *      (see CHAPTER_HORIZON). A card already there but switched off (a deck
 *      card back in the course) is switched on again, with its history.
 *   4. Adds any Extras not yet in the log, and keeps every Extra on or off
 *      together, following EXTRA_ANCHOR (off in a new log).
 * Returns how many cards it added or switched on.
 */
export async function seedTheory(host: ModuleHost, dayStart: DayStart = DEFAULT_DAY_START): Promise<number> {
  const byId = () => new Map(host.cards().map((c) => [c.id, c]));
  // Everything inside the horizon. The horizon only moves when a lesson
  // graduates, which adding new (unanswered) cards can't do, so once is enough.
  const open = horizon(host, dayStart).last;
  const openIds = new Set(LESSONS.filter((l) => l.chapter <= open).flatMap((l) => l.cards.map((c) => c.id)));
  const before = byId();
  const active = (id: string) => before.get(cardIdOf(id))?.retired === false;
  if (LEGACY_BOOK.some((c) => active(c.id))) {
    for (const c of DECK) if (active(c.id) && !openIds.has(c.id)) await host.retireCard(cardIdOf(c.id));
  }
  for (const id of RETIRED_COURSE_IDS) if (active(id)) await host.retireCard(cardIdOf(id));
  let added = 0;
  for (const lesson of LESSONS) {
    if (lesson.chapter > open) break;
    for (const c of lesson.cards) {
      if (await addCard(host, c.id, c.type, { lesson: lesson.n })) {
        added++;
        continue;
      }
      const card = byId().get(cardIdOf(c.id))!;
      if (card.retired) {
        await host.addCard(card.id, card.itemId, card.template);
        added++;
      }
    }
  }
  const anchor = byId().get(cardIdOf(EXTRA_ANCHOR));
  const extrasOn = anchor !== undefined && !anchor.retired;
  for (const c of EXTRAS) {
    if (await addCard(host, c.id, c.type, { lesson: c.lesson })) {
      added++;
      if (!extrasOn) await host.retireCard(cardIdOf(c.id));
      continue;
    }
    const card = byId().get(cardIdOf(c.id))!;
    if (card.retired === extrasOn) {
      if (extrasOn) await host.addCard(card.id, card.itemId, card.template);
      else await host.retireCard(card.id);
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
const detailsOf = (c: Content, extra = false) => ({ ...('lesson' in c ? { lesson: c.lesson } : { topic: c.topic }), ...(extra ? { extra: true } : {}) });

/**
 * Logs a rating for a Q/A card. `extra`: practice before the card was due
 * (see isExtraReview): kept in the log, never fed to the scheduler.
 */
export async function rateQa(host: ModuleHost, cardId: string, rating: Rating, durationMs: number, extra = false): Promise<Validation<Content & { type: 'qa' }>> {
  const card = contentOf(host, cardId);
  if (!card) return { ok: false, error: `no theory card ${cardId}` };
  if (card.type !== 'qa') return { ok: false, error: 'multiple-choice cards are answered by picking an option' };
  if (!RATINGS.includes(rating)) return { ok: false, error: `bad rating ${String(rating)}` };
  if (host.cards().find((c) => c.id === cardId)?.retired) return { ok: false, error: 'that card is switched off' };
  await host.reportRep(cardId, rating, clampMs(durationMs), detailsOf(card, extra));
  return { ok: true, value: card as (QaCard | LessonCard) & { type: 'qa' } };
}

/** Logs a multiple-choice answer: right is Good, wrong is Again. `extra`: see rateQa. */
export async function answerMc(host: ModuleHost, cardId: string, choice: string, durationMs: number, extra = false): Promise<Validation<{ correct: boolean; card: McContent }>> {
  const card = contentOf(host, cardId);
  if (!card) return { ok: false, error: `no theory card ${cardId}` };
  if (card.type !== 'mc') return { ok: false, error: 'Q/A cards are rated after showing the answer' };
  if (![card.answer, ...card.wrong].includes(choice)) return { ok: false, error: 'not one of the options' };
  if (host.cards().find((c) => c.id === cardId)?.retired) return { ok: false, error: 'that card is switched off' };
  const correct = choice === card.answer;
  await host.reportRep(cardId, correct ? 'good' : 'again', clampMs(durationMs), { ...detailsOf(card, extra), correct });
  return { ok: true, value: { correct, card } };
}

// ------------------------------------------------- read in chapter (2026-11-08) --

export interface ChapterMaterial {
  readonly chapter: number;
  readonly title: string;
  /** The chapter's lessons in teaching order; the card's own lesson is marked and comes with its reading like the rest. */
  readonly lessons: readonly { readonly n: number; readonly title: string; readonly reading: readonly string[]; readonly relevant: boolean }[];
}

/**
 * The reading behind a card, for the "Read in Chapter" button: the chapter
 * the card's lesson sits in, every lesson's reading in it (our own words,
 * written for the course; nothing from the books, no links). An Extra opens
 * the chapter of the lesson it sits beside. Undefined for a card outside the
 * course (the superseded deck's, other modules').
 */
export function chapterFor(host: ModuleHost, cardId: string): ChapterMaterial | undefined {
  const lesson = lessonOfCard(host, cardId);
  if (!lesson) return undefined;
  return {
    chapter: lesson.chapter,
    title: CURRICULUM_CHAPTERS[lesson.chapter] ?? '',
    lessons: LESSONS.filter((l) => l.chapter === lesson.chapter).map((l) => ({ n: l.n, title: l.title, reading: l.reading, relevant: l.n === lesson.n })),
  };
}

/** Whether a rating asks for the reading: Hard, or Again (the "don't know"). */
export const needsReading = (rating: Rating): boolean => rating === 'hard' || rating === 'again';
