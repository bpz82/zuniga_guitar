/**
 * Improvisation randomizer (Blake, 2026-11-08). One draw combines, in a single
 * line:
 *   - acoustic or electric
 *   - how many chords to improvise over: a whole number from 1 to 6 (6 is the max)
 *   - the words "Pick a new chord"
 * "Pick a new chord" is on-screen instruction text only: Blake picks the chord
 * himself. There is no chord picker and no generated chord.
 *
 * The improvisation itself is recorded: the step opens the recording module
 * (a timed improv take), titled with this line.
 */
import { different, pick, pickInt } from '../../random.ts';
import type { Rng } from '../../random.ts';

export const IMPROV_GUITARS = Object.freeze(['acoustic', 'electric'] as const);
export const IMPROV_CHORDS = Object.freeze({ min: 1, max: 6 } as const);
export const IMPROV_INSTRUCTION = 'Pick a new chord';

export interface ImprovSuggestion {
  readonly guitar: (typeof IMPROV_GUITARS)[number];
  readonly chords: number;
  /** Always IMPROV_INSTRUCTION. */
  readonly instruction: string;
  /** All of it in one line: "Electric · 4 chords · Pick a new chord". */
  readonly text: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function improvSuggestion(guitar: ImprovSuggestion['guitar'], chords: number): ImprovSuggestion {
  if (!Number.isInteger(chords) || chords < IMPROV_CHORDS.min || chords > IMPROV_CHORDS.max) throw new RangeError(`chords: a whole number from ${IMPROV_CHORDS.min} to ${IMPROV_CHORDS.max}`);
  return { guitar, chords, instruction: IMPROV_INSTRUCTION, text: `${cap(guitar)} · ${chords} ${chords === 1 ? 'chord' : 'chords'} · ${IMPROV_INSTRUCTION}` };
}

export function randomImprov(rng: Rng, previous?: { readonly text: string }): ImprovSuggestion {
  return different(() => improvSuggestion(pick(IMPROV_GUITARS, rng), pickInt(IMPROV_CHORDS.min, IMPROV_CHORDS.max, rng)), previous);
}
