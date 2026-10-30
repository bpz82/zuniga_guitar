/**
 * Derives the current library from the log. No state is stored anywhere
 * else; call project() after any append or merge.
 *
 * Card scheduling state (FSRS) is not here: the scheduler (checkpoint 2)
 * derives it from `reviews`.
 */
import { replay } from './log.ts';
import type { Log } from './log.ts';
import { DEFAULT_SETTINGS } from './model.ts';
import type { Card, EventOf, Goal, Item, Settings } from './model.ts';

export interface Library {
  readonly items: ReadonlyMap<string, Item>;
  readonly cards: ReadonlyMap<string, Card>;
  readonly goals: ReadonlyMap<string, Goal>;
  readonly settings: Settings;
  /** Every review per card, oldest first. Includes retired and unknown cards. */
  readonly reviews: ReadonlyMap<string, readonly EventOf<'review'>[]>;
  /** Ungraded practice, oldest first. */
  readonly activity: readonly (EventOf<'feel-session'> | EventOf<'task-done'> | EventOf<'played'>)[];
}

/** Latest "-set" event wins for each id. Reviews and activity accumulate. */
export function project(log: Log): Library {
  const items = new Map<string, Item>();
  const cards = new Map<string, Card>();
  const goals = new Map<string, Goal>();
  const reviews = new Map<string, EventOf<'review'>[]>();
  const activity: Library['activity'][number][] = [];
  let settings: Settings = DEFAULT_SETTINGS;

  replay(
    log,
    (_, e) => {
      switch (e.type) {
        case 'item-set':
          items.set(e.item.id, e.item);
          break;
        case 'card-set':
          cards.set(e.card.id, e.card);
          break;
        case 'goal-set':
          goals.set(e.goal.id, e.goal);
          break;
        case 'settings-set':
          settings = e.settings;
          break;
        case 'review': {
          const list = reviews.get(e.cardId);
          if (list) list.push(e);
          else reviews.set(e.cardId, [e]);
          break;
        }
        case 'feel-session':
        case 'task-done':
        case 'played':
          activity.push(e);
          break;
      }
      return undefined;
    },
    undefined,
  );

  return { items, cards, goals, settings, reviews, activity };
}

/** Sibling cards of an item (the item-to-cards link burying will use). */
export function cardsOfItem(library: Library, itemId: string): Card[] {
  return [...library.cards.values()].filter((c) => c.itemId === itemId);
}
