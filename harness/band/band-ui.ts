/**
 * Band members in Settings (Blake, 2026-11-03). An owner makes single-use
 * invite links (7 days), sees and revokes his invites, removes members
 * (their access ends at once) and, after removing one and confirming,
 * deletes that member's data from the server. A band member sees what he
 * is; a member whose access was removed sees that. Every action is a call
 * to the server, which checks who is asking (src/band.ts).
 */
import { bandOverview, createInvite, deleteMemberData, inviteLink, inviteWhen, removeMember, revokeInvite } from '../../src/index.ts';
import type { BandRole, Member, RpcLike } from '../../src/index.ts';
import { hook } from '../shared/hooks.ts';
import type { Hook } from '../shared/hooks.ts';
import type { Sheets } from '../shared/sheets.ts';

const $ = <T extends HTMLElement = HTMLInputElement>(name: Hook) => hook<T>(name);

export interface BandPlaces {
  /** The server, when signed in. */
  client(): RpcLike | null;
  role(): BandRole;
  /** The app's address, for invite links. */
  appUrl(): string;
  sheets: Sheets;
  say(text: string): void;
}

const ROLE_TEXT = {
  local: 'Sign in to invite your band. They see your Songs I Already Know and tabs (read only) and rate the songs privately; nothing else of yours.',
  owner: 'Invite your band. A band member sees only your Songs I Already Know and their tabs, read only, and rates the songs privately. Your ratings, takes, goals, cards and practice stay yours alone.',
  member: "You're a band member: you see your band leader's songs and tabs, read only. Your ratings are yours alone; nobody else sees them.",
  removed: "Your access to the band's songs was removed. Your own ratings stay on this device: export them below if you want a copy.",
} as const;

const label = (m: Pick<Member, 'note'>) => m.note || 'Band member';

export function setupBand(places: BandPlaces) {
  const note = (text: string) => {
    $('band-note').textContent = text;
    if (text) places.say(text);
  };
  /** The member waiting on the delete confirm. */
  let deleting: Member | null = null;
  /** The invite whose link is on show (taken off the page if it is revoked). */
  let shown: string | null = null;
  const forget = () => {
    shown = null;
    $('band-invite-link').value = '';
    $('band-invite-made').hidden = true;
  };

  /** Runs a band action against the server and reports its outcome. */
  const act = async (fn: (client: RpcLike) => Promise<string>) => {
    const client = places.client();
    if (!client) return note('Sign in first.');
    try {
      note(await fn(client));
    } catch (e) {
      note(`Band: ${(e as Error).message}`);
    }
    await refresh();
  };

  const inviteRow = (i: Awaited<ReturnType<typeof bandOverview>>['invites'][number]) => {
    const li = document.createElement('li');
    li.dataset.zg = 'band-invite-row';
    li.dataset.status = i.status;
    li.append(`${i.note || 'Invite'} · ${inviteWhen(i)}`, ' ');
    if (i.status === 'open') {
      const b = document.createElement('button');
      b.dataset.zg = 'band-invite-revoke';
      b.textContent = 'Revoke';
      b.onclick = () =>
        void act(async (c) => {
          await revokeInvite(c, i.id);
          if (shown === i.id) forget();
          return `Revoked the invite${i.note ? ` for ${i.note}` : ''}. The link no longer works.`;
        });
      li.append(b);
    }
    return li;
  };

  const memberRow = (m: Member) => {
    const li = document.createElement('li');
    li.dataset.zg = 'band-member-row';
    li.dataset.status = m.status;
    const since = new Date(m.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    li.append(`${label(m)} · ${m.status === 'active' ? `member since ${since}` : m.dataDeleted ? 'removed, data deleted' : 'removed'}`, ' ');
    if (m.status === 'active') {
      const b = document.createElement('button');
      b.dataset.zg = 'band-member-remove';
      b.textContent = 'Remove';
      b.onclick = () => void act(async (c) => (await removeMember(c, m.memberId), `Removed ${label(m)}. Their access has ended; their own ratings are kept until you delete them.`));
      li.append(b);
    } else if (!m.dataDeleted) {
      const b = document.createElement('button');
      b.dataset.zg = 'band-member-delete';
      b.textContent = 'Delete their data';
      b.onclick = () => {
        deleting = m;
        $('band-delete-who').textContent = `${label(m)}: their ratings and settings.`;
        places.sheets.open('band-delete');
      };
      li.append(b);
    }
    return li;
  };

  /** Fetches the owner's invites and members and draws them. */
  const refresh = async () => {
    const client = places.client();
    if (!client || places.role().role !== 'owner') return;
    try {
      const band = await bandOverview(client);
      $('band-invites').replaceChildren(...band.invites.map(inviteRow));
      $('band-members').replaceChildren(...band.members.map(memberRow));
      if (band.invites.length === 0) $('band-invites').replaceChildren(Object.assign(document.createElement('li'), { textContent: 'No invites yet.' }));
      if (band.members.length === 0) $('band-members').replaceChildren(Object.assign(document.createElement('li'), { textContent: 'No band members yet.' }));
    } catch (e) {
      $('band-note').textContent = `Band: couldn't load (${(e as Error).message}).`;
    }
  };

  return {
    refresh,
    /** The role line, and whether the owner's controls show. */
    render() {
      const client = places.client();
      const role = places.role().role;
      $('band-role').textContent = !client ? ROLE_TEXT.local : ROLE_TEXT[role];
      $('band-manage').hidden = !client || role !== 'owner';
    },
    /** Leaving Settings: a made link (it holds the token) is not left on the page. */
    forget,
    wire() {
      $('band-invite').onclick = () =>
        void act(async (c) => {
          const made = await createInvite(c, $('band-invite-note').value);
          $('band-invite-link').value = inviteLink(places.appUrl(), made.token);
          $('band-invite-made').hidden = false;
          shown = made.id;
          $('band-invite-note').value = '';
          return made.email
            ? `Invite link made for ${made.email}. Send it to your band member; it works once, within 7 days, and only for that email.`
            : 'Invite link made. Send it to your band member; it works once, within 7 days.';
        });
      $('band-invite-copy').onclick = async () => {
        const link = $('band-invite-link');
        try {
          await navigator.clipboard.writeText(link.value);
          note('Link copied.');
        } catch {
          link.select(); // the clipboard is not allowed here: select it for copying by hand
          note('Select the link and copy it.');
        }
      };
      $('band-delete-cancel').onclick = () => places.sheets.close('band-delete');
      places.sheets.onClose('band-delete', () => (deleting = null));
      $('band-delete-confirm').onclick = () => {
        const m = deleting;
        places.sheets.close('band-delete');
        if (!m) return;
        void act(async (c) => {
          const n = await deleteMemberData(c, m.memberId);
          return `Deleted ${label(m)}'s data (${n} ${n === 1 ? 'entry' : 'entries'}).`;
        });
      };
    },
  };
}
