import { test } from 'node:test';
import assert from 'node:assert/strict';
import { message, sendDueNudges, STALE_AFTER_MS } from '../supabase/functions/_shared/send-nudges.ts';
import type { DueNudge, NudgeDb } from '../supabase/functions/_shared/send-nudges.ts';
import { restDb } from '../supabase/functions/_shared/rest-db.ts';
import { b64url, generateKeyPair } from '../supabase/functions/_shared/webpush.ts';

const NOW = Date.UTC(2026, 10, 2, 18, 0);
const iso = (ms: number) => new Date(ms).toISOString();

async function keys() {
  const server = await generateKeyPair();
  const vapid = { publicKey: b64url(server.publicKey), privateKey: b64url(server.privateKey), subject: 'mailto:a@b.c' };
  const sub = async (user: string, endpoint: string) => {
    const ua = await generateKeyPair();
    return { user_id: user, endpoint, p256dh: b64url(ua.publicKey), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  };
  return { vapid, sub };
}

function fakeDb(nudges: DueNudge[], subs: { user_id: string; endpoint: string; p256dh: string; auth: string }[]) {
  const sent: number[] = [];
  const dropped: string[] = [];
  const db: NudgeDb = {
    dueNudges: async () => nudges,
    subscriptions: async (ids) => subs.filter((s) => ids.includes(s.user_id)),
    markSent: async (ids) => void sent.push(...ids),
    dropSubscription: async (e) => void dropped.push(e),
  };
  return { db, sent, dropped };
}

test('sends each due reminder to every device of its own user only', async () => {
  const { vapid, sub } = await keys();
  const subs = [await sub('alice', 'https://push.example/a-phone'), await sub('alice', 'https://push.example/a-laptop'), await sub('bob', 'https://push.example/b')];
  const { db, sent } = fakeDb([{ id: 1, user_id: 'alice', window_id: 'during-work', silent: true, at: iso(NOW - 30_000) }], subs);
  const calls: string[] = [];
  const report = await sendDueNudges({ db, vapid, now: NOW, fetch: async (url) => (calls.push(url), { status: 201 }) });
  assert.deepEqual(calls.sort(), ['https://push.example/a-laptop', 'https://push.example/a-phone']);
  assert.equal(report.sent, 2);
  assert.deepEqual(sent, [1]);
});

test('a reminder the sender sees too late is skipped, never sent late', async () => {
  const { vapid, sub } = await keys();
  const { db, sent } = fakeDb([{ id: 7, user_id: 'u', window_id: 'morning', silent: false, at: iso(NOW - STALE_AFTER_MS - 1) }], [await sub('u', 'https://p/x')]);
  let called = 0;
  const report = await sendDueNudges({ db, vapid, now: NOW, fetch: async () => (called++, { status: 201 }) });
  assert.equal(called, 0);
  assert.equal(report.skippedStale, 1);
  assert.deepEqual(sent, [7], 'marked so it is never replayed');
});

test('expired devices are removed; one broken device or user never stops the others', async () => {
  const { vapid, sub } = await keys();
  const subs = [await sub('a', 'https://p/gone'), await sub('a', 'https://p/ok'), await sub('b', 'https://p/throws'), await sub('c', 'https://p/c')];
  const nudges: DueNudge[] = ['a', 'b', 'c'].map((u, i) => ({ id: i + 1, user_id: u, window_id: 'after-work', silent: false, at: iso(NOW) }));
  const { db, sent, dropped } = fakeDb(nudges, subs);
  const report = await sendDueNudges({
    db,
    vapid,
    now: NOW,
    fetch: async (url) => {
      if (url.endsWith('/throws')) throw new Error('connection reset');
      return { status: url.endsWith('/gone') ? 410 : 201 };
    },
  });
  assert.deepEqual(dropped, ['https://p/gone']);
  assert.equal(report.sent, 2);
  assert.equal(report.failed, 1);
  assert.deepEqual(sent.sort(), [1, 2, 3]);
});

test('reminder text: gentle, and the during-work one says no sound is needed', () => {
  assert.equal(message('during-work', true).title, 'Silent pocket burst');
  assert.equal(message('morning', false).body, 'Your guitar session is ready.');
  assert.equal(message('unknown', false).title, 'Practice');
});

test('nothing due: no database writes, no pushes', async () => {
  const { vapid } = await keys();
  const { db, sent } = fakeDb([], []);
  const report = await sendDueNudges({ db, vapid, now: NOW, fetch: async () => assert.fail('no push expected') });
  assert.deepEqual(report, { sent: 0, skippedStale: 0, failed: 0, droppedSubscriptions: 0 });
  assert.deepEqual(sent, []);
});

test('REST adapter builds the right PostgREST requests', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
  const db = restDb('https://abc.supabase.co/', 'sb_secret_xyz', async (url, init) => (calls.push({ url, init }), reply([])));
  await db.dueNudges(new Date(NOW));
  await db.subscriptions(['u1', 'u2']);
  await db.subscriptions([]);
  await db.markSent([3, 4], new Date(NOW));
  await db.markSent([], new Date(NOW));
  await db.dropSubscription('https://push.example/a?b=c');
  assert.equal(calls.length, 4, 'empty lists make no request');
  assert.match(calls[0]!.url, /^https:\/\/abc\.supabase\.co\/rest\/v1\/nudges\?select=id,user_id,window_id,silent,at&sent_at=is\.null&at=lte\.2026-11-02T18%3A00%3A00\.000Z/);
  assert.match(calls[1]!.url, /push_subscriptions\?select=user_id,endpoint,p256dh,auth&user_id=in\.\(u1,u2\)$/);
  assert.equal(calls[2]!.init.method, 'PATCH');
  assert.match(calls[2]!.url, /nudges\?id=in\.\(3,4\)$/);
  assert.equal(calls[3]!.init.method, 'DELETE');
  assert.match(calls[3]!.url, /endpoint=eq\.https%3A%2F%2Fpush\.example%2Fa%3Fb%3Dc$/);
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(h.apikey, 'sb_secret_xyz');
  assert.equal(h.Authorization, undefined, 'new-style secret keys are not sent as a bearer token');
  const legacy = restDb('https://abc.supabase.co', 'eyJhbGciOi.legacy', async (url, init) => (calls.push({ url, init }), reply([])));
  await legacy.dueNudges(new Date(NOW));
  assert.equal((calls.at(-1)!.init.headers as Record<string, string>).Authorization, 'Bearer eyJhbGciOi.legacy');
});

test('REST adapter surfaces server errors', async () => {
  const db = restDb('https://abc.supabase.co', 'k', async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'bad key' }));
  await assert.rejects(db.dueNudges(new Date(NOW)), /401: bad key/);
});
