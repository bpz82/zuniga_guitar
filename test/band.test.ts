import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptInvite,
  addSong,
  archiveSong,
  attachTab,
  bandOverview,
  bandRole,
  cleanNote,
  createHost,
  createInvite,
  deleteMemberData,
  inviteFor,
  inviteFromUrl,
  inviteLink,
  inviteWhen,
  isSharedSongEvent,
  MEMBER_WRITES,
  memoryStore,
  parseBand,
  parseRole,
  rateBaseline,
  rateSong,
  removeMember,
  renameSong,
  Replica,
  revokeInvite,
  runModule,
  SONGS,
  songs,
  unratedSongs,
} from '../src/index.ts';
import type { EngineEvent, RpcLike } from '../src/index.ts';

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER = 'cccccccc-0000-4000-8000-000000000003';
const TOKEN = 'ab'.repeat(32);

/** A fake server answering each function with a fixed reply; records the calls. */
function fakeRpc(replies: Record<string, { data?: unknown; error?: string }>) {
  const calls: [string, object][] = [];
  const client: RpcLike = {
    rpc: (fn, args) => {
      calls.push([fn, args]);
      const r = replies[fn] ?? { error: `no function ${fn}` };
      return Promise.resolve({ data: r.data ?? null, error: r.error ? { message: r.error } : null });
    },
  };
  return { client, calls };
}

test('role: owner, member (with a real owner id) or removed; anything else is refused', () => {
  assert.deepEqual(parseRole({ role: 'owner' }), { ok: true, value: { role: 'owner' } });
  assert.deepEqual(parseRole({ role: 'member', owner_id: OWNER }), { ok: true, value: { role: 'member', ownerId: OWNER } });
  assert.deepEqual(parseRole({ role: 'removed' }), { ok: true, value: { role: 'removed' } });
  for (const bad of [null, 'owner', { role: 'member' }, { role: 'member', owner_id: '../x' }, { role: 'admin' }]) assert.equal(parseRole(bad).ok, false);
});

test('band role from the server; a server error surfaces', async () => {
  assert.deepEqual(await bandRole(fakeRpc({ band_status: { data: { role: 'member', owner_id: OWNER } } }).client), { role: 'member', ownerId: OWNER });
  await assert.rejects(bandRole(fakeRpc({ band_status: { error: 'not signed in' } }).client), /not signed in/);
  await assert.rejects(bandRole(fakeRpc({ band_status: { data: { role: 'god' } } }).client), /unknown role/);
});

test('invite note: one line, at most 100 characters, spaces tidied', () => {
  assert.deepEqual(cleanNote('  Mike \t (bass) '), { ok: true, value: 'Mike (bass)' });
  assert.deepEqual(cleanNote(''), { ok: true, value: '' });
  assert.equal(cleanNote('a\nb').ok, false);
  assert.equal(cleanNote('x'.repeat(101)).ok, false);
});

test('create an invite: the note is cleaned first, the answer is checked, the token comes back once', async () => {
  const good = fakeRpc({ create_band_invite: { data: { id: OWNER, token: TOKEN, expires_at: '2026-11-10T08:00:00Z' } } });
  assert.deepEqual(await createInvite(good.client, ' Mike  (bass) '), { id: OWNER, token: TOKEN, expiresAt: '2026-11-10T08:00:00Z', email: null });
  assert.deepEqual(good.calls, [['create_band_invite', { p_note: 'Mike (bass)' }]]);
  await assert.rejects(createInvite(good.client, 'a\nb'), /one line/);
  assert.equal(good.calls.length, 1, 'a bad note never reaches the server');
  await assert.rejects(createInvite(fakeRpc({ create_band_invite: { data: { id: OWNER, token: 'short', expires_at: '2026-11-10T08:00:00Z' } } }).client, ''), /bad invite/);
  await assert.rejects(createInvite(fakeRpc({ create_band_invite: { error: 'band members cannot invite anyone' } }).client, ''), /cannot invite/);
});

test('who an invite is for: an email in the note locks it to that email; none leaves it open; two are refused', () => {
  assert.deepEqual(inviteFor('Mike (bass)'), { ok: true, value: { note: 'Mike (bass)', email: null } });
  assert.deepEqual(inviteFor(' Mike (bass)  Mike.Bass@Example.com '), { ok: true, value: { note: 'Mike (bass) Mike.Bass@Example.com', email: 'mike.bass@example.com' } });
  assert.deepEqual(inviteFor('Mike <mike@example.com>.'), { ok: true, value: { note: 'Mike <mike@example.com>.', email: 'mike@example.com' } });
  assert.match((inviteFor('mike@example.com bpz82bear@gmail.com') as { error: string }).error, /one email/);
  assert.equal(inviteFor('a\nmike@example.com').ok, false, 'still one line');
});

