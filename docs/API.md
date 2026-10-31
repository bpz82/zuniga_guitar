# Engine API (checkpoint 1: data model)

For whoever builds the UI. Import everything from `src/index.ts`. The engine is pure TypeScript with no UI, storage or network code; you hold the `Log` and hand it back.

## The one idea

Everything is an event in one append-only log. Current state is never stored; it is derived with `project(log)`. Sync is a set union of events (`merge`).

```ts
import { append, merge, project, emptyLog } from './src/index.ts';

let log = emptyLog();
const ctx = { device: 'blake-iphone' };           // stable per device

log = append(log, { type: 'item-set', item: { id: 'i1', module: 'test-deck', fields: { string: 'A', fret: 5 } } }, ctx).log;
log = append(log, { type: 'card-set', card: { id: 'c1', itemId: 'i1', template: 'name-the-note', tags: ['pocket-silent'], retired: false } }, ctx).log;
log = append(log, { type: 'review', cardId: 'c1', rating: 'good', durationMs: 3200 }, ctx).log;

const lib = project(log);  // { items, cards, goals, settings, reviews, activity }
```

## Functions

| Function | What it does |
|---|---|
| `emptyLog()` | A new, empty log. |
| `append(log, body, ctx)` | Validates `body`, stamps id/time/device, returns `{ log, event }`. Throws `RejectedEvent` on invalid input. The old log is untouched. |
| `merge(log, incoming)` | Adds remote events. Returns `{ log, rejected }`. Invalid events are reported in `rejected`, never stored. Order of merging never changes the result. |
| `project(log)` | Current library: items, cards, goals, settings (defaults if never set), reviews per card, ungraded activity. |
| `replay(log, reducer, init)` | Fold over events in canonical order (time, then id). |
| `cardsOfItem(lib, itemId)` | Sibling cards of an item. |
| `validateBody(x)` / `validateEvent(x)` | Check input without recording it. Returns `{ ok, value }` or `{ ok: false, error }` with the bad field's path. |

There is no update or delete function, by design.

## Event bodies

| `type` | Fields |
|---|---|
| `item-set` | `item: { id, module, fields }` |
| `card-set` | `card: { id, itemId, template, tags, retired }`. Tags: `guitar`, `pocket-sound`, `pocket-silent`. Retire instead of delete. |
| `goal-set` | `goal: { id, kind ('general' or 'gig'), what, why, deadline 'YYYY-MM-DD', itemIds, dailyMinutes, weight, targetRetention?, blocks, archived }` |
| `settings-set` | `settings: { desiredRetention (0.7 to 0.99), windows: [{ id, start 'HH:MM' }], dayStart?: { timeZone, hour }, quietHours?: { start, end }, morningMinutes? }`. Window ids: `morning`, `before-work`, `during-work`, `after-work`. Missing optional fields take Blake's defaults: day starts 3:00am America/New_York, quiet 10:30 to 16:00, morning 60 minutes. |
| `review` | `cardId, rating ('again', 'hard', 'good', 'easy'), durationMs, details?` |
| `feel-session` | `goalId?, durationMs, note` |
| `task-done` | `goalId, blockId, durationMs` |
| `played` | `minutes` |

Goal blocks: `{ id, kind, label, minutes, params? }`. Active kinds: `recall`, `feel-session`, `timed-task`. Reserved for later modules: `tempo-ladder`, `creative-prompt`, `improv-takes`, `gig-memo`.

To edit an item, card, goal or settings, append a new `-set` event with the full new version. The latest by time wins; the old version stays in history.

## Scheduler (checkpoint 2)

FSRS-6 with fuzz and learning steps (1 and 10 minutes) and a relearning step (10 minutes). Nothing is stored: everything is computed from the log.

```ts
import { buildQueue, memoryOf, retrievability, project } from './src/index.ts';

const lib = project(log);
const queue = buildQueue(lib, { now: Date.now() });
// queue.due:     cards to practice, in order (steps first, then riskiest reviews)
// queue.fresh:   never-reviewed cards, in the order they were added
// queue.leeches: cards with 8+ lapses, still scheduled, flagged for a breakdown
```

