/**
 * Randomness for the practice randomizers (Blake, 2026-11-08). Every randomizer
 * takes an `Rng` (a function giving a number from 0 up to, not including, 1),
 * so the app passes Math.random and the tests pass a seeded one and can reach
 * every combination on purpose.
 */
export type Rng = () => number;

/** A seeded generator (mulberry32): the same seed always gives the same draws. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of `items`, evenly. A bad draw (1, NaN) can't go off the end. */
export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new RangeError('nothing to pick from');
  const r = rng();
  const i = Number.isFinite(r) ? Math.floor(r * items.length) : 0;
  return items[Math.min(items.length - 1, Math.max(0, i))]!;
}

/** An integer from `lo` to `hi`, both included. */
export function pickInt(lo: number, hi: number, rng: Rng): number {
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) throw new RangeError('bad range');
  const r = rng();
  return lo + Math.min(hi - lo, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * (hi - lo + 1))));
}

/**
 * Draws until the result differs from `previous` (by its text), so pressing
 * Randomize always changes something. Gives up after a few tries, so a
 * single-outcome draw can't loop.
 */
export function different<T extends { readonly text: string }>(draw: () => T, previous: { readonly text: string } | undefined): T {
  let r = draw();
  for (let i = 0; previous && r.text === previous.text && i < 25; i++) r = draw();
  return r;
}
