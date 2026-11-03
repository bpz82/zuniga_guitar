/**
 * Band members (Blake, 2026-11-03): Blake invites his bass player, who then
 * sees only Blake's Songs I Already Know (titles and tabs, read only) and
 * rates them privately in his own log.
 *
 * The server enforces all of it (supabase/migrations/20261103120000_band_members.sql):
 * this file only calls its functions and checks every answer before the app
 * uses it, the same way the log validates every event it pulls. The token
 * of an invite is a bearer secret for one person: it is shown once, put in
 * the link, and never stored by the app beyond the moment it is used.
 */
import type { EngineEvent, EventType } from './model.ts';
import type { Validation } from './validate.ts';

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
/** The one supabase-js call this file uses. */
export interface RpcLike {
  rpc(fn: string, args: object): Result;
}

/** What a band member records in his own log: his ratings and his own settings (time zone). The server allows no more. */
export const MEMBER_WRITES: readonly EventType[] = Object.freeze(['review', 'settings-set'] as const);

/** The owner's events a band member's app keeps: song items and song cards. The server sends no more; this checks again. */
export function isSharedSongEvent(e: EngineEvent): boolean {
  return (e.type === 'item-set' && e.item.module === 'songs') || (e.type === 'card-set' && e.card.template === 'song');
}