| Function | What it does |
|---|---|
| `buildQueue(lib, { now, retentionFor?, weightFor?, pullForward? })` | Today's queue. Defaults: settings retention, weight 1, nothing pulled forward. Use `goalQueue` to apply goals. Learning steps are due at their exact time; reviews are due for their whole practice day. |
| `memoryOf(cardId, reviews, retention, dayStart?, steps?)` | One card's memory (`steps: false` skips learning and relearning steps; `buildQueue` passes `usesSteps(lib, cardId)`, false for song cards): `phase` (`new`, `learning`, `review`, `relearning`), `stability`, `difficulty`, `reps`, `lapses`, `lastReview`, `due`, `leech`. |
| `retrievability(memory, now)` | Recall probability now, 0 to 1 (null for new cards). |
| `LEECH_LAPSES` | 8. |

Each `due` entry is `{ memory, retrievability, priority }`. A backlog after a break is just a long queue: show what fits today; the rest stays due and is re-ranked tomorrow.

## Practice days

A practice day starts at `settings.dayStart`: 3:00am America/New_York by default, so 11pm and 2am are the same day. Due reviews, goal deadlines, expiry and FSRS's day counting all use it.

| Function | What it does |
|---|---|
| `practiceDay(t, dayStart)` | The practice day an instant falls in, `"YYYY-MM-DD"`. |
| `dayBegins(date, dayStart)` | The instant that day starts (3:00am local). |
| `daysBetween(a, b)`, `addDays(date, n)` | Date arithmetic on `"YYYY-MM-DD"`. |

To change it, append a `settings-set` with `dayStart: { timeZone, hour }`. It applies retroactively to how past reviews are counted.

## Goals (checkpoint 3)

Goals only set target retention, change queue order and split time. They never change memory state and never write to the log.

```ts
import { goalFromIntake, goalQueue, planGoals, splitTime } from './src/index.ts';

// Intake form -> goal-set event body -> append.
const r = goalFromIntake({ kind: 'gig', what, why, deadline: '2026-12-04', itemIds, dailyMinutes: 30, weight: 2 }, goalId, lib, Date.now());
if (r.ok) log = append(log, r.value, ctx).log;

const queue = goalQueue(lib, Date.now());       // today's queue with goals applied
const plan = planGoals(lib, Date.now());        // { today, active, blocks, checkIns, ... }
const fitted = splitTime(plan.blocks, 60);      // fit blocks into 60 minutes
```

| Function | What it does |
|---|---|
| `goalFromIntake(intake, id, lib, now)` | Validated `goal-set` body, or `{ ok: false, error }`. Refuses past deadlines. Defaults: kind `general`, weight 1, no blocks. |
| `planGoals(lib, now)` | `active` goals, `retentionFor`, `weightFor`, `pullForward` (scheduler hooks), today's `blocks` per goal, pending `checkIns`. |
| `goalQueue(lib, now)` | `buildQueue` with the goal hooks applied. |
| `splitTime(blocks, minutes)` | Fits blocks into a time budget: protected blocks (guitar yoga) first, the rest by goal weight, capped at what each asked for. Whole minutes. |
| `isActive(goal, today)` | Not archived and the deadline day has not passed. |

Rules:
- **Active** through the deadline practice day; gone at the next 3:00am. No cleanup event needed.
- **Retention:** a goal's `targetRetention`, or 95% for gig goals, else `settings.desiredRetention`. A card in several goals takes the highest.
- **Order:** risk x weight. Material in no goal has weight 1; goal material has 1 + goal weight (highest goal wins). New goal cards are introduced first. Weight leans the order; it does not override a card that is far more forgotten.
- **Blocks:** a goal with no blocks gets one recall block. Blocks are scaled to the goal's `dailyMinutes`. Reserved kinds (tempo ladders, creative prompts, improv takes, gig memo) are skipped until their modules ship, and their time goes to the other blocks.
- **Gig final week** (last 7 practice days, gig day included): recall blocks become "Full set run-through" timed tasks.
- **Peaking guarantee:** a gig card that fuzz would push past the gig with recall below target by the end of gig day is pulled forward, at most once per practice day.
- **Check-ins** at 14, 7 and 2 days before the deadline. Saving the goal (changed or not) clears the pending one.

