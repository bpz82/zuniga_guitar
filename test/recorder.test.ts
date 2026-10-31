/** Recorder: formats, take checks, improv prompts, takes through the contract, offline queue and upload. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, memoryStore, Replica, runModule, SONGS } from '../src/index.ts';
import {
  baseType,
  checkImprov,
  checkTake,
  DEFAULT_IMPROV,
  MAX_TAKE_MS,
  MAX_UPLOAD_BYTES,
  pickFormat,
  runState,
  storagePath,
  takeTitle,
} from '../src/modules/recorder/core.ts';
import { memoryBlobStore } from '../src/modules/recorder/blobs.ts';
import { supabaseTakeStorage, TAKES_BUCKET } from '../src/modules/recorder/storage.ts';
import type { StorageClientLike, TakeStorage } from '../src/modules/recorder/storage.ts';
import { archiveTake, audioOf, RECORDER, renameTake, restoreTake, runTakes, saveTake, takes, uploadPending } from '../src/modules/recorder/takes.ts';

const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
let t = Date.UTC(2026, 10, 2, 14);
const clock = () => (t += 1000);
const audio = (bytes = 3000, type = 'audio/webm') => new Blob([new Uint8Array(bytes)], { type });
const meta = (over: object = {}) => ({ title: 'Blues in A', recordedAt: Date.UTC(2026, 10, 2, 9), durationMs: 65_000, type: 'audio/webm;codecs=opus', ...over });

async function setup() {
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  return { replica, host: createHost(replica, RECORDER, { now: clock }), blobs: memoryBlobStore() };
}
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** A fake bucket that behaves like Supabase Storage's add-only rules. */
function fakeStorage() {
  const files = new Map<string, Blob>();
  let offline = false;
  const s: TakeStorage & { files: Map<string, Blob>; setOffline(v: boolean): void } = {
    files,
    setOffline(v) {
      offline = v;
    },
    async upload(path, blob) {
      if (offline) throw new Error('Storage: Failed to fetch');
      if (files.has(path)) return 'exists';
      files.set(path, blob);
      return 'uploaded';
    },
    async download(path) {
      if (offline) throw new Error('Storage: Failed to fetch');
      const f = files.get(path);
      if (!f) throw new Error('Storage: Object not found');
      return f;
    },
  };
  return s;
}

// ------------------------------------------------------------------ core --

