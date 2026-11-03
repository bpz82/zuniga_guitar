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
// queue.fresh:   never-reviewed cards: higher weight first, then modules take turns (each in the order added)
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

### The intake form (2026-10-31)

`goalFromForm(form, id, lib, now)` (`src/goal-form.ts`) builds a goal from what a person fills in, checking every field strictly, then calls `goalFromIntake`. A gig, or a deadline ("write a new record by 2027-03-01"), with any of:

| Form field | Block made | Notes |
|---|---|---|
| `tasks: [{ label, minutes }]` (up to 5) | `timed-task` | Plain words work: `tasksFromText("10 min in Chord Chemistry")`; the line must start with the minutes. Checked off. |
| `songwriting: { minutes, takes, prompt? }` | `creative-prompt` | A concrete prompt each day, recorded. Without `prompt`, today's comes from the list (`src/modules/songwriting/prompts.ts`), rotating so none repeats until all 20 have come up. Never a count of "ideas". |
| `improv: { takes, minutes, prompt?, rampTo?, rampDays? }` | `improv-takes` | N takes of M minutes, recorded. With a ramp, takes climb to `rampTo` over the last `rampDays` before the date (spec example: 5 to 10 one-minute takes a day for a gig). |
| `feel` | `feel-session` | Guitar yoga, protected. |
| `recall` (needs `itemIds`) | `recall` | Time for the goal's songs; a gig's set gets 95% retention and deadline peaking. |

Gig goals also get `gig-memo` by default (`gigMemo: false` leaves it out; `{ from: 'HH:MM' }` moves it): a post-gig rundown memo shown on gig night by `gigMemos(lib, now)`, from 18:00 until the practice day ends, in whatever session is open, never part of the daily minutes. `memoFor(block)` gives its recording settings (one take, up to 30 minutes). `dailyMinutes` defaults to the sum of the blocks (the memo excluded). `archiveGoal(lib, id)` and `checkInGoal(lib, id, dailyMinutes)` re-save the goal (history kept; a check-in is cleared by saving). Recording an improv or songwriting block's takes ticks it off with a `task-done` event. `improvFor(block)` and `songwritingFor(block, date)` (`src/modules/recorder/blocks.ts`) give today's prompt, takes and minutes; they read params leniently because older goals stored these blocks' params freely.

Rules:
- **Active** through the deadline practice day; gone at the next 3:00am. No cleanup event needed.
- **Retention:** a goal's `targetRetention`, or 95% for gig goals, else `settings.desiredRetention`. A card in several goals takes the highest.
- **Order:** risk x weight. Material in no goal has weight 1; goal material has 1 + goal weight (highest goal wins). New goal cards are introduced first. Weight leans the order; it does not override a card that is far more forgotten.
- **Blocks:** a goal with no blocks gets one recall block. Blocks are scaled to the goal's `dailyMinutes`. Daily blocks: recall, feel-session, timed-task, tempo-ladder (metronome), improv-takes and creative-prompt (recorder, 2026-10-31). The gig-memo is not daily practice: it shows on gig night (`gigMemos`) and takes no daily minutes. Each planned block carries its `params` and `daysLeft` to the module that runs it.
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
| `dueToday(lib, now)` | Cards due today per owning module (a `Map`), whatever the window: due reviews for the whole practice day plus learning steps due now. The Cards badge uses it. |
| `todayBlocks(lib, now)` | Today's goal blocks for an overview: the morning plan's blocks (without recall, which is card time) plus any gig memo due now, each with `done`. |
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
| `adoptDeviceTimeZone(lib, zone)` | (2026-11-02) For settings never set: an event that sets the device's time zone instead of the UTC default, or null (settings already set, zone unchanged or invalid). The app records it once at launch, after the first sync when signed in. |

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
| `supabaseRemote(client, stream)` | (2026-11-03) Pulls only `stream`'s events (a user id): one cursor follows one user. The app always names it. |
| `Replica.open(store, deviceId, { writable, shared })` | (2026-11-03) `writable`: the event types this account may record, restore or upload (others throw `RejectedEvent`, or are reported and never uploaded). `shared: { store, accept }`: a read-only layer of someone else's events (a band member's copy of his owner's songs), in its own store. |
| `replica.syncShared(remote)` / `replica.sharedLog` | Pulls the shared layer (never pushes). Each event is validated and must pass `accept`; anything else is reported, never stored. `log`, `exportJson` and upload stay this user's own. |

## Band members (2026-11-03)

