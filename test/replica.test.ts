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
      select: (cols) => ({
        gt: (col, v) => ({
          order: (oc, o) => ({ limit: (n) => (calls.push(['select', table, cols, col, v, oc, o, n]), result as never) }),
        }),
      }),
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
