/**
 * Module contract, version 0 (stays unlocked until Songs I Already Know
 * proves it). A module never touches the log or the library. It gets a host
 * scoped to its own items and cards, and every write is checked here and
 * then validated again by the log.
 *
 * Failure isolation: a module that breaks a rule, throws, or writes too much
 * is switched off for the rest of the session. The engine and other modules
 * carry on; nothing it tried to write gets in.
 */
import { sessionFor } from './session.ts';
import type { Replica } from './replica.ts';
import type { DueCard } from './scheduler.ts';
import type { Card, CardTag, Details, EventOf, Item, Rating } from './model.ts';

export const CONTRACT_VERSION = 0;
/** A runaway module is stopped after this many writes in an hour. */
export const MAX_WRITES_PER_HOUR = 2000;

export interface ModuleManifest {
  /** Stable id, also stored on every item the module owns. */
  readonly id: string;
  readonly contract: typeof CONTRACT_VERSION;
  /** Card types the module makes, and where each may be practiced. */
  readonly templates: readonly { readonly template: string; readonly tags: readonly CardTag[] }[];
}

export class ContractViolation extends Error {
  constructor(moduleId: string, message: string) {
    super(`${moduleId}: ${message}`);
    this.name = 'ContractViolation';
  }
}

export interface ModuleHost {
  readonly moduleId: string;
  /** False once the module has been switched off. */
  readonly enabled: boolean;
  /** Why it was switched off, if it was. */
  readonly disabledReason: string | null;
  /** This module's items and cards only. */
  items(): Item[];
  cards(): Card[];
  /** Reviews of one of this module's own cards, oldest first. */
  reviews(cardId: string): EventOf<'review'>[];
  /** This module's cards in the current session, in practice order. */
  session(now: number): { due: DueCard[]; fresh: string[] };
  addItem(id: string, fields: Details): Promise<void>;
  addCard(id: string, itemId: string, template: string): Promise<void>;
  retireCard(id: string): Promise<void>;
  reportRep(cardId: string, rating: Rating, durationMs: number, details?: Details): Promise<void>;
}

/** Only this file can switch a host off from outside (the crash boundary). */
const SWITCH_OFF = Symbol('switchOff');
type HostInternals = ModuleHost & { [SWITCH_OFF]?: (reason: string) => void };

export function createHost(replica: Replica, manifest: ModuleManifest, options: { now?: () => number } = {}): ModuleHost {
  const id = manifest.id;
  const now = options.now ?? Date.now;
  const writes: number[] = [];
  let disabledReason: string | null = null;

  const disable = (reason: string) => {
    disabledReason ??= reason;
  };
  const violation = (message: string): never => {
    disable(message);
    throw new ContractViolation(id, message);
  };
  const gate = () => {
    if (disabledReason !== null) throw new ContractViolation(id, `switched off: ${disabledReason}`);
  };
  const budget = () => {
    const t = now();
    while (writes.length > 0 && writes[0]! <= t - 60 * 60 * 1000) writes.shift();
    if (writes.length >= MAX_WRITES_PER_HOUR) violation(`more than ${MAX_WRITES_PER_HOUR} writes in an hour`);
    writes.push(t);
  };
  const ownItem = (itemId: string) => replica.library.items.get(itemId)?.module === id;
  const ownCard = (cardId: string) => {
    const card = replica.library.cards.get(cardId);
    return card !== undefined && ownItem(card.itemId) ? card : undefined;
  };
  const write = async (body: unknown) => {
    budget();
    try {
      await replica.record(body);
    } catch (e) {
      violation(`rejected write: ${(e as Error).message}`);
    }
  };

  const host: HostInternals = {
    [SWITCH_OFF]: disable,
    moduleId: id,
    get enabled() {
      return disabledReason === null;
    },
    get disabledReason() {
      return disabledReason;
    },
    items() {
      gate();
      return [...replica.library.items.values()].filter((i) => i.module === id);
    },
    cards() {
      gate();
      return [...replica.library.cards.values()].filter((c) => ownItem(c.itemId));
    },
    reviews(cardId) {
      gate();
      if (!ownCard(cardId)) violation(`card ${cardId} is not this module's`);
      return [...(replica.library.reviews.get(cardId) ?? [])];
    },
    session(at: number) {
      gate();
      const s = sessionFor(replica.library, at);
      const review = s.segments.find((x) => x.kind === 'review');
      if (!review || review.kind !== 'review') return { due: [], fresh: [] };
      return {
        due: review.due.filter((d) => ownCard(d.memory.cardId)),
        fresh: review.fresh.filter((c) => ownCard(c)),
      };
    },
    async addItem(itemId, fields) {
      gate();
      const existing = replica.library.items.get(itemId);
      if (existing && existing.module !== id) violation(`item ${itemId} belongs to another module`);
      await write({ type: 'item-set', item: { id: itemId, module: id, fields } });
    },
    async addCard(cardId, itemId, template) {
      gate();
      if (!ownItem(itemId)) violation(`item ${itemId} is not this module's`);
      const existing = replica.library.cards.get(cardId);
      if (existing && !ownItem(existing.itemId)) violation(`card ${cardId} belongs to another module`);
      const declared = manifest.templates.find((t) => t.template === template);
      if (!declared) violation(`template ${template} is not in the manifest`);
      await write({ type: 'card-set', card: { id: cardId, itemId, template, tags: [...declared!.tags], retired: false } });
    },
    async retireCard(cardId) {
      gate();
      const card = ownCard(cardId) ?? violation(`card ${cardId} is not this module's`);
      await write({ type: 'card-set', card: { ...card, retired: true } });
    },
    async reportRep(cardId, rating, durationMs, details) {
      gate();
      const card = ownCard(cardId) ?? violation(`card ${cardId} is not this module's`);
      if (card.retired) violation(`card ${cardId} is retired`);
      await write({ type: 'review', cardId, rating, durationMs, ...(details === undefined ? {} : { details }) });
    },
  };
  return host;
}

/**
 * Runs module code inside the crash boundary. If it throws, the module is
 * switched off and the error is returned instead of propagating.
 */
export async function runModule<T>(host: ModuleHost, fn: () => T | Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  if (!host.enabled) return { ok: false, error: `${host.moduleId} is switched off: ${host.disabledReason}` };
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    (host as HostInternals)[SWITCH_OFF]?.(message);
    return { ok: false, error: message };
  }
}