## Sessions (checkpoint 4)

What to practice right now, and when to nudge. Pure functions; nothing is stored. A missed session needs no handling: its cards stay due and come up next time.

```ts
import { sessionFor, nudgesBetween } from './src/index.ts';

const s = sessionFor(lib, Date.now());
// s.mode: 'guitar' (morning), 'sound' or 'silent' (pocket bursts)
// s.minutes / s.minMinutes: 60/60 for the morning, 5/3 for a burst
// s.segments: in order. Review segments hold due cards then new ones;
//   block segments hold a goal block and whether it's done today.
```

| Function | What it does |
|---|---|
| `sessionFor(lib, now)` | The session for right now. Opening the app always gets one (before 4:00am it is the morning session). |
| `nudgesBetween(lib, from, to)` | Notifications due in (from, to]: one per window start with something to do (the morning one fires even with nothing due while `alwaysRemindMorning` is on, the default), `silent` during quiet hours, respecting the master switch and each window's toggle. Never repeats, never replays a missed window. |
| `windowsFor(lib, date)`, `currentWindow(lib, now)`, `isQuiet(lib, t)` | Window times for a practice day, the window now, whether it is quiet hours. |

Rules:
- **Windows** (settings; Blake's are 4:00am, 9:45am, 1:00pm, 4:30pm): a morning guitar session, then pocket bursts before (sound), during (silent) and after (sound) work. A window lasts until the next one starts.
- **What each window serves:** morning, `guitar` cards; sound bursts, `pocket-sound` and `pocket-silent`; the during-work burst, `pocket-silent` only.
- **Quiet hours** (work hours; Blake's are 10:30am to 4:00pm) override everything: only `pocket-silent` cards, even if a 9:45 burst is opened late or the morning session is opened at work.
- **Bursts** are time-boxed at 3 to 5 minutes: due cards first, then new ones. The UI stops when time is up; the engine never counts cards.
- **Morning** (`morningMinutes`, 60 by default, 60 to 300): guitar yoga first so it is never squeezed out, then reviews, then timed tasks and run-throughs. Goal blocks are fitted with `splitTime`; recall minutes plus any spare minutes become review time. Blocks done today (a `task-done` or `feel-session` event for that goal and block) are marked `done`.
- **New cards** are limited by time, not count: they are offered only after due cards, inside the time box.

## Settings and onboarding (checkpoint 5)

Engine defaults are generic (UTC, 7:00 / 8:30 / 12:30 / 17:30, quiet 9:00 to 17:00, notifications **off**, morning reminder even when nothing is due **on**). Each user's own schedule is a `settings-set` event, written by onboarding and changeable any time. Every function returns a validated event body; `append` or `replica.record` it.

| Function | What it does |
|---|---|
| `settingsFromOnboarding(answers)` | First settings for a new user: `timeZone` (from the device), `dayStartHour?`, `morning?`, `beforeWork?`, `duringWork?`, `afterWork?` ("HH:MM", leave out to skip), `workStart?`/`workEnd?` (quiet hours), `morningMinutes?`, `notifications?` (default off). |
| `changeSettings(lib, changes)` | Any edit; untouched fields are kept. |
| `toggleNotifications(lib, on)` | Master switch. |
| `toggleWindowNotify(lib, windowId, on)` | One window's notification. The window itself stays. |
| `toggleAlwaysRemindMorning(lib, on)` | Morning reminder even when nothing is due (default on). Has no effect until notifications are on; the morning window's own toggle still wins. |

## Storage and sync

```ts
import { Replica, supabaseRemote, planNudges, uploadNudges } from './src/index.ts';
import { indexedDbStore } from './src/stores/indexeddb.ts';

const replica = await Replica.open(await indexedDbStore(userId), deviceId); // one local database per user
await replica.record(body);                         // validated, saved, queued
const lib = replica.library;                        // projected, cached until the log changes
await replica.sync(supabaseRemote(supabase));       // push queued, pull new; safe to retry
await uploadNudges(supabase, planNudges(lib, Date.now())); // reminders for the next 7 days
```

| | |
|---|---|
| `Replica.open(store, deviceId)` | Loads and validates the local log; corrupt stored events are set aside (`loadRejected`). |
| `replica.record(body)` | The only way to write. Throws `RejectedEvent` if invalid. A device's events always sort in the order it recorded them. |
| `replica.sync(remote)` | Returns `{ pushed, pulled, rejected }`. Offline is fine: events stay queued (`pendingCount`). |
| `replica.exportJson()` / `replica.restore(events)` | Backup and restore; restore validates and never replaces anything. |
| `memoryStore()` | In-memory store for tests. |
| `supabaseRemote(client)` | Sync over a supabase-js client (publishable key; row-level security limits it to the signed-in user). |
| `planNudges(lib, now)` / `uploadNudges(client, plan)` | The user's own reminders, uploaded in one call. Empty when notifications are off. |

## Module contract v1 (locked)

Modules never touch the log or library. They get a host scoped to their own items and cards.

```ts
const host = createHost(replica, MY_MANIFEST);   // { id, contract: 1, templates: [{ template, tags }] }
await runModule(host, async () => {              // crash boundary
  await host.addItem('song-1', { title: '...' });
  await host.addCard('song-1-c', 'song-1', 'song');
  const { due, fresh } = host.session(Date.now());
  await host.reportRep('song-1-c', 'good', 4200, { tempo: 96 });
});
```

Locked 2026-10-31 (Blake): v1 is v0 unchanged. Any change to the host, the manifest or these rules needs Blake's yes and a new version (`test/contract.test.ts` guards it).

A module that touches another module's data, uses an undeclared template, sends an invalid write, throws inside `runModule`, or writes more than 2,000 events an hour is switched off (`host.enabled === false`). Nothing it tried gets in; the engine and other modules carry on.

## Test deck

`TEST_DECK`, `seedTestDeck(host)` (idempotent, same ids on every device), `prompt(card, item)` for question and answer text. 78 fretboard notes and 24 chord spellings, all silent pocket cards.

## Songs I Already Know

A song is a **title only**: one item `{ title }` and one `song` card tagged `guitar`, so it is served in the morning session through the normal queue (never in a pocket burst). Blake plays it and rates it Again, Hard, Good or Easy. All writes go through the contract; every function checks its input first and returns a `Validation`, so bad input is an error for the user and never switches the module off.

```ts
import { SONGS, addSong, pasteSongs, renameSong, archiveSong, restoreSong, rateSong, songs } from './src/index.ts';
const host = createHost(replica, SONGS);
await runModule(host, () => addSong(host, crypto.randomUUID(), 'Blackbird'));
await runModule(host, () => pasteSongs(host, 'Little Wing\nWonderwall', () => crypto.randomUUID()));
await runModule(host, () => rateSong(host, cardId, 'good', msTaken));
```

| Function | What it does |
|---|---|
| `songs(host)` | Every song `{ itemId, cardId, title, archived }`, in the order added. |
| `addSong(host, key, title)` | Adds one. Title trimmed, 1 to 200 characters, one line. A title already listed (any case, archived included) is refused. |
| `pasteSongs(host, text, newKey)` | One title per line. Blank lines ignored, duplicates skipped and reported. Every line is checked first: one bad line and nothing is added. At most 200 new songs per paste. |
| `renameSong(host, itemId, title)` | New title; history stays with the song. |
| `archiveSong` / `restoreSong(host, itemId)` | Archive retires the card: not served, history kept. Restore brings it back with its history. There is no hard delete (the log is append-only). |
| `rateSong(host, cardId, rating, durationMs)` | Logs one play. Archived songs cannot be rated. |

Song cards have **no learning or relearning steps** (Blake, 2026-10-31): every rating schedules in whole days, so a song is never repeated in the same session. From a first rating: Again tomorrow, Hard about 2 days, Good about 3, Easy about 8 (fuzz applies). A forgotten song comes back the next morning and still counts as a lapse.

## Ear training

Built from the research review in [`ear-training-research.md`](ear-training-research.md) (Blake, 2026-10-31). Tonic-relative hearing is the spine; intervals are a secondary, interleaved drill; chord quality, then chord function; rhythm and meter in parallel from level 1.

- **A card is a skill, never one sound.** Each skill on the ladder (`degree 6`, `interval m3`, `meter triple`...) is one item and one `ear` card tagged `pocket-sound` and `guitar`: served in the morning and in sound bursts, never in quiet hours. Every trial is a fresh exemplar: new key, register, timbre, direction.
- **Ladder** (`LADDER` in `src/modules/ear/core.ts`): 1 pitch direction and steady eighths; 2 tonic and degrees 1, 3, 5, duple and triple meter; 3 all diatonic degrees, m2–P5 intervals, major and minor; 4 sixths, sevenths, tritone, octave, rests and sixteenths; 5 diminished and augmented, 6/8; 6 chord function I–vii° in a progression. Research levels 7–9 are not built.
- **Mastery** adds the next level by itself: at least 20 answers on the level, 85%+ of the latest 20, every skill at least 3 answers and 70%+ of its last 5, over 3+ sessions at least 12 hours apart (`MASTERY`). "Unlock the next level" skips ahead by hand. Levels are added, never removed.
- **Grading → FSRS:** wrong → Again; right after a replay, or only with scaffolding → Hard; right first time → Good; right first time, at or under the usual speed, and right last time too → Easy. Each review logs `family`, `category`, `correct`, `latencyMs`, `replays`, `scaffold`, `answered` (or, for rhythm, `taps`, `missed`, `extra`, `timingMs`, `lagMs`) and the research's score `P` without confidence, renormalized (`score`).
- **Feedback:** immediate. A wrong answer shows the answer and plays it resolved (degrees walk to do; intervals melodic then together; chords arpeggiated then blocked). Two wrong in a row on a skill: scaffold mode (two choices, the answer and its most confusable partner; simpler stimulus).
- **Intervals** are heard after a cadence on most trials once a skill has 3 answers.
- **Rhythm echo:** count-in, the rhythm, count-in, then the learner taps the bar. A steady touch lag is removed (up to a quarter beat); each onset must be within an eighth of a beat; no extra taps.
- **Daily minutes:** the research suggests about 18 (`DAILY_MINUTES`). Shown, never enforced. With nothing due, `pickEarCard` offers extra practice on the skill answered longest ago, so the minutes are always available.

| Function (`src/modules/ear/practice.ts`) | What it does |
|---|---|
| `seedEar(host)` | Adds level 1; repairs a half-added level. Safe on every launch. |
| `pickEarCard(host, now, soundAllowed, last?)` | Next card: due or new first, else extra practice; never `last` straight away. Null when sound is not allowed. |
| `trialFor(host, cardId, seed)` | A fresh exemplar: `prompt`, `choices`, `answer`, `events` (what to play), `feedback`, `explain`, `rhythm?`, `scaffold`. |
| `answerTrial(host, cardId, trial, { choice, latencyMs, replays }, durationMs)` | Grades and logs a multiple-choice answer; may add the next level. |
| `answerRhythm(host, cardId, trial, tapsSec, replays, durationMs)` | Same for tapped rhythm (`tapsSec` from the start of the learner's bar). |
| `progress(host)` | Level, label, answers, sessions, recent accuracy, weakest skill, mastered, next level. |
| `unlockNext(host)`, `minutesSince(host, since)` | Skip ahead; minutes practised since a time. |

`EarPlayer` (`src/modules/ear/audio.ts`) synthesizes the sounds with Web Audio (no samples): `unlock()` from a tap, `play(events)` returns start and end on the audio clock, `now()` for tap timing.

## Server side (Supabase)

- `supabase/migrations/20261030000000_init.sql`: tables `events` (append-only), `push_subscriptions`, `nudges`; row-level security per user; `save_push_subscription` and `replace_nudges` functions. Tested by `npm run test:sql`.
- `supabase/functions/send-nudges`: called every minute; sends due reminders with Web Push. Logic in `supabase/functions/_shared`, unit-tested.
- Setup: `docs/SETUP.md`.

## Test harness

`harness/` is a bare page (no design) that exercises everything: sessions, the test deck, songs, ear training, "I played", settings, notification toggles, sign-in by emailed code, sync, backup. `npm run build` writes it to `public/` for Vercel, with the public Supabase connection built in from `ZG_SUPABASE_URL`, `ZG_SUPABASE_PUBLISHABLE_KEY` and `ZG_VAPID_PUBLIC_KEY` (secret keys are refused). `npm run test:browser` checks it in headless Chromium.

## Metronome module

Files: `src/modules/metronome/` (`core.ts` pure timing and patterns, `scheduler.ts` lookahead scheduler, `practice.ts` engine integration, `player.ts` Web Audio), `src/services/metronome-clock.ts` (shared clock). Samples: `harness/static/sounds/` (see `THIRD_PARTY.md`).

```ts
import { MetronomePlayer } from './src/modules/metronome/player.ts';
import { DEFAULT_CONFIG, validateConfig } from './src/modules/metronome/core.ts';
import { METRONOME, ensureFreePractice, logSession, loadPrefs, savePrefs, ladderFor, ladderConfig } from './src/modules/metronome/practice.ts';

const host = createHost(replica, METRONOME);
const player = new MetronomePlayer('./sounds/');
button.onclick = async () => {                 // must be a tap on iOS
  await player.unlock();                       // audio on, kit loaded
  player.start(loadPrefs(host), onLadderRepEnd);
};
player.update(newConfig);                      // live: tempo next click, other changes next bar
player.stop();
await logSession(host, { cardId, workout, startTempo, tempo, bars, durationMs, clean, timingErrorMs? });
```

| Setting | Range / values | Default |
|---|---|---|
| `bpm` | 30 to 300 (whole numbers) | 80 |
| `beatsPerBar`, `beatUnit` | 1 to 12; 2, 4 or 8 (6/8, 9/8, 12/8 accent each group of three) | 4, 4 |
| `subdivision` (plain click) | 1, 2 (8ths), 3 (triplets), 4 (16ths) | 1 |
| `groove` | `click`, `rock`, `shuffle`, `half-time` (grooves use the kit) | `click` |
| `sound` (click and count-in) | `kit` (rim click) or `beep` | `kit` |
| `accentHz`, `beatHz` | 200 to 4000 | 1500, 1000 |
| `master`, `volumes.<voice>` | 0 to 1; voices kick, snare, rim, hihat, hihatOpen, ride, beep | 0.7; 0.5 to 0.9 |
| `countInBars` | 0 to 4 | 1 |
| `workout` | `steady`, `ramp` (bpm to `targetBpm` by `stepBpm` every `everyBars`), `gap` (`playBars` on, `muteBars` silent), `ladder` (one rep of `repBars`) | `steady` |
| `allowDuringQuietHours` | Off: no metronome sound during the user's quiet hours | false |

- `validateConfig(x)` is strict (for edits); `savePrefs` saves only valid, changed settings. `loadPrefs` falls back to defaults field by field, so stored settings can never break the metronome.
- Exercises: `exercises(host)`, `addExercise(host, id, name)`, `ensureFreePractice(host)`. They are `tempo-exercise` cards tagged `guitar`, so they appear in the morning session like other guitar cards.
- Progress: `tempoHistory(reviews)`, `bestCleanTempo(reviews)` (reviews from `host.reviews(cardId)`).
- Tempo ladder: `ladderParams(block)`, `ladderFor(host, params)` gives `{ tempo, cleanStreak, atTarget }`; `ladderConfig(base, params, state)` sets up the next rep.
- Tapping: `tapTempo(msTimes)`; `tapTiming(audioTimes, beats)` gives `{ meanAbsMs, meanOffsetMs }` (positive = behind the beat).

### Metronome clock (shared service)

`player.clock` implements `MetronomeClock`: `now()`, `beatAt(t)`, `nextBeat(t)`, `onBeat(fn)`, `onStop(fn)`, with times in seconds on the audio clock. Modules sync to it; a listener that throws is cut off without affecting the metronome.

### iOS

Start from a tap (`unlock()`). The player asks for the "playback" audio session where supported, so the silent switch does not mute it (this may pause other audio apps while it plays), and keeps the screen awake while playing.