Blake invites his bass player, who then sees only Songs I Already Know (titles and tabs, read only) and rates the songs privately. `src/band.ts` calls the server's functions and checks every answer; the server enforces everything (`supabase/migrations/20261103120000_band_members.sql`).

```ts
import { bandRole, createInvite, inviteLink, inviteFromUrl, acceptInvite, MEMBER_WRITES, isSharedSongEvent } from './src/index.ts';

const made = await createInvite(supabase, 'Mike (bass)');    // { id, token, expiresAt }: the token comes back this once
const link = inviteLink(appUrl, made.token);                   // APP/?invite=<64 hex>
const { token, rest } = inviteFromUrl(location.href);          // read it back, and the address without it
const role = await acceptInvite(supabase, token!);             // the new account joins: { role: 'member', ownerId }
const me = await bandRole(supabase);                           // { role: 'owner' } | { role: 'member', ownerId } | { role: 'removed' }
const replica = await Replica.open(ownStore, deviceId, { writable: MEMBER_WRITES, shared: { store: bandStore, accept: isSharedSongEvent } });
await replica.sync(supabaseRemote(supabase, myId));            // his ratings, his rows
await replica.syncShared(supabaseRemote(supabase, me.ownerId)); // the owner's songs (the server sends nothing else)
```

| | |
|---|---|
| `bandRole(client)` | The signed-in account's role (`band_status`). |
| `createInvite(client, note)` / `revokeInvite(client, id)` | Owner only. Single use, 7 days. The note (who it is for) is one line, at most 100 characters (`cleanNote`). |
| `acceptInvite(client, token)` | Brand-new accounts only (no practice data, no band of their own), or a removed member rejoining the same band. Refused for a used, revoked, expired, unknown or own invite, with a reason worded for the person. |
| `bandOverview(client)` | Owner only: invites (status `open`, `used`, `revoked`, `expired`; never the token) and members (`active` or `removed`, data deleted or not). |
| `removeMember(client, id)` | Owner only. His access ends at once; nothing is deleted. |
| `deleteMemberData(client, id)` | Owner only, only a member he has removed; the app asks first. Deletes that member's own rows (ratings, settings) and returns how many. |
| `MEMBER_WRITES` / `isSharedSongEvent(e)` | What a member records (`review`, `settings-set`); what a member's app keeps of his owner's (song items and song cards). |

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

**Baseline ratings (Blake, 2026-11-02).** Every active song never rated waits on the Songs screen for a rating given without playing it. That rating is the song's first review (`details: { baseline: true }`, duration 0), so it sets the song's starting memory state: Easy starts about a week out, Again comes back the next morning.

| Function | What it does |
|---|---|
| `unratedSongs(host)` | Active songs with no review yet. |
| `rateBaseline(host, cardId, rating)` | The starting rating. Refused for a song already rated (it is in practice now) or archived. |

**Tabs (Blake, 2026-11-02).** One tab file per song: a PDF, a picture (PNG, JPEG, WebP, GIF) or plain text (also `.tab`, `.crd`, `.chopro` files), up to 20 MB. The file is kept on the device (IndexedDB `zg-tabs-<user>`) and, when signed in, backed up on sync to the private Storage bucket `tabs` at `<user id>/tab-<id>.<ext>`: the user's own folder only, add and read, never overwrite or delete (`supabase/migrations/20261102120000_tabs_storage.sql`). The log keeps only the tab's id, name, type, size and whether it is backed up, in the song's item fields; renaming a song keeps them. A new tab replaces the song's tab; the old file is kept. The tab opens from the song's row and from the song being practised.

| Function | What it does |
|---|---|
| `tabTypeOf(name, type)` | The tab type of a picked file, by its type or, when the browser gives none, its name. Anything else is refused. |
| `attachTab(host, itemId, { id, name, type, bytes })` | Attaches (or replaces) a song's tab once its file is saved on the device. |
| `pendingTabs(host)`, `uploadPendingTabs(host, files, storage, userId)` | Tabs not backed up yet; uploads those saved on this device and marks them backed up. |
| `tabFile(host, files, itemId, cloud)` | The tab's file: from this device, or downloaded from Storage and kept. |
| `tabPath(userId, tab)` | `<user id>/tab-<id>.<ext>`. |

## Theory and physics: the curriculum

**One course from both books (Blake, 2026-11-02),** `src/modules/theory/curriculum.ts`: 24 lessons in five chapters (Sound itself; Musical tones; The guitar string; Bodies, ears and rooms; Recording and sound engineering), 171 cards. It starts from absolute basics (what sound is, frequency, amplitude) and every term is defined in a lesson's reading before any card uses it (a test checks about 120 key terms against the lesson that teaches them). Module `theory` via contract v1, all cards `pocket-silent`: off the instrument, served in every pocket burst including work hours, never in the morning guitar session.

