/**
 * Theory and physics flashcards as an engine module (contract v1). Every
 * card is tagged pocket-silent: off the instrument, no sound, fine at work.
 * Two card types: "qa" (show answer, rate Again/Hard/Good/Easy) and "mc"
 * (pick one of four; right is Good, wrong is Again).
 *
 * Topics on and off: turning a topic off retires its cards, turning it on
 * restores them (history kept). The setting lives in the log as the cards'
 * retired flags, so it syncs like everything else.
 */
import type { ModuleHost, ModuleManifest } from '../../contract.ts';
import type { Rating } from '../../model.ts';
import type { Validation } from '../../validate.ts';
import { cardById, DECK, TOPICS } from './deck.ts';
import type { McCard, TheoryCard, Topic } from './deck.ts';

export const THEORY: ModuleManifest = Object.freeze({
  id: 'theory',
  contract: 1,
  templates: Object.freeze([
    Object.freeze({ template: 'qa', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'mc', tags: Object.freeze(['pocket-silent'] as const) }),
  ]),
});

export const itemIdOf = (id: string) => `th-${id}`;
export const cardIdOf = (id: string) => `th-${id}-c`;
const deckIdOf = (cardId: string) => (cardId.startsWith('th-') && cardId.endsWith('-c') ? cardId.slice(3, -2) : null);

/** The deck card behind an engine card id, if this module owns it. */
export function contentOf(host: ModuleHost, cardId: string): TheoryCard | undefined {
  const id = deckIdOf(cardId);
  if (id === null || !host.cards().some((c) => c.id === cardId)) return undefined;
  return cardById(id);
}

/** Adds every deck card not yet in the log. Never re-enables a topic that was turned off. Safe on every launch. */
export async function seedTheory(host: ModuleHost): Promise<number> {
  const items = new Set(host.items().map((i) => i.id));
  const cards = new Set(host.cards().map((c) => c.id));
  const off = new Set(topics(host).filter((t) => t.total > 0 && t.on === 0).map((t) => t.topic));
  let added = 0;
  for (const c of DECK) {
    if (!items.has(itemIdOf(c.id))) await host.addItem(itemIdOf(c.id), { topic: c.topic });
    if (!cards.has(cardIdOf(c.id))) {
      await host.addCard(cardIdOf(c.id), itemIdOf(c.id), c.type);
      // A new card in a topic that is switched off starts off too.
      if (off.has(c.topic)) await host.retireCard(cardIdOf(c.id));
      added++;
    }
  }
  return added;
}

export interface TopicState {
  readonly topic: Topic;
  readonly label: string;
  /** Cards of this topic in the log. */
  readonly total: number;
  /** Of those, how many are switched on. */
  readonly on: number;
}

export function topics(host: ModuleHost): TopicState[] {
  const byId = new Map(host.cards().map((c) => [c.id, c]));
  return TOPICS.map(({ id, label }) => {
    const mine = DECK.filter((c) => c.topic === id).map((c) => byId.get(cardIdOf(c.id))).filter((c) => c !== undefined);
    return { topic: id, label, total: mine.length, on: mine.filter((c) => !c.retired).length };
  });
}

/** Turns a topic on or off. Writes only the cards that change. */
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

/** The four options of a multiple-choice card, in an order set by `seed` (so position is never the cue). */
export function optionsFor(card: McCard, seed: number): string[] {
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

/** Logs a rating for a Q/A card. */
export async function rateQa(host: ModuleHost, cardId: string, rating: Rating, durationMs: number): Promise<Validation<TheoryCard>> {
  const card = contentOf(host, cardId);
  if (!card) return { ok: false, error: `no theory card ${cardId}` };
  if (card.type !== 'qa') return { ok: false, error: 'multiple-choice cards are answered by picking an option' };
  if (!RATINGS.includes(rating)) return { ok: false, error: `bad rating ${String(rating)}` };
  if (host.cards().find((c) => c.id === cardId)?.retired) return { ok: false, error: 'that topic is switched off' };
  await host.reportRep(cardId, rating, clampMs(durationMs), { topic: card.topic });
  return { ok: true, value: card };
}

/** Logs a multiple-choice answer: right is Good, wrong is Again. */
export async function answerMc(host: ModuleHost, cardId: string, choice: string, durationMs: number): Promise<Validation<{ correct: boolean; card: McCard }>> {
  const card = contentOf(host, cardId);
  if (!card) return { ok: false, error: `no theory card ${cardId}` };
  if (card.type !== 'mc') return { ok: false, error: 'Q/A cards are rated after showing the answer' };
  if (![card.answer, ...card.wrong].includes(choice)) return { ok: false, error: 'not one of the options' };
  if (host.cards().find((c) => c.id === cardId)?.retired) return { ok: false, error: 'that topic is switched off' };
  const correct = choice === card.answer;
  await host.reportRep(cardId, correct ? 'good' : 'again', clampMs(durationMs), { topic: card.topic, correct });
  return { ok: true, value: { correct, card } };
}
