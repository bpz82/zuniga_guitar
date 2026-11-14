/**
 * Building blocks for the curriculum's content files (2026-11-13 rebuild).
 *
 * Card ids are stable forever: the log keys every review on them. A lesson's
 * number is its place in the course and can change when lessons are added or
 * moved; its `key` is the id prefix its new cards get and never changes. So a
 * card keeps the id it was born with ("l05-walls") even when its lesson is now
 * number 29. A draft can also carry an explicit id with `keep(id, draft)`: a
 * card moved from another lesson, or a card of the superseded topic deck
 * brought back into the course under its old id (its history carries over).
 */
import type { Source } from './deck.ts';

export type Draft =
  | { readonly type: 'qa'; readonly slug: string; readonly id?: string; readonly question: string; readonly answer: string; readonly source: Source }
  | { readonly type: 'mc'; readonly slug: string; readonly id?: string; readonly question: string; readonly answer: string; readonly wrong: readonly [string, string, string]; readonly why: string; readonly source: Source };

export const qa = (slug: string, question: string, answer: string, source: Source): Draft => ({ type: 'qa', slug, question, answer, source });
export const mc = (slug: string, question: string, answer: string, wrong: [string, string, string], why: string, source: Source): Draft => ({ type: 'mc', slug, question, answer, wrong, why, source });
/** A card with an id fixed elsewhere (moved from another lesson, or back from the superseded deck). */
export const keep = (id: string, d: Draft): Draft => ({ ...d, id });

export const B = (chapter: number): Source => ({ book: 'benade', chapter });
export const W = (chapter: number): Source => ({ book: 'winer', chapter });
export const G = (note: string): Source => ({ book: 'general', note });
/** Guitar theory, gear and live-sound practice that neither book covers. */
export const THEORY_SRC = G('Standard music theory; not from Benade or Winer');
export const GUITAR_SRC = G('Guitar teaching system; not from Benade or Winer');
export const LIVE_SRC = G('Live-sound and guitar-gear practice; not from Benade or Winer');

export interface LessonSpec {
  /** Id prefix for this lesson's own cards ("l05", "gig2", "mus1"). Never changes. */
  readonly key: string;
  readonly chapter: number;
  readonly title: string;
  readonly reading: readonly string[];
  /** The lesson's cards: every one must be solid for the lesson to graduate. */
  readonly cards: readonly Draft[];
  /** Advanced cards that belong to this lesson's reading but are not needed to graduate: the Extras, off by default. */
  readonly extras?: readonly Draft[];
}

export const lesson = (key: string, chapter: number, title: string, reading: string[], cards: Draft[], extras?: Draft[]): LessonSpec => ({ key, chapter, title, reading, cards, ...(extras ? { extras } : {}) });
