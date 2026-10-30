/**
 * Supabase adapter for sync and push reminders. Takes a supabase-js client
 * (created by the app with the project URL and publishable key) and uses only
 * the few query calls typed below, so the engine has no dependency on it.
 * Row-level security on the server limits every call to the signed-in user.
 */
import type { Remote } from './replica.ts';
import type { EngineEvent } from './model.ts';
import type { Nudge } from './session.ts';
import { nudgesBetween } from './session.ts';
import type { Library } from './project.ts';

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The slice of the supabase-js query builder this file uses. */
export interface SupabaseLike {
  from(table: string): {
    upsert(rows: object[], options: { onConflict: string; ignoreDuplicates: boolean }): Result<unknown>;
    select(columns: string): {
      gt(column: string, value: number): {
        order(column: string, options: { ascending: boolean }): { limit(n: number): Result<{ seq: number; event: unknown }[]> };
      };
    };
  };
  rpc(fn: string, args: object): Result<unknown>;
}

async function check<T>(r: Result<T>): Promise<T | null> {
  const { data, error } = await r;
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

export function supabaseRemote(client: SupabaseLike): Remote {
  return {
    async push(events: readonly EngineEvent[]) {
      if (events.length === 0) return;
      // user_id is filled by the database from the signed-in user.
      await check(client.from('events').upsert(events.map((e) => ({ id: e.id, event: e })), { onConflict: 'user_id,id', ignoreDuplicates: true }));
    },
    async pull(afterSeq: number, limit: number) {
      const rows = await check(client.from('events').select('seq,event').gt('seq', afterSeq).order('seq', { ascending: true }).limit(limit));
      return rows ?? [];
    },
  };
}

/** How far ahead reminders are planned. Opening the app re-plans. */
export const NUDGE_HORIZON_DAYS = 7;

/** The reminders this user should get over the coming days. */
export function planNudges(library: Library, now: number, days = NUDGE_HORIZON_DAYS): Nudge[] {
  return nudgesBetween(library, now, now + days * 24 * 60 * 60 * 1000);
}

/**
 * Replaces this user's unsent reminders on the server with a fresh plan, in
 * one transaction (the replace_nudges database function). The server only
 * sends what is due; it never runs the engine. Turning notifications off
 * uploads an empty plan.
 */
export async function uploadNudges(client: SupabaseLike, nudges: readonly Nudge[]): Promise<void> {
  const plan = nudges.map((n) => ({ at: new Date(n.at).toISOString(), window_id: n.windowId, silent: n.silent }));
  await check(client.rpc('replace_nudges', { plan }));
}
