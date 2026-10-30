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
| `settings-set` | `settings: { desiredRetention (0.7 to 0.99), windows: [{ id, start 'HH:MM' }] }`. Window ids: `morning`, `before-work`, `during-work`, `after-work`. |
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
| `buildQueue(lib, { now, retentionFor?, weightFor? })` | Today's queue. `retentionFor(cardId)` defaults to settings; `weightFor(cardId)` defaults to 1. The goals layer will supply both. |
| `memoryOf(cardId, reviews, retention)` | One card's memory: `phase` (`new`, `learning`, `review`, `relearning`), `stability`, `difficulty`, `reps`, `lapses`, `lastReview`, `due`, `leech`. |
| `retrievability(memory, now)` | Recall probability now, 0 to 1 (null for new cards). |
| `LEECH_LAPSES` | 8. |

Each `due` entry is `{ memory, retrievability, priority }`. A backlog after a break is just a long queue: show what fits today; the rest stays due and is re-ranked tomorrow.

## Not here yet

Goals math arrives at checkpoint 3, session builder at 4, storage, sync and notifications at 5.