test('a locked invite: the email goes to the server, which must confirm the lock', async () => {
  const made = { id: OWNER, token: TOKEN, expires_at: '2026-11-10T08:00:00Z', email: 'mike@example.com' };
  const good = fakeRpc({ create_band_invite: { data: made } });
  assert.deepEqual(await createInvite(good.client, 'Mike MIKE@example.com'), { id: OWNER, token: TOKEN, expiresAt: '2026-11-10T08:00:00Z', email: 'mike@example.com' });
  assert.deepEqual(good.calls, [['create_band_invite', { p_note: 'Mike MIKE@example.com', p_email: 'mike@example.com' }]]);
  await assert.rejects(createInvite(fakeRpc({ create_band_invite: { data: { ...made, email: null } } }).client, 'Mike mike@example.com'), /did not lock/);
  const two = fakeRpc({ create_band_invite: { data: made } });
  await assert.rejects(createInvite(two.client, 'a@example.com b@example.com'), /one email/);
  assert.equal(two.calls.length, 0, 'never reaches the server');
  // No email: the call is the same as before (works on a server without the 2026-11-04 migration).
  const open = fakeRpc({ create_band_invite: { data: { ...made, email: null } } });
  assert.equal((await createInvite(open.client, 'Mike')).email, null);
  assert.deepEqual(open.calls, [['create_band_invite', { p_note: 'Mike' }]]);
});

test('a stray account opening a locked invite is refused with the server\'s reason (the invite stays open for its person)', async () => {
  const reason = 'This invite is for a different email address. Sign in with the email the invite was sent to.';
  await assert.rejects(acceptInvite(fakeRpc({ accept_band_invite: { error: reason } }).client, TOKEN), (e: Error) => e.message === reason);
});

