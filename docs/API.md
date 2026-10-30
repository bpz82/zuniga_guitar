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
| `settings-set` | `settings: { desiredRetention (0.7 to 0.99), windows: [{ id, start 'HH:MM' }], dayStart?: { timeZone, hour } }`. Window ids: `morning`, `before-work`, `during-work`, `after-work`. Missing `dayStart` means 3:00am America/New_York. |
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
| `memoryOf(cardId, reviews, retention, dayStart?)` | One card's memory: `phase` (`new`, `learning`, `review`, `relearning`), `stability`, `difficulty`, `reps`, `lapses`, `lastReview`, `due`, `leech`. |
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

## Not here yet

Session builder arrives at checkpoint 4; storage, sync and notifications at 5.
