/**
 * Ear-training randomizer (Blake, 2026-11-08). The ear-training step's card has
 * two bullets, and every randomization combines BOTH, never just one of them:
 *   - the guitar: acoustic or electric
 *   - the recording: vinyl or digital
 * so a result reads "Electric + vinyl" (4 possible results).
 *
 * Beato is a separate alternative exercise: instruction text only, shown
 * beside the result, never part of the draw. Blake goes and does it himself.
 * No link is given: the app does not point at material it hasn't checked.
 */
import { different, pick } from '../../random.ts';
import type { Rng } from '../../random.ts';

export const EAR_GUITARS = Object.freeze(['acoustic', 'electric'] as const);
export const EAR_SOURCES = Object.freeze(['vinyl', 'digital'] as const);

/** The Beato alternative: words only (no link), for Blake to go and do. */
export const BEATO_ALTERNATIVE =
  'Or, instead of this: do a Rick Beato ear-training exercise. Find one yourself and work through it; this step is done when the timer is.';

export interface EarSuggestion {
  readonly guitar: (typeof EAR_GUITARS)[number];
  readonly source: (typeof EAR_SOURCES)[number];
  /** All bullets in one line: "Electric + vinyl". */
  readonly text: string;
  /** The Beato instruction, always the same text. */
  readonly alternative: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function suggestionOf(guitar: EarSuggestion['guitar'], source: EarSuggestion['source']): EarSuggestion {
  return { guitar, source, text: `${cap(guitar)} + ${source}`, alternative: BEATO_ALTERNATIVE };
}

/** One draw: a guitar AND a recording. `previous`: never the same result twice in a row. */
export function randomEar(rng: Rng, previous?: { readonly text: string }): EarSuggestion {
  return different(() => suggestionOf(pick(EAR_GUITARS, rng), pick(EAR_SOURCES, rng)), previous);
}
