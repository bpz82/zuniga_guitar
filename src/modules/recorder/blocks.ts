/**
 * Goal blocks the recorder runs: improv takes and songwriting prompts. Turns
 * a planned block (from the session) into today's concrete prompt: what to
 * play, how many takes, how long each. Pure.
 *
 * Params are read leniently on purpose: older goals stored these blocks'
 * params freely, so a missing or odd value falls back to a sensible default
 * (and is clamped to the recorder's limits) rather than breaking the session.
 */
import type { PlannedBlock } from '../../goals.ts';
import { promptForDay } from '../songwriting/prompts.ts';
import { IMPROV_LIMITS } from './core.ts';
import type { ImprovPrompt } from './core.ts';

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const textOr = (v: unknown, fallback: string) =>
  typeof v === 'string' && v.trim() && v.trim().length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : fallback;

/**
 * Improv takes for today. With a ramp, takes climb from `takes` to `rampTo`
 * over the last `rampDays` before the deadline, reaching `rampTo` on the day
 * (spec: gig improv takes ramp up, e.g. 5 to 10 one-minute takes a day).
 */
export function improvFor(b: Pick<PlannedBlock, 'kind' | 'label' | 'minutes' | 'params' | 'daysLeft'>): ImprovPrompt | null {
  if (b.kind !== 'improv-takes') return null;
  const p = b.params ?? {};
  const { takes: T, minutes: M } = IMPROV_LIMITS;
  const base = clampInt(p.takes, T.min, T.max, 3);
  const minutes = clampInt(p.minutes, M.min, M.max, Math.max(M.min, Math.min(M.max, Math.floor(b.minutes / base) || 1)));
  let takes = base;
  const rampTo = clampInt(p.rampTo, T.min, T.max, base);
  const rampDays = clampInt(p.rampDays, 1, 60, 0);
  if (rampTo > base && rampDays > 0 && b.daysLeft < rampDays) {
    const progress = (rampDays - Math.max(0, b.daysLeft)) / rampDays;
    takes = Math.round(base + (rampTo - base) * progress);
  }
  return { prompt: textOr(p.prompt, b.label || 'Improvise'), takes, minutes };
}

/** Today's songwriting prompt: the block's own prompt, or one from the list that rotates daily. */
export function songwritingFor(b: Pick<PlannedBlock, 'kind' | 'goalId' | 'blockId' | 'minutes' | 'params'>, date: string): ImprovPrompt | null {
  if (b.kind !== 'creative-prompt') return null;
  const p = b.params ?? {};
  const fromList = promptForDay(b.goalId, b.blockId, date);
  const takes = clampInt(p.takes, 1, 5, 1);
  const own = typeof p.prompt === 'string' && p.prompt.trim().length > 0 && p.prompt.trim().length <= 300 && !/[\u0000-\u001f\u007f]/.test(p.prompt);
  const minutes = clampInt(p.minutes, 1, IMPROV_LIMITS.minutes.max, own ? Math.max(1, Math.min(30, Math.floor(b.minutes / takes) || 1)) : fromList.minutes);
  // The recorder titles each take with the prompt (200 characters at most).
  const text = own ? (p.prompt as string).trim() : fromList.text;
  return { prompt: text.length > 200 ? `${text.slice(0, 199)}…` : text, takes, minutes };
}
