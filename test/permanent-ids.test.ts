/**
 * Card ids are permanent (architecture principle 3; Blake, Nov 15 2026): add
 * or retire, never rename or reuse. Reviews in the log and in Supabase key on
 * them. The checked-in lists in fixtures/ record every id that has existed;
 * these tests fail when one disappears without being retired (a rename) or a
 * retired id comes back (a reuse). test/theory.test.ts keeps the older
 * 2026-11-12 course list; this file adds the 2026-11-15 snapshot, which
 * covers chapters 3 and 4, the Extras and the Fretboard and chords deck.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_CARDS, LESSON_CARDS, RETIRED_COURSE_IDS } from '../src/modules/theory/curriculum.ts';
import { deckEntries, RETIRED_DECK_CARDS } from '../src/modules/test-deck.ts';
import { COURSE_IDS_2026_11_12 } from '../fixtures/course-ids-2026-11-12.ts';
import { COURSE_IDS_2026_11_15, DECK_IDS_2026_11_15, RETIRED_DECK_IDS_2026_11_15 } from '../fixtures/course-ids-2026-11-15.ts';

const courseIds = new Set([...LESSON_CARDS, ...EXTRA_CARDS].map((c) => c.id));
const deckIds = new Set(deckEntries().map((e) => e.cardId));
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

/** Ids in `list` that were renamed away (not live, not retired) or reused (retired but live again). */
function broken(list: readonly string[], live: ReadonlySet<string>, retired: readonly string[]) {
  return {
    renamed: list.filter((id) => !live.has(id) && !retired.includes(id)),
    reused: retired.filter((id) => live.has(id)),
  };
}

test('the 2026-11-15 course snapshot is complete and every id is still kept or retired', () => {
  assert.equal(COURSE_IDS_2026_11_15.length, 347);
  assert.ok(unique(COURSE_IDS_2026_11_15));
  assert.deepEqual(broken(COURSE_IDS_2026_11_15, courseIds, RETIRED_COURSE_IDS), { renamed: [], reused: [] });
  for (const id of COURSE_IDS_2026_11_12) assert.ok(COURSE_IDS_2026_11_15.includes(id) || RETIRED_COURSE_IDS.includes(id), `${id} carried into the newer list`);
});

test('the Fretboard and chords deck ids are pinned, and the retired ones stay retired', () => {
  assert.equal(DECK_IDS_2026_11_15.length, 279);
  assert.ok(unique(DECK_IDS_2026_11_15));
  assert.deepEqual(broken(DECK_IDS_2026_11_15, deckIds, RETIRED_DECK_CARDS), { renamed: [], reused: [] });
  assert.deepEqual([...RETIRED_DECK_IDS_2026_11_15].sort(), [...RETIRED_DECK_CARDS].sort());
  for (const id of RETIRED_DECK_IDS_2026_11_15) assert.ok(!deckIds.has(id), `${id} is never reused`);
});

test('the check catches a rename and a reuse', () => {
  const live = new Set(['a', 'b']);
  assert.deepEqual(broken(['a', 'c'], live, []), { renamed: ['c'], reused: [] });
  assert.deepEqual(broken(['a', 'b'], live, ['b']), { renamed: [], reused: ['b'] });
  assert.deepEqual(broken(['a', 'x'], live, ['x']), { renamed: [], reused: [] });
});
