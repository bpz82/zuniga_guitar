import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, memoryStore, planNudges, RejectedEvent, Replica, supabaseRemote, uploadNudges } from '../src/index.ts';
import type { EngineEvent, Remote, SupabaseLike } from '../src/index.ts';
import { BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

/** A fake server with Supabase's behavior: per-user rows, a growing seq, duplicate inserts ignored. */
function fakeServer() {
  let seq = 0;
  const rows: { seq: number; user: string; id: string; event: unknown }[] = [];
  const failures = { push: 0, pull: 0 };
  const remoteFor = (user: string): Remote => ({
    async push(events) {
      if (failures.push > 0) {
        failures.push--;
        throw new Error('network down');
      }
      for (const e of events) {
        if (!rows.some((r) => r.user === user && r.id === e.id)) rows.push({ seq: ++seq, user, id: e.id, event: JSON.parse(JSON.stringify(e)) });
      }
    },
    async pull(after, limit) {
      if (failures.pull > 0) {
        failures.pull--;
        throw new Error('network down');
      }
      return rows.filter((r) => r.user === user && r.seq > after).slice(0, limit).map(({ seq: s, event }) => ({ seq: s, event }));
    },
  });
  return { rows, failures, remoteFor, inject: (user: string, event: unknown) => rows.push({ seq: ++seq, user, id: 'x', event }) };
}

let tick = Date.UTC(2026, 10, 1, 12);
const clock = () => (tick += 1000);
const review = (cardId: string) => ({ type: 'review', cardId, rating: 'good', durationMs: 2000 });

test('recorded events are saved locally and survive reopening (offline first)', async () => {
  const store = memoryStore();
  const r = await Replica.open(store, 'phone', { now: clock });
  await r.record(BLAKE_SETTINGS_EVENT);
  await r.record(review('c1'));
  assert.equal(r.pendingCount, 2);
  const again = await Replica.open(store, 'phone', { now: clock });
  assert.equal(canonical(again.log), canonical(r.log));
  assert.equal(again.pendingCount, 2);
  assert.equal(again.library.settings.dayStart.timeZone, 'America/New_York');
});

test('invalid events are refused and nothing is saved', async () => {
  const store = memoryStore();
  const r = await Replica.open(store, 'phone', { now: clock });
  await assert.rejects(r.record({ type: 'review', cardId: 'c1', rating: 'perfect', durationMs: 1 }), RejectedEvent);
  assert.equal(store.state.events.length, 0);
  assert.equal(r.log.length, 0);
});

test('two devices converge through the server', async () => {
  const server = fakeServer();
  const phone = await Replica.open(memoryStore(), 'phone', { now: clock });
  const laptop = await Replica.open(memoryStore(), 'laptop', { now: clock });
  await phone.record(review('a'));
  await laptop.record(review('b'));
  await laptop.record(review('c'));
  const p1 = await phone.sync(server.remoteFor('blake'));
  const l1 = await laptop.sync(server.remoteFor('blake'));
  const p2 = await phone.sync(server.remoteFor('blake'));
  assert.deepEqual([p1.pushed, l1.pushed, l1.pulled, p2.pulled], [1, 2, 1, 2]);
  assert.equal(canonical(phone.log), canonical(laptop.log));
  assert.equal(phone.pendingCount + laptop.pendingCount, 0);
  assert.equal(server.rows.length, 3);
});

test('a failed sync loses nothing and a retry creates no duplicates', async () => {
  const server = fakeServer();
  const phone = await Replica.open(memoryStore(), 'phone', { now: clock });
  await phone.record(review('a'));
  server.failures.push = 1;
  await assert.rejects(phone.sync(server.remoteFor('u')), /network/);
  assert.equal(phone.pendingCount, 1, 'still queued');
  await phone.sync(server.remoteFor('u'));
  await phone.sync(server.remoteFor('u'));
  assert.equal(server.rows.length, 1);
  server.failures.pull = 1;
  await phone.record(review('b'));
  await assert.rejects(phone.sync(server.remoteFor('u')), /network/);
  await phone.sync(server.remoteFor('u'));
  assert.equal(server.rows.length, 2);
  assert.equal(phone.log.length, 2);
});

test('pulling pages through a large backlog', async () => {
  const server = fakeServer();
  const old = await Replica.open(memoryStore(), 'old', { now: clock });
  for (let i = 0; i < 25; i++) await old.record(review(`c${i}`));
  await old.sync(server.remoteFor('u'));
  const fresh = await Replica.open(memoryStore(), 'new', { now: clock });
  const report = await fresh.sync(server.remoteFor('u'), 10);
  assert.equal(report.pulled, 25);
  assert.equal(fresh.log.length, 25);
});

test('a corrupt server row is reported and never stored', async () => {
  const server = fakeServer();
  server.inject('u', { v: 1, id: 'bad', at: 1, device: 'evil', type: 'review', cardId: 'c', rating: 'perfect', durationMs: 1 });
  const store = memoryStore();
  const r = await Replica.open(store, 'phone', { now: clock });
  const report = await r.sync(server.remoteFor('u'));
  assert.equal(report.rejected.length, 1);
  assert.equal(r.log.length, 0);
  assert.equal(store.state.events.length, 0);
  assert.equal(store.state.cursor, 1, 'moves past it instead of retrying forever');
});

test('a corrupt event in local storage is set aside on load', async () => {
  const store = memoryStore({ events: [{ v: 1, id: 'junk' }], pending: ['junk'] });
  const r = await Replica.open(store, 'phone', { now: clock });
  assert.equal(r.log.length, 0);
  assert.equal(r.loadRejected.length, 1);
  assert.equal(r.pendingCount, 0);
});

test("each user's data stays theirs: separate stores, separate server rows", async () => {
  const server = fakeServer();
  const a = await Replica.open(memoryStore(), 'phone', { now: clock });
  const b = await Replica.open(memoryStore(), 'phone', { now: clock });
  await a.record(review('alice-card'));
  await b.record(review('bob-card'));
  await a.sync(server.remoteFor('alice'));
  await b.sync(server.remoteFor('bob'));
  await a.sync(server.remoteFor('alice'));
  assert.deepEqual(a.log.map((e) => (e as EngineEvent & { cardId: string }).cardId), ['alice-card']);
  assert.deepEqual(b.log.map((e) => (e as EngineEvent & { cardId: string }).cardId), ['bob-card']);
});

test('recording during a sync waits its turn and is not lost', async () => {
  const server = fakeServer();
  const r = await Replica.open(memoryStore(), 'phone', { now: clock });
  await r.record(review('a'));
  const syncing = r.sync(server.remoteFor('u'));
  const recording = r.record(review('b'));
  await Promise.all([syncing, recording]);
  assert.equal(r.log.length, 2);
  assert.equal(r.pendingCount, 1);
  await r.sync(server.remoteFor('u'));
  assert.equal(server.rows.length, 2);
});

// ------------------------------------------------------ supabase adapter ---

function fakeClient(responses: { error?: string; data?: unknown } = {}) {
  const calls: unknown[][] = [];
  const result = Promise.resolve({ data: responses.data ?? null, error: responses.error ? { message: responses.error } : null });
  const client: SupabaseLike = {
    from: (table) => ({
      upsert: (rows, options) => (calls.push(['upsert', table, rows, options]), result),
      select: (cols) => {
        const range = (eq: unknown[]) => ({
          gt: (col: string, v: number) => ({
            order: (oc: string, o: { ascending: boolean }) => ({ limit: (n: number) => (calls.push(['select', table, cols, ...eq, col, v, oc, o, n]), result as never) }),
          }),
        });
        return { ...range([]), eq: (c: string, v: string) => range(['eq', c, v]) };
      },
    }),
    rpc: (fn, args) => (calls.push(['rpc', fn, args]), result),
  };
  return { client, calls };
}

test('supabase adapter: idempotent upload and ordered paging', async () => {
  const { client, calls } = fakeClient({ data: [{ seq: 7, event: { x: 1 } }] });
  const remote = supabaseRemote(client);
  const r = await Replica.open(memoryStore(), 'phone', { now: clock });
  const e = await r.record(review('a'));
  await remote.push([e]);
  const rows = await remote.pull(3, 100);
  assert.deepEqual(calls[0], ['upsert', 'events', [{ id: e.id, event: e }], { onConflict: 'user_id,id', ignoreDuplicates: true }]);
  assert.deepEqual(calls[1], ['select', 'events', 'seq,event', 'seq', 3, 'seq', { ascending: true }, 100]);
  assert.deepEqual(rows, [{ seq: 7, event: { x: 1 } }]);
  await remote.push([]);
  assert.equal(calls.length, 2, 'nothing sent for an empty push');
});

test('supabase adapter: a named stream pulls only that user\'s rows (one cursor per user, 2026-11-03)', async () => {
  const { client, calls } = fakeClient({ data: [] });
  await supabaseRemote(client, 'u-1').pull(9, 50);
  assert.deepEqual(calls[0], ['select', 'events', 'seq,event', 'eq', 'user_id', 'u-1', 'seq', 9, 'seq', { ascending: true }, 50]);
});

test('supabase adapter: server errors surface, so sync keeps events queued', async () => {
  const { client } = fakeClient({ error: 'permission denied' });
  const r = await Replica.open(memoryStore(), 'phone', { now: clock });
  await r.record(review('a'));
  await assert.rejects(r.sync(supabaseRemote(client)), /permission denied/);
  assert.equal(r.pendingCount, 1);
});

test('reminder plan: next 7 days uploaded in one call; empty when notifications are off', async () => {
  const r = await Replica.open(memoryStore(), 'phone', { now: () => Date.UTC(2026, 10, 1, 12) });
  await r.record(BLAKE_SETTINGS_EVENT);
  await r.record({ type: 'item-set', item: { id: 'i', module: 'm', fields: {} } });
  await r.record({ type: 'card-set', card: { id: 'c', itemId: 'i', template: 't', tags: ['pocket-silent', 'guitar'], retired: false } });
  const plan = planNudges(r.library, Date.UTC(2026, 10, 1, 12));
  assert.ok(plan.length >= 27 && plan.length <= 29, `${plan.length} nudges over 7 days`);
  const { client, calls } = fakeClient();
  await uploadNudges(client, plan);
  assert.equal(calls.length, 1);
  const [kind, fn, args] = calls[0] as [string, string, { plan: { at: string; window_id: string; silent: boolean }[] }];
  assert.equal(kind, 'rpc');
  assert.equal(fn, 'replace_nudges');
  assert.equal(args.plan.length, plan.length);
  assert.ok(args.plan.some((n) => n.window_id === 'during-work' && n.silent));
  await r.record({ type: 'settings-set', settings: { ...(BLAKE_SETTINGS_EVENT as { settings: object }).settings, notifications: false } });
  assert.deepEqual(planNudges(r.library, Date.UTC(2026, 10, 1, 12)), []);
});

test('export and restore: a backup brings everything back, validated, without duplicates', async () => {
  const original = await Replica.open(memoryStore(), 'phone', { now: clock });
  await original.record(BLAKE_SETTINGS_EVENT);
  await original.record(review('a'));
  const backup = JSON.parse(original.exportJson()) as { format: string; events: unknown[] };
  assert.equal(backup.format, 'zuniga-guitar-log');

  const store = memoryStore();
  const restored = await Replica.open(store, 'new-phone', { now: clock });
  const r1 = await restored.restore([...backup.events, { v: 1, id: 'junk' }]);
  assert.equal(r1.added, 2);
  assert.equal(r1.rejected.length, 1, 'junk in a backup is reported, not stored');
  assert.equal(canonical(restored.log), canonical(original.log));
  assert.equal(restored.pendingCount, 2, 'queued to upload');
  assert.equal((await restored.restore(backup.events)).added, 0, 'restoring twice adds nothing');
  assert.equal((await Replica.open(store, 'new-phone')).log.length, 2, 'saved');
});

test('a server that keeps returning the same page cannot hang sync', async () => {
  const stuck: Remote = {
    push: async () => {},
    pull: async () => Array.from({ length: 10 }, (_, i) => ({ seq: 1, event: { bad: i } })),
  };
  const r = await Replica.open(memoryStore(), 'phone', { now: clock });
  const report = await r.sync(stuck, 10);
  assert.equal(report.pulled, 0);
  assert.equal(report.rejected.length, 10);
});

// ------------------------------------------- band members (2026-11-03) ---

const song = (n: number) => [
  { type: 'item-set', item: { id: `song-${n}`, module: 'songs', fields: { title: `Song ${n}` } } },
  { type: 'card-set', card: { id: `song-${n}-c`, itemId: `song-${n}`, template: 'song', tags: ['guitar'], retired: false } },
];
const isSong = (e: EngineEvent) => (e.type === 'item-set' && e.item.module === 'songs') || (e.type === 'card-set' && e.card.template === 'song');

test('writable: a band member records only ratings and settings; anything else is refused and nothing is saved', async () => {
  const store = memoryStore();
  const r = await Replica.open(store, 'phone', { now: clock, writable: ['review', 'settings-set'] });
  await r.record(review('song-1-c'));
  await r.record(BLAKE_SETTINGS_EVENT);
  for (const body of [...song(1), { type: 'played', minutes: 5 }, { type: 'goal-set' }, null, 'review']) {
    await assert.rejects(r.record(body), (e: Error) => e instanceof RejectedEvent && /only record review and settings-set/.test(e.message));
  }
  assert.deepEqual(r.log.map((e) => e.type), ['review', 'settings-set']);
  assert.equal(store.state.events.length, 2);
  // A backup holding other kinds of events restores only what the account may hold.
  const backup = await Replica.open(memoryStore(), 'laptop', { now: clock });
  for (const b of [...song(2), review('song-2-c')]) await backup.record(b);
  const restored = await r.restore(backup.log);
  assert.equal(restored.added, 1);
  assert.deepEqual(restored.rejected.map((x) => x.reason), Array(2).fill('this account can only record review and settings-set events'));
  assert.equal(r.pendingCount, 3);
});

test('shared layer: the owner\'s songs are pulled into their own store, read only, never uploaded or exported', async () => {
  const server = fakeServer();
  const owner = await Replica.open(memoryStore(), 'blake-phone', { now: clock });
  for (const b of [...song(1), ...song(2), review('song-1-c'), { type: 'played', minutes: 20 }]) await owner.record(b);
  await owner.sync(server.remoteFor('blake'));

  // What row-level security lets the member read: the songs, not the rating or the practice log.
  const visible = server.remoteFor('blake');
  const shared: Remote = { push: () => Promise.reject(new Error('never')), pull: async (after, limit) => (await visible.pull(after, limit)).filter((r) => isSong(r.event as EngineEvent)) };
  const sharedStore = memoryStore();
  const own = memoryStore();
  const member = await Replica.open(own, 'mike-phone', { now: clock, writable: ['review', 'settings-set'], shared: { store: sharedStore, accept: isSong } });
  const got = await member.syncShared(shared);
  assert.deepEqual([got.pushed, got.pulled, got.rejected.length], [0, 4, 0]);
  assert.equal(member.log.length, 0, 'none of it is his own');
  assert.equal(member.sharedLog.length, 4);
  assert.deepEqual([...member.library.items.keys()].sort(), ['song-1', 'song-2']);
  assert.equal(member.library.reviews.size, 0, 'the owner\'s rating is not his');

  // His own rating of the owner's song: his own log, his own row on the server.
  await member.record({ ...review('song-1-c'), rating: 'again' });
  assert.equal(member.library.reviews.get('song-1-c')?.[0]?.rating, 'again');
  const pushed = await member.sync(server.remoteFor('mike'));
  assert.deepEqual([pushed.pushed, pushed.pulled], [1, 0]);
  assert.deepEqual(server.rows.filter((r) => r.user === 'mike').map((r) => (r.event as EngineEvent).type), ['review']);
  assert.equal(server.rows.filter((r) => r.user === 'blake').length, 6, 'nothing written to the owner\'s rows');
  assert.equal(owner.library.reviews.get('song-1-c')?.[0]?.rating, 'good', 'the owner\'s ratings never mix with his');
  assert.equal(JSON.parse(member.exportJson()).events.length, 1, 'export: his own events only');

  // Offline next time: both layers come back from this device.
  const again = await Replica.open(own, 'mike-phone', { now: clock, writable: ['review', 'settings-set'], shared: { store: sharedStore, accept: isSong } });
  assert.deepEqual([again.log.length, again.sharedLog.length, again.library.items.size], [1, 4, 2]);
  assert.equal(again.pendingCount, 0);
  // A later edit by the owner (an archived song) reaches him on the next pull, and nothing twice.
  await owner.record({ type: 'card-set', card: { id: 'song-2-c', itemId: 'song-2', template: 'song', tags: ['guitar'], retired: true } });
  await owner.sync(server.remoteFor('blake'));
  assert.equal((await again.syncShared(shared)).pulled, 1);
  assert.equal(again.library.cards.get('song-2-c')?.retired, true);
  assert.equal((await again.syncShared(shared)).pulled, 0);
});

test('shared layer: anything but what the layer accepts is set aside, even if the server sends it', async () => {
  const server = fakeServer();
  const owner = await Replica.open(memoryStore(), 'blake-phone', { now: clock });
  for (const b of [...song(1), review('song-1-c'), { type: 'goal-set', goal: { id: 'g', kind: 'general', what: 'Gig', why: '', deadline: '2026-12-01', itemIds: [], dailyMinutes: 10, weight: 1, blocks: [], archived: false } }]) await owner.record(b);
  await owner.sync(server.remoteFor('blake'));
  server.inject('blake', { not: 'an event' });
  const sharedStore = memoryStore();
  const member = await Replica.open(memoryStore(), 'mike-phone', { now: clock, shared: { store: sharedStore, accept: isSong } });
  const got = await member.syncShared(server.remoteFor('blake')); // a server that sends too much
  assert.equal(got.pulled, 2);
  assert.equal(got.rejected.length, 3);
  assert.equal(member.library.reviews.size + member.library.goals.size, 0);
  assert.equal(sharedStore.state.events.length, 2, 'only songs are kept on the device');
});

test('without a shared layer, syncShared does nothing', async () => {
  const r = await Replica.open(memoryStore(), 'phone', { now: clock });
  assert.deepEqual(await r.syncShared(fakeServer().remoteFor('x')), { pushed: 0, pulled: 0, rejected: [] });
  assert.equal(r.sharedLog.length, 0);
});

test('writable: queued events the account can\'t hold are never uploaded (they would block every upload after them)', async () => {
  const server = fakeServer();
  const store = memoryStore();
  const before = await Replica.open(store, 'phone', { now: clock }); // opened before the role was known
  await before.record(song(1)[0]);
  await before.record(review('song-1-c'));
  const member = await Replica.open(store, 'phone', { now: clock, writable: ['review', 'settings-set'] });
  const report = await member.sync(server.remoteFor('mike'));
  assert.equal(report.pushed, 1);
  assert.deepEqual(report.rejected.map((r) => (r.event as EngineEvent).type), ['item-set']);
  assert.deepEqual(server.rows.map((r) => (r.event as EngineEvent).type), ['review']);
  assert.equal(member.pendingCount, 0, 'nothing left to hold up later uploads');
  assert.equal(member.log.length, 2, 'kept on this device: nothing is deleted');
});
