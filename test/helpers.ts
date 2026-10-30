import { append, emptyLog } from '../src/index.ts';
import type { AppendContext, EventBody, Log } from '../src/index.ts';

/** Deterministic clock and ids for one fake device. */
export function device(name: string, start = Date.UTC(2026, 9, 30, 12)): AppendContext {
  let t = start;
  let n = 0;
  return {
    device: name,
    now: () => (t += 1000),
    newId: () => `${name}-${String(++n).padStart(4, '0')}`,
  };
}

export function record(ctx: AppendContext, bodies: EventBody[], log: Log = emptyLog()): Log {
  for (const b of bodies) log = append(log, b, ctx).log;
  return log;
}

export const item = (id: string, fields: Record<string, string> = { note: 'A' }): EventBody => ({
  type: 'item-set',
  item: { id, module: 'test-deck', fields },
});

export const card = (id: string, itemId: string, retired = false): EventBody => ({
  type: 'card-set',
  card: { id, itemId, template: 'name-the-note', tags: ['pocket-silent'], retired },
});

export const review = (cardId: string, rating: 'again' | 'hard' | 'good' | 'easy' = 'good'): EventBody => ({
  type: 'review',
  cardId,
  rating,
  durationMs: 4000,
});

export const gigGoal = (id: string, weight = 2): EventBody => ({
  type: 'goal-set',
  goal: {
    id,
    kind: 'gig',
    what: 'Play the Friday set',
    why: 'First gig of the year',
    deadline: '2026-12-04',
    itemIds: ['i1'],
    dailyMinutes: 30,
    weight,
    targetRetention: 0.95,
    blocks: [
      { id: 'b1', kind: 'recall', label: 'Set songs', minutes: 15 },
      { id: 'b2', kind: 'feel-session', label: 'Guitar yoga', minutes: 10 },
      { id: 'b3', kind: 'improv-takes', label: 'Improv takes', minutes: 5, params: { takes: 5 } },
    ],
    archived: false,
  },
});

/** Seeded shuffle so "any order" tests are repeatable. */
export function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