- **Lessons:** each has a short reading (shown at the top of today's lesson, and on the Cards screen once unlocked) and 6 to 9 cards. Card types: `qa` (show the answer, rate Again/Hard/Good/Easy) and `mc` (four options, shuffled per showing; right logs Good, wrong logs Again and shows the answer with a short explanation). Reviews record `details.lesson`.
- **Locked until graduated:** a lesson's cards enter the log only when it unlocks, so the scheduler never serves locked material. Lesson 1 is open from the start; the next unlocks when the current one graduates, one at a time. Unlocking is permanent.
- **Graduation rule** (`GRADUATE_STABILITY_DAYS` = 7): every card of the lesson answered, answered right the last time (not Again), and with an FSRS memory stability of at least 7 days (the model expects 90% recall a week from now). In practice: right once, then right again on a later day. A Q/A card rated Easy the very first time counts at once; a multiple-choice answer is at most Good, so it always needs the later day. A slip costs stability, so a card answered Again needs a couple more on-time reviews.
- **Sources stay in the data, never on screen** (Blake, 2026-11-02): each card keeps its citation (book and chapter, or "general" with a note) for checking facts. Cards are original wording about facts: no quoted passages, no reproduced figures; a test refuses book, author and publisher names in anything the user reads.
- **Superseded:** the 2026-10-31 topic deck (`deck.ts`, kept as data). On first launch after the rebuild its book cards are retired and its 17 "general" cards (guitar theory, cassette gear) become Extras, off by default and switchable on the Cards screen; all history is kept. `topics`/`setTopic` are kept for the record and no longer used by the app.
- **Content stays in code;** the log holds only each card's id and lesson number, so corrections reach every device with the app.

| `src/modules/theory/practice.ts` | |
|---|---|
| `seedTheory(host, dayStart)` | Brings the log up to date: the one-time migration, the cards of every unlocked lesson, the next lesson if the current one has graduated, missing Extras (off). Safe on every launch and after every answer. |
| `lessonStates(host, dayStart)`, `currentLesson(host, dayStart)` | Each lesson's state (`graduated`, `current`, `locked`) with how many cards are started and how many meet the rule. |
| `contentOf(host, cardId)` | The card's question, answer (and options, explanation), lesson (or old topic) and source. |
| `rateQa(host, cardId, rating, durationMs)` / `answerMc(host, cardId, option, durationMs)` | Log one answer. |
| `optionsFor(card, seed)` | A multiple-choice card's options in a shuffled order. |
| `extras(host)`, `setExtras(host, on)` | The Extras: counts, and switching them on or off (history kept). |

## Recorder and improv takes

Takes are recorded in the browser (MediaRecorder: WebM/Opus on Chrome, Firefox and laptops; MP4/AAC on iPhone), with echo cancelling, noise suppression and auto gain off (this is music, not a call).

- **A take is one module item** (`recorder`, contract v1, no cards): `title`, `recordedAt`, `durationMs`, `type`, `bytes`, `uploaded`, `archived`, and for prompted takes `prompt`, `runId`, `index`, `of` (and `goalId`, `blockId` from a goal block). Rename, archive and restore are new item-set events; there is no delete anywhere.
- **Audio** is saved on the device first (IndexedDB `zg-takes-<user>`, add-only), then the take is logged, so a logged take always has its audio on the device that recorded it. Sync uploads queued takes, oldest first, to the private `takes` bucket at `<user id>/take-<id>.<ext>`, then marks them uploaded. Offline or failed uploads stay queued; an upload that already got through is recognised (409) and not repeated. Other devices list every take and download one on first play (then keep it).
- **Limits:** a take is 1 second to 30 minutes; the bucket takes audio types only, 50 MB per file.
- **Timed improv:** a prompt, a number of takes (1 to 10) and minutes per take (1 to 30); default "Improvise a song", 3 takes of 5 minutes (Blake's example). Each take stops by itself when its window runs out (or earlier with Stop) and is saved separately as "prompt · take 2 of 3".

| `src/modules/recorder/` | |
|---|---|
| `core.ts` | `pickFormat`, `checkTake`, `storagePath`, `checkImprov`, `takeTitle`, `runState`, limits. |
| `takes.ts` | `saveTake(host, blobs, key, meta, audio)`, `takes(host)`, `renameTake`, `archiveTake`, `restoreTake`, `uploadPending(host, blobs, storage, userId)`, `audioOf(host, blobs, takeId, cloud)`, `runTakes(host, runId)`. |
| `blobs.ts` | `BlobStore`: `indexedDbBlobStore(userId)`, `memoryBlobStore()`. |
| `storage.ts` | `supabaseTakeStorage(client)`: `upload` (never overwrites) and `download`. |

Server: `supabase/migrations/20261031180000_takes_storage.sql`. A signed-in user may add files to their own folder (fixed name shape, audio extensions) and read their own folder; nobody may overwrite, rename or delete. Tested in `npm run test:sql`.

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
- `supabase/migrations/20261103120000_band_members.sql`: band invites and members (functions only, no direct table access); a band member reads only his owner's song items, song cards and tab files, writes only his own ratings and settings, uploads nothing, plans no reminders, and loses everything the moment he is removed.
- `supabase/functions/send-nudges`: called every minute; sends due reminders with Web Push. Logic in `supabase/functions/_shared`, unit-tested.
- Setup: `docs/SETUP.md`.

## Test harness

`harness/` is the app's bare shell (no design; the look is the theme's). Phone first. **Home and Teach (Blake, 2026-11-03):** opening the app shows only a popup (opaque backdrop) of today's objectives as bullet points, built from the current goal (the live goal with the nearest deadline, `harness/today.ts`) and what the plan covers right now: the goal's blocks for today (done ones ticked), the goal's songs in the session, the rest of the deck, other goals' blocks (named), and the lesson waiting on Teach. Start (or any close) moves smoothly into the day's deck: the cards and songs due, the goal's tasks, the metronome; under reduced motion it happens without animation. Opening the app on Home with no goal yet opens the new-goal sheet on Goals instead; once that first goal is saved, Home opens with its popup. Teach, the page beside Home, does the same for the curriculum (`harness/teach.ts`): a popup of today's objectives from the current unlocked chapter (read the new lesson, learn its new cards, review what is due, what unlocks the next lesson), then the reading and the day's lesson deck, the theory cards from the same scheduler whatever the practice window. Each page opens with its popup the first time it shows after the app opens; its "Today's objectives" button shows it again. Swipe sideways between Home and Teach by touch or trackpad (`harness/swipe.ts`), or use the page dots under the top bar. **One menu button** in the top corner (every screen size) opens a list of every screen: Home, Teach, Record, Songs, Ear training, Goals, Cards, Settings, with due-count badges on Home and Cards; there is no tab bar and no side nav. One screen at a time, routed by the URL hash (`#/songs`), so back and forward work and screens can be linked. Opening the app with no hash always shows Home; an old `#/practice` link lands there too (`harness/routes.ts`, tested in `test/routes.test.ts`). Signed out with a connection set up, a sign-in popup opens at launch, on top of the opening ("Not now" keeps this device only); sign-in by emailed code lives in it, also reachable from Settings. Settings never set on any device: the device's time zone replaces the UTC default once (`adoptDeviceTimeZone`), after the first sync when signed in. Buttons that hand off to another screen move there: an ear card's Practise goes to Ear, a goal block's Record goes to Record. **Band members (2026-11-03):** an invite link (`?invite=`) is taken out of the address at once and kept until its person signs in; then it is used before anything else, so the new account is a band member before it holds data (refused: the device signs out again and the sign-in popup says why). A band member's app opens on Songs, read only (`harness/songs-ui.ts` with `readOnly`): his band note, his baselines, the owner's songs with their tabs (view, download), when each is next due for him and his four ratings; Settings has his account, sync, backup and band status; the menu lists only those two, and any other screen's link lands on Songs. The owner's Settings has a Band section (`harness/band-ui.ts`): make a link, see and revoke invites, remove a member, delete a removed member's data behind a confirm (`sheet-band-delete`). Right after a band member first opens the app signed in, in a browser, a popup walks him through putting it on his phone (`harness/install.ts`): on iPhone Share, Add to Home Screen, then sign in again in the Home Screen app (it keeps its own storage, separate from Safari); on Android the Chrome menu, Install app; on a computer, open the app on the phone and do the same. Once per account on each device; Settings opens it again. It exercises everything: sessions, the test deck, songs, ear training, "I played", settings, notification toggles, sign-in by emailed code, sync, backup. `npm run build` writes it to `public/` for Vercel, with the public Supabase connection built in from `ZG_SUPABASE_URL`, `ZG_SUPABASE_PUBLISHABLE_KEY` and `ZG_VAPID_PUBLIC_KEY` (secret keys are refused). `npm run test:browser` checks it in headless Chromium.

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