test('formats: WebM/Opus where supported, MP4 on iPhone, none when recording is impossible', () => {
  assert.equal(pickFormat(() => true), 'audio/webm;codecs=opus');
  assert.equal(pickFormat((x) => x === 'audio/mp4'), 'audio/mp4');
  assert.equal(pickFormat(() => false), null);
  assert.equal(baseType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(baseType('video/mp4'), null);
});

test('take checks: title, length, type, size and run fields', () => {
  assert.equal(ok(checkTake({ ...meta(), bytes: 10 })).type, 'audio/webm');
  const bad: [string, object][] = [
    ['empty title', { title: '  ' }],
    ['too short', { durationMs: 500 }],
    ['too long', { durationMs: MAX_TAKE_MS + 60_000 }],
    ['not audio', { type: 'image/png' }],
    ['bad time', { recordedAt: 12 }],
    ['index without of', { index: 1 }],
    ['index past of', { index: 4, of: 3 }],
    ['bad run id', { runId: 'no spaces allowed' }],
  ];
  for (const [label, over] of bad) assert.equal(checkTake({ ...meta(over), bytes: 10 }).ok, false, label);
  assert.equal(checkTake({ ...meta(), bytes: 0 }).ok, false, 'empty recording');
});

test('storage paths: the owner is the first folder; nothing else gets in', () => {
  assert.equal(storagePath(USER, 'take-abc', 'audio/mp4'), `${USER}/take-abc.m4a`);
  assert.throws(() => storagePath('local', 'take-abc', 'audio/mp4'), RangeError, 'needs a signed-in user');
  assert.throws(() => storagePath(USER, '../x', 'audio/mp4'), RangeError);
  assert.throws(() => storagePath(USER, 'take-abc', 'text/html'), RangeError);
});

test('improv prompts: Blake\'s default is 3 takes of 5 minutes; limits checked; titles and progress', () => {
  assert.deepEqual(DEFAULT_IMPROV, { prompt: 'Improvise a song', takes: 3, minutes: 5 });
  assert.equal(checkImprov({ prompt: 'Blues in E', takes: 11, minutes: 5 }).ok, false);
  assert.equal(checkImprov({ prompt: 'Blues in E', takes: 3, minutes: 31 }).ok, false);
  assert.equal(checkImprov({ prompt: '', takes: 3, minutes: 5 }).ok, false);
  assert.equal(takeTitle('Blues in E', 2, 3), 'Blues in E · take 2 of 3');
  assert.equal(takeTitle('Blues in E', 1, 1), 'Blues in E');
  assert.deepEqual(runState(DEFAULT_IMPROV, 0), { next: 1, done: false });
  assert.deepEqual(runState(DEFAULT_IMPROV, 3), { next: null, done: true });
});

// ----------------------------------------------------------------- takes --

test('saving a take: audio on the device first, then one item in the log; no cards', async () => {
  const { replica, host, blobs } = await setup();
  const take = ok(await saveTake(host, blobs, 'k1', meta(), audio(3000)));
  assert.equal(take.takeId, 'take-k1');
  assert.deepEqual([take.bytes, take.type, take.uploaded, take.archived], [3000, 'audio/webm', false, false]);
  assert.ok(await blobs.has('take-k1'));
  assert.equal(replica.library.items.get('take-k1')?.module, 'recorder');
  assert.equal(replica.library.cards.size, 0);
  assert.equal(RECORDER.templates.length, 0);
});

test('bad takes are refused with nothing stored and the module still on', async () => {
  const { replica, host, blobs } = await setup();
  const n = replica.log.length;
  assert.equal((await saveTake(host, blobs, 'k1', meta({ durationMs: 200 }), audio())).ok, false);
  assert.equal((await saveTake(host, blobs, 'bad key!', meta(), audio())).ok, false);
  assert.equal((await saveTake(host, blobs, 'k2', meta(), audio(0))).ok, false);
  assert.equal(replica.log.length, n);
  assert.equal(blobs.size, 0);
  ok(await saveTake(host, blobs, 'k3', meta(), audio()));
  assert.equal((await saveTake(host, blobs, 'k3', meta(), audio())).ok, false, 'no second take with one id');
  assert.ok(host.enabled);
});

test('list, rename, archive and restore: every change is a new event; nothing is deleted', async () => {
  const { replica, host, blobs } = await setup();
  ok(await saveTake(host, blobs, 'old', meta({ recordedAt: Date.UTC(2026, 10, 1) }), audio()));
  ok(await saveTake(host, blobs, 'new', meta({ recordedAt: Date.UTC(2026, 10, 2) }), audio()));
  assert.deepEqual(takes(host).map((x) => x.takeId), ['take-new', 'take-old'], 'newest first');
  ok(await renameTake(host, 'take-old', ' Slow blues '));
  assert.equal(takes(host)[1]!.title, 'Slow blues');
  assert.equal((await renameTake(host, 'take-old', '')).ok, false);
  ok(await archiveTake(host, 'take-old'));
  assert.equal(takes(host).find((x) => x.takeId === 'take-old')?.archived, true);
  assert.ok(await blobs.has('take-old'), 'archived audio is kept');
  const n = replica.log.length;
  ok(await archiveTake(host, 'take-old'));
  assert.equal(replica.log.length, n, 'archiving twice writes nothing');
  ok(await restoreTake(host, 'take-old'));
  assert.equal(takes(host).find((x) => x.takeId === 'take-old')?.archived, false);
  assert.equal(replica.log.filter((e) => e.type === 'item-set' && e.item.id === 'take-old').length, 4, 'every version kept');
});

test('offline: takes queue; the next sync uploads them, oldest first, and marks them uploaded', async () => {
  const { host, blobs } = await setup();
  const storage = fakeStorage();
  storage.setOffline(true);
  ok(await saveTake(host, blobs, 'a', meta({ recordedAt: Date.UTC(2026, 10, 1) }), audio()));
  ok(await saveTake(host, blobs, 'b', meta({ recordedAt: Date.UTC(2026, 10, 2) }), audio(10, 'audio/mp4')));
  const offline = await uploadPending(host, blobs, storage, USER);
  assert.deepEqual([offline.uploaded, offline.failed.length], [0, 2]);
  assert.ok(takes(host).every((x) => !x.uploaded), 'still queued');
  storage.setOffline(false);
  const online = await uploadPending(host, blobs, storage, USER);
  assert.deepEqual([online.uploaded, online.failed.length], [2, 0]);
  assert.deepEqual([...storage.files.keys()], [`${USER}/take-a.webm`, `${USER}/take-b.webm`]);
  assert.ok(takes(host).every((x) => x.uploaded));
  assert.equal((await uploadPending(host, blobs, storage, USER)).uploaded, 0, 'nothing left');
});

test('an upload that got through before a crash is recognised, not repeated', async () => {
  const { host, blobs } = await setup();
  const storage = fakeStorage();
  ok(await saveTake(host, blobs, 'a', meta(), audio()));
  storage.files.set(`${USER}/take-a.webm`, audio());
  assert.equal((await uploadPending(host, blobs, storage, USER)).uploaded, 1);
  assert.equal(takes(host)[0]!.uploaded, true);
});

test('another device\'s takes: listed everywhere, uploaded by the device that has the audio, playable after', async () => {
  const { replica, host, blobs } = await setup();
  const storage = fakeStorage();
  ok(await saveTake(host, blobs, 'a', meta(), audio(1234)));
  const laptop = await Replica.open(memoryStore(), 'laptop', { now: clock });
  await laptop.restore(JSON.parse(replica.exportJson()).events);
  const there = createHost(laptop, RECORDER, { now: clock });
  const laptopBlobs = memoryBlobStore();
  assert.equal(takes(there).length, 1);
  assert.deepEqual(await uploadPending(there, laptopBlobs, storage, USER), { uploaded: 0, elsewhere: 1, failed: [] });
  const early = await audioOf(there, laptopBlobs, 'take-a', { storage, userId: USER });
  assert.ok(!early.ok && /not uploaded yet/.test(early.error));
  assert.equal((await uploadPending(host, blobs, storage, USER)).uploaded, 1);
  await laptop.restore(JSON.parse(replica.exportJson()).events);
  const played = ok(await audioOf(there, laptopBlobs, 'take-a', { storage, userId: USER }));
  assert.equal(played.size, 1234);
  assert.ok(await laptopBlobs.has('take-a'), 'kept for offline playback');
  assert.equal((await audioOf(there, memoryBlobStore(), 'take-a', null)).ok, false, 'signed out: only local audio');
});

test('a take too big for the bucket stays on the device and is reported', async () => {
  const { host, blobs } = await setup();
  const storage = fakeStorage();
  const huge = { size: MAX_UPLOAD_BYTES + 1 } as Blob;
  await blobs.put('take-big', { blob: huge, type: 'audio/webm' });
  await host.addItem('take-big', { kind: 'take', title: 'Big', recordedAt: Date.UTC(2026, 10, 2), durationMs: 60_000, type: 'audio/webm', bytes: 1, uploaded: false, archived: false });
  const r = await uploadPending(host, blobs, storage, USER);
  assert.equal(r.failed[0]?.takeId, 'take-big');
  assert.equal(storage.files.size, 0);
});

test('improv runs: each take saved separately, listed in order', async () => {
  const { host, blobs } = await setup();
  for (const i of [1, 2, 3]) {
    ok(await saveTake(host, blobs, `r${i}`, meta({ title: takeTitle('Blues', i, 3), prompt: 'Blues', runId: 'run-1', index: i, of: 3 }), audio()));
  }
  assert.deepEqual(runTakes(host, 'run-1').map((x) => x.title), ['Blues · take 1 of 3', 'Blues · take 2 of 3', 'Blues · take 3 of 3']);
  assert.deepEqual(runState(DEFAULT_IMPROV, runTakes(host, 'run-1').length), { next: null, done: true });
});

test('isolation: other modules cannot see or change takes; a recorder crash leaves them running', async () => {
  const { replica, host, blobs } = await setup();
  ok(await saveTake(host, blobs, 'a', meta(), audio()));
  const songs = createHost(replica, SONGS, { now: clock });
  assert.deepEqual(takes(songs), []);
  assert.equal((await archiveTake(songs, 'take-a')).ok, false);
  const bad = await runModule(songs, () => songs.addItem('take-a', { kind: 'take' }));
  assert.equal(bad.ok, false, 'songs cannot overwrite a take');
  assert.equal(songs.enabled, false);
  assert.ok(host.enabled);
  assert.equal(takes(host)[0]!.title, 'Blues in A');
});

test('supabase adapter: private bucket, never overwrites, treats "already exists" as done', async () => {
  const calls: unknown[] = [];
  let reply: { data: unknown; error: { message: string; statusCode?: string } | null } = { data: {}, error: null };
  const client: StorageClientLike = {
    storage: {
      from(bucket) {
        return {
          upload: async (path, body, options) => (calls.push([bucket, path, body.size, options]), reply),
          download: async () => ({ data: audio(7), error: null }),
        };
      },
    },
  };
  const s = supabaseTakeStorage(client);
  assert.equal(await s.upload(`${USER}/take-a.webm`, audio(5), 'audio/webm'), 'uploaded');
  assert.deepEqual(calls[0], [TAKES_BUCKET, `${USER}/take-a.webm`, 5, { contentType: 'audio/webm', upsert: false }]);
  reply = { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
  assert.equal(await s.upload(`${USER}/take-a.webm`, audio(5), 'audio/webm'), 'exists');
  reply = { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
  await assert.rejects(s.upload(`${USER}/take-a.webm`, audio(5), 'audio/webm'), /row-level security/);
  assert.equal((await s.download('x')).size, 7);
});