/** Who the signed-in account is: an owner (every normal account), a band member, or a member whose access was removed. */
export type BandRole = { readonly role: 'owner' } | { readonly role: 'member'; readonly ownerId: string } | { readonly role: 'removed' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An invite token: 64 lowercase hex characters. */
export const INVITE_TOKEN = /^[0-9a-f]{64}$/;
export const MAX_NOTE = 100;
const CONTROL = /[\u0000-\u001f\u007f]/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

export function parseRole(data: unknown): Validation<BandRole> {
  if (!isObj(data)) return { ok: false, error: 'band status: not an object' };
  if (data.role === 'owner') return { ok: true, value: { role: 'owner' } };
  if (data.role === 'removed') return { ok: true, value: { role: 'removed' } };
  if (data.role === 'member' && typeof data.owner_id === 'string' && UUID.test(data.owner_id)) return { ok: true, value: { role: 'member', ownerId: data.owner_id } };
  return { ok: false, error: 'band status: unknown role' };
}

/** A note on an invite (who it is for): one line, at most 100 characters. Empty is fine. */
export function cleanNote(raw: string): Validation<string> {
  const text = String(raw ?? '').replace(/\t/g, ' ');
  if (CONTROL.test(text)) return { ok: false, error: 'the note must be one line' };
  const note = text.replace(/ +/g, ' ').trim();
  if (note.length > MAX_NOTE) return { ok: false, error: `the note can be at most ${MAX_NOTE} characters` };
  return { ok: true, value: note };
}

export interface Invite {
  readonly id: string;
  readonly note: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'open' | 'used' | 'revoked' | 'expired';
}
export interface Member {
  readonly memberId: string;
  readonly note: string;
  readonly status: 'active' | 'removed';
  readonly joinedAt: string;
  readonly removedAt: string | null;
  /** His data was deleted from the server (after removal). */
  readonly dataDeleted: boolean;
}
export interface Band {
  readonly invites: readonly Invite[];
  readonly members: readonly Member[];
}

const INVITE_STATUS = ['open', 'used', 'revoked', 'expired'] as const;

export function parseBand(data: unknown): Validation<Band> {
  if (!isObj(data) || !Array.isArray(data.invites) || !Array.isArray(data.members)) return { ok: false, error: 'band: not a band' };
  const invites: Invite[] = [];
  for (const i of data.invites) {
    if (!isObj(i) || typeof i.id !== 'string' || !UUID.test(i.id) || typeof i.note !== 'string' || !isTime(i.created_at) || !isTime(i.expires_at)) return { ok: false, error: 'band: bad invite' };
    if (!(INVITE_STATUS as readonly unknown[]).includes(i.status)) return { ok: false, error: 'band: bad invite status' };
    invites.push({ id: i.id, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at, status: i.status as Invite['status'] });
  }
  const members: Member[] = [];
  for (const m of data.members) {
    if (!isObj(m) || typeof m.member_id !== 'string' || !UUID.test(m.member_id) || typeof m.note !== 'string' || !isTime(m.joined_at)) return { ok: false, error: 'band: bad member' };
    if (m.status !== 'active' && m.status !== 'removed') return { ok: false, error: 'band: bad member status' };
    if (m.removed_at !== null && !isTime(m.removed_at)) return { ok: false, error: 'band: bad member' };
    members.push({ memberId: m.member_id, note: m.note, status: m.status, joinedAt: m.joined_at, removedAt: m.removed_at, dataDeleted: m.data_deleted === true });
  }
  return { ok: true, value: { invites, members } };
}

async function call(client: RpcLike, fn: string, args: object = {}): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
function valid<T>(r: Validation<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** The signed-in account's role. Throws when the server can't be reached or answers nonsense. */
export async function bandRole(client: RpcLike): Promise<BandRole> {
  return valid(parseRole(await call(client, 'band_status')));
}

/** The owner's invites and members. */
export async function bandOverview(client: RpcLike): Promise<Band> {
  return valid(parseBand(await call(client, 'band_overview')));
}

/** A new single-use invite, valid for 7 days. The token comes back this once. */
export async function createInvite(client: RpcLike, rawNote: string): Promise<{ id: string; token: string; expiresAt: string }> {
  const note = valid(cleanNote(rawNote));
  const data = await call(client, 'create_band_invite', { p_note: note });
  if (!isObj(data) || typeof data.id !== 'string' || !UUID.test(data.id) || typeof data.token !== 'string' || !INVITE_TOKEN.test(data.token) || !isTime(data.expires_at)) {
    throw new Error('the server sent a bad invite');
  }
  return { id: data.id, token: data.token, expiresAt: data.expires_at };
}

export async function revokeInvite(client: RpcLike, id: string): Promise<void> {
  if (!UUID.test(id)) throw new Error('bad invite id');
  await call(client, 'revoke_band_invite', { p_id: id });
}

/** Joins the band of the invite's owner. Only for a brand-new account (the server checks). */
export async function acceptInvite(client: RpcLike, token: string): Promise<BandRole> {
  if (!INVITE_TOKEN.test(token)) throw new Error('This invite link is not valid.');
  const role = valid(parseRole(await call(client, 'accept_band_invite', { p_token: token })));
  if (role.role !== 'member') throw new Error('the server did not make this account a band member');
  return role;
}

/** Removes a member: his access ends at once. Nothing is deleted. */
export async function removeMember(client: RpcLike, memberId: string): Promise<void> {
  if (!UUID.test(memberId)) throw new Error('bad member id');
  await call(client, 'remove_band_member', { p_member: memberId });
}

/** Deletes a removed member's own data from the server (his ratings and settings). The app asks first. */
export async function deleteMemberData(client: RpcLike, memberId: string): Promise<number> {
  if (!UUID.test(memberId)) throw new Error('bad member id');
  const n = await call(client, 'delete_band_member_data', { p_member: memberId });
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error('the server sent a bad count');
  return n;
}

// --------------------------------------------------------- the link --

/** The link to send: the app's address with the token as ?invite=. */
export function inviteLink(appUrl: string, token: string): string {
  if (!INVITE_TOKEN.test(token)) throw new Error('bad invite token');
  const url = new URL(appUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', token);
  return url.href;
}

/**
 * An invite token in the app's address, and the address without it (so the
 * token leaves the address bar and history at once). A malformed token is
 * dropped too.
 */
export function inviteFromUrl(href: string): { token: string | null; rest: string | null } {
  const url = new URL(href);
  if (!url.searchParams.has('invite')) return { token: null, rest: null };
  const raw = url.searchParams.get('invite') ?? '';
  url.searchParams.delete('invite');
  return { token: INVITE_TOKEN.test(raw) ? raw : null, rest: url.href };
}

/** "Expires Tue 10 Nov", for an invite. */
export function inviteWhen(invite: Pick<Invite, 'status' | 'expiresAt'>): string {
  const day = new Date(invite.expiresAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  if (invite.status === 'open') return `open, expires ${day}`;
  if (invite.status === 'expired') return `expired ${day}`;
  return invite.status === 'used' ? 'used' : 'revoked';
}
