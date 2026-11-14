/**
 * The theory and physics curriculum (Blake, 2026-11-02). One course built
 * from both books, taught lesson by lesson from absolute basics:
 *   - Benade, Fundamentals of Musical Acoustics (Dover, 2nd rev. ed. 1990)
 *   - Winer, The Audio Expert, 2nd ed. (Routledge, 2018)
 * plus, since the 2026-11-13 rebuild, an electric guitar and gigging chapter
 * (chapter 3, Blake: "Put the electric guitar section early like chap 3")
 * and a music theory chapter (chapter 4). It replaces the 2026-10-31 topic
 * deck (deck.ts, kept as data; several of its cards are back in the course
 * under their old ids, so their history carries over).
 *
 * Rules the content follows:
 *   - Assume no prior knowledge. Every term is defined in a lesson's reading
 *     (or an earlier lesson's) before a card uses it.
 *   - Each lesson builds on the ones before (the graduation rule and the
 *     chapter horizon are in practice.ts).
 *   - Copyright: every word is our own, about facts. Nothing is quoted or
 *     paraphrased line by line from either book and no figure is reproduced.
 *     Each card keeps a citation (book and chapter, or "general") as data
 *     for checking facts; the app never shows it (Blake, 2026-11-02).
 *   - Card ids never change (the log keys reviews on them). A lesson's number
 *     is its place in the course; its cards keep the ids they were born with
 *     (see course-kit.ts). A card taken out of the course is listed in
 *     RETIRED_COURSE_IDS and never reused.
 *
 * Content lives in code, not in the log: the log keeps only each card's id
 * and the lesson number it was added under, so a corrected card reaches
 * every device with the app.
 */
import type { Source } from './deck.ts';
import type { Draft, LessonSpec } from './course-kit.ts';
import { CH1 } from './course/ch1-sound.ts';
import { CH2 } from './course/ch2-tones.ts';
import { CH3 } from './course/ch3-electric.ts';
import { CH4 } from './course/ch4-theory.ts';
import { CH5 } from './course/ch5-string.ts';
import { CH6 } from './course/ch6-rooms.ts';
import { CH7 } from './course/ch7-signals.ts';
import { CH8 } from './course/ch8-processing.ts';
import { CH9 } from './course/ch9-recording.ts';

export interface LessonQa {
  readonly id: string;
  readonly lesson: number;
  readonly type: 'qa';
  readonly question: string;
  readonly answer: string;
  readonly source: Source;
}
export interface LessonMc {
  readonly id: string;
  readonly lesson: number;
  readonly type: 'mc';
  readonly question: string;
  readonly answer: string;
  /** Three wrong but plausible options. */
  readonly wrong: readonly [string, string, string];
  /** Shown after answering. */
  readonly why: string;
  readonly source: Source;
}
export type LessonCard = LessonQa | LessonMc;

export interface Lesson {
  /** 1, 2, 3... in teaching order: the lesson's place in the course. */
  readonly n: number;
  readonly chapter: number;
  /** The id prefix of the lesson's own cards; stable even when n changes. */
  readonly key: string;
  readonly title: string;
  /** The reading: short paragraphs, shown before and alongside the lesson's cards. */
  readonly reading: readonly string[];
  /** Every one must meet the graduation rule for the lesson to graduate. */
  readonly cards: readonly LessonCard[];
  /** Advanced cards beside this lesson's reading (the Extras): off by default, never needed to graduate. */
  readonly extras: readonly LessonCard[];
}

export const CURRICULUM_CHAPTERS: Readonly<Record<number, string>> = {
  1: 'Sound itself',
  2: 'Musical tones',
  3: 'The electric guitar on stage',
  4: 'Music theory for guitarists',
  5: 'The guitar string',
  6: 'Bodies, ears and rooms',
  7: 'Microphones, pickups and levels',
  8: 'Processing: EQ, dynamics and reverb',
  9: 'Recording: tape and digital',
};

/** Card ids: "l01-what-is-sound". The engine's ids add a prefix and suffix (practice.ts). */
export const lessonCardId = (key: string, slug: string) => `${key}-${slug}`;

function card(n: number, key: string, d: Draft): LessonCard {
  const id = d.id ?? lessonCardId(key, d.slug);
  return d.type === 'qa'
    ? { id, lesson: n, type: 'qa', question: d.question, answer: d.answer, source: d.source }
    : { id, lesson: n, type: 'mc', question: d.question, answer: d.answer, wrong: d.wrong, why: d.why, source: d.source };
}

const SPECS: readonly LessonSpec[] = [...CH1, ...CH2, ...CH3, ...CH4, ...CH5, ...CH6, ...CH7, ...CH8, ...CH9];

export const LESSONS: readonly Lesson[] = Object.freeze(
  SPECS.map((s, i): Lesson => {
    const n = i + 1;
    return Object.freeze({
      n,
      chapter: s.chapter,
      key: s.key,
      title: s.title,
      reading: s.reading,
      cards: Object.freeze(s.cards.map((d) => card(n, s.key, d))),
      extras: Object.freeze((s.extras ?? []).map((d) => card(n, s.key, d))),
    });
  }),
);

/**
 * Cards that were in the course and have been taken out (history kept in the
 * log; seeding switches them off). Never reuse these ids.
 *   - l19-double-voltage (2026-11-13): a near copy of l04-double-pressure;
 *     its slot went to a new fact.
 */
export const RETIRED_COURSE_IDS: readonly string[] = Object.freeze(['l19-double-voltage']);

/** Every curriculum card, in teaching order (the Extras not included). */
export const LESSON_CARDS: readonly LessonCard[] = Object.freeze(LESSONS.flatMap((l) => l.cards));
/** The advanced Extras, each beside its lesson's reading. */
export const EXTRA_CARDS: readonly LessonCard[] = Object.freeze(LESSONS.flatMap((l) => l.extras));
const BY_ID = new Map([...LESSON_CARDS, ...EXTRA_CARDS].map((c) => [c.id, c]));
/** A course card or an Extra by its id. */
export const lessonCardById = (id: string): LessonCard | undefined => BY_ID.get(id);
const EXTRA_IDS = new Set(EXTRA_CARDS.map((c) => c.id));
export const isExtraCard = (id: string): boolean => EXTRA_IDS.has(id);
export const lessonByNumber = (n: number): Lesson | undefined => LESSONS[n - 1];
