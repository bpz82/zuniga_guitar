/**
 * Sends the reminders that are due. Runs every minute on the server.
 *
 * The server never runs the practice engine: each user's app plans its own
 * reminders for the coming days and uploads them (nudges table). This only
 * sends what is due, so it stays cheap however many users there are.
 *
 * Per-user isolation: every user's reminders are handled separately; one
 * failing user or device never stops the others.
 */
import { pushRequest } from './webpush.ts';
import type { Subscription, Vapid } from './webpush.ts';

/** A reminder older than this when the sender sees it is skipped, not sent late. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export interface DueNudge {
  readonly id: number;
  readonly user_id: string;
  readonly window_id: string;
  readonly silent: boolean;
  /** ISO time it was planned for. */
  readonly at: string;
}

export interface NudgeDb {
  /** Unsent reminders planned at or before `now`. */
  dueNudges(now: Date): Promise<DueNudge[]>;
  subscriptions(userIds: readonly string[]): Promise<(Subscription & { user_id: string })[]>;
  markSent(ids: readonly number[], now: Date): Promise<void>;
  dropSubscription(endpoint: string): Promise<void>;
}

export interface SendReport {
  sent: number;
  skippedStale: number;
  failed: number;
  droppedSubscriptions: number;
}

const COPY: Record<string, { title: string; body: string }> = {
  morning: { title: 'Morning session', body: 'Your guitar session is ready.' },
  'before-work': { title: 'Pocket burst', body: 'Five minutes before work.' },
  'during-work': { title: 'Silent pocket burst', body: 'Five quiet minutes. No sound needed.' },
  'after-work': { title: 'Pocket burst', body: 'Five minutes after work.' },
};

export function message(windowId: string, silent: boolean) {
  const copy = COPY[windowId] ?? { title: 'Practice', body: 'A session is ready.' };
  return { ...copy, windowId, silent, url: '/' };
}

export async function sendDueNudges(deps: {
  db: NudgeDb;
  vapid: Vapid;
  now: number;
  fetch: (url: string, init: RequestInit) => Promise<{ status: number }>;
}): Promise<SendReport> {
  const { db, vapid, now } = deps;
  const report: SendReport = { sent: 0, skippedStale: 0, failed: 0, droppedSubscriptions: 0 };
  const due = await db.dueNudges(new Date(now));
  if (due.length === 0) return report;

  const stale = due.filter((n) => now - Date.parse(n.at) > STALE_AFTER_MS);
  const fresh = due.filter((n) => now - Date.parse(n.at) <= STALE_AFTER_MS);
  report.skippedStale = stale.length;

  const subs = await db.subscriptions([...new Set(fresh.map((n) => n.user_id))]);
  const handled: number[] = stale.map((n) => n.id);

  for (const nudge of fresh) {
    try {
      for (const sub of subs.filter((s) => s.user_id === nudge.user_id)) {
        const { url, init } = await pushRequest(sub, message(nudge.window_id, nudge.silent), vapid, now, {
          topic: `zg-${nudge.window_id}`,
          ttlSeconds: 60 * 60,
        });
        const res = await deps.fetch(url, init);
        if (res.status === 404 || res.status === 410) {
          await db.dropSubscription(sub.endpoint);
          report.droppedSubscriptions++;
        } else if (res.status >= 200 && res.status < 300) {
          report.sent++;
        } else {
          report.failed++;
        }
      }
    } catch {
      report.failed++;
    }
    // Marked handled even if a device failed: reminders are never retried or replayed.
    handled.push(nudge.id);
  }
  await db.markSent(handled, new Date(now));
  return report;
}
