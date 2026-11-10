/**
 * Metronome randomizer (Blake, 2026-11-08). One draw gives exactly ONE
 * workout, never two, from:
 *   two-finger workout, double-stop workout, rhythm, slide, scales
 * PLUS a key, every time (one of the twelve).
 */
import { different, pick } from '../../random.ts';
import type { Rng } from '../../random.ts';

export const METRONOME_WORKOUTS = Object.freeze([
  Object.freeze({ id: 'two-finger', label: 'Two-finger workout' }),
  Object.freeze({ id: 'double-stop', label: 'Double-stop workout' }),
  Object.freeze({ id: 'rhythm', label: 'Rhythm' }),
  Object.freeze({ id: 'slide', label: 'Slide' }),
  Object.freeze({ id: 'scales', label: 'Scales' }),
] as const);

export const KEYS = Object.freeze(['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const);

export type WorkoutId = (typeof METRONOME_WORKOUTS)[number]['id'];

export interface MetronomeSuggestion {
  readonly workout: WorkoutId;
  readonly label: string;
  readonly key: (typeof KEYS)[number];
  /** "Slide in A". */
  readonly text: string;
}

export function metronomeSuggestion(workout: WorkoutId, key: MetronomeSuggestion['key']): MetronomeSuggestion {
  const w = METRONOME_WORKOUTS.find((x) => x.id === workout);
  if (!w || !KEYS.includes(key)) throw new RangeError('unknown workout or key');
  return { workout, label: w.label, key, text: `${w.label} in ${key}` };
}

export function randomMetronome(rng: Rng, previous?: { readonly text: string }): MetronomeSuggestion {
  return different(() => metronomeSuggestion(pick(METRONOME_WORKOUTS, rng).id, pick(KEYS, rng)), previous);
}
