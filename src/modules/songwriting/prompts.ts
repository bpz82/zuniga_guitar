/**
 * Songwriting prompts (Blake, 2026-10-31): concrete, timed and recordable.
 * Each names a constraint you can finish in the time and play back, never a
 * count of "ideas". A goal's songwriting block shows one a day, rotating
 * through the list so none repeats until all have come up; a block can also
 * fix its own prompt. Original text, written for this app.
 */
export interface SongwritingPrompt {
  readonly id: string;
  readonly text: string;
  /** Suggested minutes for one take (the block's own setting wins). */
  readonly minutes: number;
}

export const PROMPTS: readonly SongwritingPrompt[] = Object.freeze([
  { id: 'chorus-vi-IV-I-V', text: 'Write a chorus over vi–IV–I–V. Hum or sing a melody, then record the best pass.', minutes: 10 },
  { id: 'verse-135', text: 'Write the first two lines of a verse using only scale degrees 1, 3 and 5 for the melody. Record them sung over a strummed I chord.', minutes: 10 },
  { id: 'riff-pentatonic', text: 'Write a two-bar riff in E minor pentatonic that you could loop all night. Record it four times through.', minutes: 8 },
  { id: 'object-lyric', text: 'Pick one object you can see right now. Write four lines about it without naming it, then record yourself singing or speaking them over any chords.', minutes: 10 },
  { id: 'bridge-IV-V', text: 'Write an 8-bar bridge that starts on IV and ends on V, so it leans back into a chorus. Record it.', minutes: 10 },
  { id: 'one-chord', text: 'Write a verse that stays on one chord the whole time. Make the melody and rhythm do the work. Record it.', minutes: 8 },
  { id: 'title-first', text: 'Write a song title first, then a chorus that says the title twice. Record the chorus.', minutes: 10 },
  { id: 'borrowed-iv', text: 'Write a four-chord progression in a major key that borrows the minor iv (e.g. C–F–Fm–C). Record it with a melody on top.', minutes: 10 },
  { id: 'new-ending', text: 'Play back your most recent take and write a different ending for it. Record the new ending.', minutes: 8 },
  { id: 'rhythm-first', text: 'Clap a rhythm for one bar, then write a melody line that follows it exactly. Record the line on guitar.', minutes: 8 },
  { id: 'question-answer', text: 'Write a two-bar musical question and a two-bar answer on guitar. Record question and answer twice.', minutes: 8 },
  { id: 'capo-7', text: 'Put a capo on fret 7 and write a picked part using open-position shapes. Record it.', minutes: 10 },
  { id: 'descending-bass', text: 'Write a progression with a bass line that walks down one scale step per chord for four chords. Record it with a melody.', minutes: 10 },
  { id: 'relative-minor', text: 'Write a verse in a minor key and a chorus in its relative major. Record the switch from verse to chorus.', minutes: 12 },
  { id: 'story-lines', text: 'Write four lines that tell a tiny story: who, where, what changed, how it felt. Record them sung.', minutes: 10 },
  { id: 'stop-time', text: 'Write a groove with a bar of silence every fourth bar (stop time). Record it with something sung or played in the gaps.', minutes: 8 },
  { id: 'hook-3-notes', text: 'Write a hook from only three different notes. Record it in two different rhythms.', minutes: 8 },
  { id: '6-8-feel', text: 'Write a short verse in 6/8. Record it with the strumming pattern you chose.', minutes: 10 },
  { id: 'intro-outro', text: 'Write an intro that can also be the outro, played softer the second time. Record both.', minutes: 8 },
  { id: 'opposite-mood', text: 'Write a happy-sounding melody over sad lyrics (or the reverse). Record two lines.', minutes: 10 },
]);

const DAY = 24 * 60 * 60 * 1000;

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Today's prompt for a block: rotates daily, no repeats until the list has cycled. */
export function promptForDay(goalId: string, blockId: string, date: string): SongwritingPrompt {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
  if (!Number.isFinite(day)) throw new RangeError(`bad date ${date}`);
  const i = (((day + hash(`${goalId}:${blockId}`)) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length;
  return PROMPTS[i]!;
}