test('accept an invite: a malformed token never reaches the server; the server\'s reason is shown as it is', async () => {
  const f = fakeRpc({ accept_band_invite: { error: 'This invite has expired. Ask for a new link.' } });
  await assert.rejects(acceptInvite(f.client, 'nope'), /not valid/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(acceptInvite(f.client, TOKEN), /^Error: This invite has expired\. Ask for a new link\.$/);
  assert.deepEqual(f.calls, [['accept_band_invite', { p_token: TOKEN }]]);
  const ok = fakeRpc({ accept_band_invite: { data: { role: 'member', owner_id: OWNER } } });
  assert.deepEqual(await acceptInvite(ok.client, TOKEN), { role: 'member', ownerId: OWNER });
  await assert.rejects(acceptInvite(fakeRpc({ accept_band_invite: { data: { role: 'owner' } } }).client, TOKEN), /did not make/);
});

test('the owner\'s band: invites and members, checked before use', async () => {
  const band = {
    invites: [{ id: OWNER, note: 'Mike', created_at: '2026-11-03T08:00:00Z', expires_at: '2026-11-10T08:00:00Z', status: 'open' }],
    members: [{ member_id: MEMBER, note: 'Mike', status: 'removed', joined_at: '2026-11-03T09:00:00Z', removed_at: '2026-11-04T09:00:00Z', data_deleted: false }],
  };
  const got = await bandOverview(fakeRpc({ band_overview: { data: band } }).client);
  assert.deepEqual(got.invites[0], { id: OWNER, note: 'Mike', email: null, createdAt: '2026-11-03T08:00:00Z', expiresAt: '2026-11-10T08:00:00Z', status: 'open' });
  const locked = parseBand({ ...band, invites: [{ ...band.invites[0], email: 'mike@example.com' }] });
  assert.equal(locked.ok && locked.value.invites[0]!.email, 'mike@example.com');
  assert.equal(parseBand({ ...band, invites: [{ ...band.invites[0], email: 42 }] }).ok, false);
  assert.deepEqual(got.members[0], { memberId: MEMBER, note: 'Mike', status: 'removed', joinedAt: '2026-11-03T09:00:00Z', removedAt: '2026-11-04T09:00:00Z', dataDeleted: false });
  assert.equal(parseBand({ ...band, invites: [{ ...band.invites[0], status: 'pending' }] }).ok, false);
  assert.equal(parseBand({ ...band, members: [{ ...band.members[0], member_id: 'x' }] }).ok, false);
  assert.equal(parseBand({ invites: [] }).ok, false);
  assert.equal(inviteWhen({ status: 'open', expiresAt: '2026-11-10T08:00:00Z' }), 'open, expires Tue 10 Nov');
  assert.equal(inviteWhen({ status: 'used', expiresAt: '2026-11-10T08:00:00Z' }), 'used');
});

test('revoke, remove and delete: ids checked first, the right function called, counts checked', async () => {
  const f = fakeRpc({ revoke_band_invite: {}, remove_band_member: {}, delete_band_member_data: { data: 12 } });
  await revokeInvite(f.client, OWNER);
  await removeMember(f.client, MEMBER);
  assert.equal(await deleteMemberData(f.client, MEMBER), 12);
  assert.deepEqual(f.calls, [['revoke_band_invite', { p_id: OWNER }], ['remove_band_member', { p_member: MEMBER }], ['delete_band_member_data', { p_member: MEMBER }]]);
  for (const p of [revokeInvite(f.client, 'x'), removeMember(f.client, ''), deleteMemberData(f.client, 'all')]) await assert.rejects(p, /bad/);
  assert.equal(f.calls.length, 3);
  await assert.rejects(deleteMemberData(fakeRpc({ delete_band_member_data: { data: 'lots' } }).client, MEMBER), /bad count/);
  await assert.rejects(deleteMemberData(fakeRpc({ delete_band_member_data: { error: 'only a member you have removed from your band' } }).client, MEMBER), /removed/);
});

test('the invite link: built from the app address, read back once, and taken out of the address', () => {
  const link = inviteLink('https://zuniga.example/app/?x=1#/songs', TOKEN);
  assert.equal(link, `https://zuniga.example/app/?invite=${TOKEN}`);
  assert.deepEqual(inviteFromUrl(link), { token: TOKEN, rest: 'https://zuniga.example/app/' });
  assert.deepEqual(inviteFromUrl(`https://zuniga.example/?invite=${TOKEN}&a=b#/songs`), { token: TOKEN, rest: 'https://zuniga.example/?a=b#/songs' });
  assert.deepEqual(inviteFromUrl('https://zuniga.example/?invite=<script>'), { token: null, rest: 'https://zuniga.example/' }, 'malformed: dropped, and still taken out');
  assert.deepEqual(inviteFromUrl('https://zuniga.example/#/today'), { token: null, rest: null });
  assert.throws(() => inviteLink('https://zuniga.example/', 'abc'), /bad invite token/);
});

// ------------------------------------------- a band member's songs ---

const songEvents = [
  { type: 'item-set', item: { id: 'song-1', module: 'songs', fields: { title: 'Blackbird', tab: 't1', tabName: 'bb.pdf', tabType: 'application/pdf', tabBytes: 10, tabUploaded: true } } },
  { type: 'card-set', card: { id: 'song-1-c', itemId: 'song-1', template: 'song', tags: ['guitar'], retired: false } },
  { type: 'item-set', item: { id: 'song-2', module: 'songs', fields: { title: 'Wonderwall' } } },
  { type: 'card-set', card: { id: 'song-2-c', itemId: 'song-2', template: 'song', tags: ['guitar'], retired: false } },
];

/** The member's replica: his own empty log, and the owner's songs in the shared layer. */
async function memberReplica() {
  let t = Date.UTC(2026, 10, 3, 9);
  const owner = await Replica.open(memoryStore(), 'blake', { now: () => (t += 1000) });
  for (const e of songEvents) await owner.record(e);
  await owner.record({ type: 'review', cardId: 'song-1-c', rating: 'easy', durationMs: 1 }); // Blake's own rating
  const sharedStore = memoryStore({ events: owner.log.filter((e) => isSharedSongEvent(e as EngineEvent)) });
  return Replica.open(memoryStore(), 'mike', { now: () => (t += 1000), writable: MEMBER_WRITES, shared: { store: sharedStore, accept: isSharedSongEvent } });
}

test('a band member sees the owner\'s songs and tabs, and rates them (baseline too) in his own log', async () => {
  const replica = await memberReplica();
  const host = createHost(replica, SONGS);
  assert.deepEqual(songs(host).map((s) => [s.title, s.tab?.name ?? null]), [['Blackbird', 'bb.pdf'], ['Wonderwall', null]]);
  assert.equal(unratedSongs(host).length, 2, 'the owner\'s rating is not his: both wait for his baseline');
  assert.equal((await rateBaseline(host, 'song-1-c', 'hard')).ok, true);
  assert.equal((await rateSong(host, 'song-2-c', 'good', 90_000)).ok, true);
  assert.deepEqual(replica.log.map((e) => [e.type, e.type === 'review' ? e.rating : null]), [['review', 'hard'], ['review', 'good']]);
  assert.equal(replica.pendingCount, 2);
  assert.equal(unratedSongs(host).length, 0);
});

test('a band member cannot add, rename, archive or attach: refused, nothing written, only the songs panel is stopped', async () => {
  for (const attempt of [
    (h: ReturnType<typeof createHost>) => addSong(h, 'k1', 'Yesterday'),
    (h: ReturnType<typeof createHost>) => renameSong(h, 'song-1', 'Blackbird (live)'),
    (h: ReturnType<typeof createHost>) => archiveSong(h, 'song-1'),
    (h: ReturnType<typeof createHost>) => attachTab(h, 'song-1', { id: 't2', name: 'x.pdf', type: 'application/pdf', bytes: 5 }),
  ]) {
    const replica = await memberReplica();
    const host = createHost(replica, SONGS);
    const r = await runModule(host, () => attempt(host));
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /only record review and settings-set/);
    assert.equal(replica.log.length, 0);
    assert.equal(replica.pendingCount, 0);
    assert.equal(songs(createHost(replica, SONGS)).length, 2, 'the owner\'s songs as they were');
  }
});
