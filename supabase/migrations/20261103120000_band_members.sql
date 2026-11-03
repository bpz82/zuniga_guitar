-- Band members (Blake, 2026-11-03). Blake (an owner account) invites his
-- bass player with a single-use link that expires after 7 days. Signing up
-- through the link makes a "band member" account tied to Blake's. A normal
-- sign-up without a link stays an owner account, exactly as before.
--
-- What a band member can do, enforced here and not only in the app:
--   - read Blake's Songs I Already Know: the song items (title and tab file
--     details) and the song cards (one per song: which song, archived or
--     not). Nothing else in Blake's log: no ratings, takes, goals, settings,
--     theory or other cards, or practice log;
--   - read Blake's tab files in Storage (read only);
--   - write his own ratings (review events) and his own settings (his time
--     zone, which his scheduler needs) into his own rows, and nothing else:
--     no songs, cards, goals or practice log of his own, no uploads, no
--     reminders;
--   - nothing at all once Blake removes him: every policy below checks the
--     membership on every query, so removal cuts access off immediately.
-- Blake's ratings stay in Blake's rows and the member's in the member's:
-- they never mix, and neither can read the other's.
--
-- The app never holds a secret key. Invite tokens are random (two v4 UUIDs,
-- 244 random bits); only their SHA-256 is stored, so the token is shown to
-- Blake once, when he makes the link.
--
-- Account deletion (cascades): deleting an owner deletes his invites, and
-- his members lose access (their membership keeps no owner). Deleting a
-- member deletes his membership and his own rows. See docs/SETUP.md.

-- ------------------------------------------------------------------ tables
create table public.band_invites (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null references auth.users (id) on delete cascade,
  token_hash  text        not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Who it is for, so Blake can tell his invites apart ("Mike (bass)").
  note        text        not null default '' check (length(note) <= 100),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid        references auth.users (id) on delete set null,
  revoked_at  timestamptz
);
create index band_invites_owner_idx on public.band_invites (owner_id);

create table public.band_members (
  member_id       uuid        primary key references auth.users (id) on delete cascade,
  -- Null once the owner's account is deleted: the member keeps no access.
  owner_id        uuid        references auth.users (id) on delete set null,
  note            text        not null default '' check (length(note) <= 100),
  invite_id       uuid        references public.band_invites (id) on delete set null,
  status          text        not null default 'active' check (status in ('active', 'removed')),
  joined_at       timestamptz not null default now(),
  removed_at      timestamptz,
  data_deleted_at timestamptz,
  check (member_id <> owner_id)
);
create index band_members_owner_idx on public.band_members (owner_id);

-- No direct access to either table: everything goes through the functions
-- below, which return exactly what each side may see. RLS on with no policy
-- means no rows, even if a grant is ever added by mistake.
alter table public.band_invites enable row level security;
alter table public.band_members enable row level security;
revoke all on public.band_invites, public.band_members from anon, authenticated;

-- ------------------------------------------------------- policy helpers
-- The owner whose songs the signed-in user may read: set only for an active
-- band member whose owner still exists. Null for everyone else.
create function public.band_owner_of_me() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.owner_id from public.band_members m
  where m.member_id = (select auth.uid()) and m.status = 'active'
$$;

-- Whether the signed-in user is a band member account (active or not).
create function public.is_band_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.band_members m where m.member_id = (select auth.uid()))
$$;

-- ------------------------------------------------------ events (the log)
-- Policies of one kind are OR'd: an owner still reads only his own events
-- (band_owner_of_me() is null for him); a member reads his own events plus
-- these rows of his owner's.
create policy "band member reads the owner's songs" on public.events
  for select to authenticated
  using (
    user_id = (select public.band_owner_of_me())
    and (
      (event ->> 'type' = 'item-set' and event -> 'item' ->> 'module' = 'songs')
      or (event ->> 'type' = 'card-set' and event -> 'card' ->> 'template' = 'song')
    )
  );

-- Restrictive: AND'd with "add own events". An owner is unaffected; a band
-- member adds only ratings and his own settings, and only while active.
create policy "band member adds only ratings" on public.events
  as restrictive for insert to authenticated
  with check (
    not (select public.is_band_member())
    or ((select public.band_owner_of_me()) is not null and event ->> 'type' in ('review', 'settings-set'))
  );

-- ------------------------------------------------------- Storage (tabs)
-- A member reads his owner's tab files. Read only: no insert, update or
-- delete policy names the owner's folder.
create policy "zg tabs: band member reads the owner's" on storage.objects
  for select to authenticated
  using (bucket_id = 'tabs' and (storage.foldername(name))[1] = (select public.band_owner_of_me())::text);

-- A member uploads nothing to the app's buckets (not even to his own folder).
-- Scoped to these two buckets so no other bucket in the project is touched.
create policy "zg: band members upload nothing" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id not in ('takes', 'tabs') or not (select public.is_band_member()));

-- ------------------------------------------------- reminders: none for members
create policy "band members plan no reminders" on public.nudges
  as restrictive for insert to authenticated
  with check (not (select public.is_band_member()));

-- save_push_subscription runs with its owner's rights (RLS does not apply
-- inside it), so it checks for itself. Unchanged otherwise.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.is_band_member() then raise exception 'band members have no reminders'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth);
end $$;

-- --------------------------------------------------------------- functions
-- Every function checks who is calling. Errors are worded for the person who
-- sees them in the app.

-- The caller's role: {"role":"owner"}, {"role":"member","owner_id":...} or,
-- for a member whose access was removed, {"role":"removed"}.
create function public.band_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.band_members%rowtype;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into m from public.band_members where member_id = me;
  if not found then return jsonb_build_object('role', 'owner'); end if;
  if m.status = 'active' and m.owner_id is not null then
    return jsonb_build_object('role', 'member', 'owner_id', m.owner_id);
  end if;
  return jsonb_build_object('role', 'removed');
end $$;

-- An owner makes a single-use invite link, valid for 7 days. Returns the
-- token once; only its hash is kept.
create function public.create_band_invite(p_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_note text := btrim(coalesce(p_note, ''));
  v_created public.band_invites%rowtype;
begin
  if me is null then raise exception 'not signed in'; end if;
  if public.is_band_member() then raise exception 'band members cannot invite anyone'; end if;
  if length(v_note) > 100 or v_note ~ '[[:cntrl:]]' then raise exception 'the note must be one line of at most 100 characters'; end if;
  if (select count(*) from public.band_invites i
      where i.owner_id = me and i.used_at is null and i.revoked_at is null and i.expires_at > now()) >= 20 then
    raise exception 'you have 20 open invites; revoke some first';
  end if;
  insert into public.band_invites (owner_id, token_hash, note, expires_at)
    values (me, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_note, now() + interval '7 days')
    returning * into v_created;
  return jsonb_build_object('id', v_created.id, 'token', v_token, 'expires_at', v_created.expires_at);
end $$;

-- An owner cancels one of his invites that has not been used.
create function public.revoke_band_invite(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.band_invites set revoked_at = now()
    where id = p_id and owner_id = auth.uid() and used_at is null and revoked_at is null;
  if not found then raise exception 'no open invite of yours with that id'; end if;
end $$;

-- The invited person, signed in on a new account, joins the band. The
-- invite is used up in the same transaction (row lock: single use even when
-- two people try at once). Only a brand-new account can join (no practice
-- data, no band of its own), or a former member of the same band rejoining.
create function public.accept_band_invite(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  inv public.band_invites%rowtype;
  mine public.band_members%rowtype;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'This invite link is not valid.'; end if;
  select * into inv from public.band_invites
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found then raise exception 'This invite link is not valid.'; end if;
  if inv.revoked_at is not null then raise exception 'This invite was cancelled. Ask for a new link.'; end if;
  if inv.used_at is not null then raise exception 'This invite was already used. Ask for a new link.'; end if;
  if inv.expires_at <= now() then raise exception 'This invite has expired. Ask for a new link.'; end if;
  if inv.owner_id = me then raise exception 'This is your own invite. Send it to your band member.'; end if;

  select * into mine from public.band_members where member_id = me;
  if found then
    if mine.status = 'active' and mine.owner_id = inv.owner_id then raise exception 'You are already in this band.'; end if;
    if mine.owner_id is not null and mine.owner_id <> inv.owner_id and mine.status = 'active' then
      raise exception 'This account is already in another band.';
    end if;
  else
    if exists (select 1 from public.events e where e.user_id = me)
       or exists (select 1 from public.band_invites i where i.owner_id = me)
       or exists (select 1 from public.band_members b where b.owner_id = me) then
      raise exception 'Invites are for new accounts. Sign in with an email that has no Zuniga Guitar account yet.';
    end if;
  end if;

  update public.band_invites set used_at = now(), used_by = me where id = inv.id;
  insert into public.band_members (member_id, owner_id, note, invite_id, status, joined_at)
    values (me, inv.owner_id, inv.note, inv.id, 'active', now())
    on conflict (member_id) do update
      set owner_id = excluded.owner_id, note = excluded.note, invite_id = excluded.invite_id,
          status = 'active', joined_at = excluded.joined_at, removed_at = null;
  return jsonb_build_object('role', 'member', 'owner_id', inv.owner_id);
end $$;

-- An owner's band: his invites (newest first) and members. Never the token.
create function public.band_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if public.is_band_member() then raise exception 'band members cannot manage a band'; end if;
  return jsonb_build_object(
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id, 'note', i.note, 'created_at', i.created_at, 'expires_at', i.expires_at,
          'status', case when i.revoked_at is not null then 'revoked'
                         when i.used_at is not null then 'used'
                         when i.expires_at <= now() then 'expired'
                         else 'open' end)
        order by i.created_at desc)
      from (select * from public.band_invites where owner_id = me order by created_at desc limit 100) i), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
          'member_id', m.member_id, 'note', m.note, 'status', m.status, 'joined_at', m.joined_at,
          'removed_at', m.removed_at, 'data_deleted', m.data_deleted_at is not null)
        order by m.joined_at)
      from public.band_members m where m.owner_id = me), '[]'::jsonb));
end $$;

-- An owner removes a member: from this moment every policy above refuses
-- him. Nothing is deleted; a new invite lets him rejoin with his ratings.
create function public.remove_band_member(p_member uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.band_members set status = 'removed', removed_at = now()
    where member_id = p_member and owner_id = auth.uid() and status = 'active';
  if not found then raise exception 'no active member of your band with that id'; end if;
end $$;

-- Deletes a removed member's own data from the server: his ratings and
-- settings (his rows of the log), and any reminders or devices. Only his
-- owner can, only after removing him, and the app asks first. It is the one
-- delete path on the log, and it reaches only that member's rows (the same
-- rows deleting his account would delete). The owner's data is untouched.
create function public.delete_band_member_data(p_member uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform 1 from public.band_members
    where member_id = p_member and owner_id = auth.uid() and status = 'removed' for update;
  if not found then raise exception 'only a member you have removed from your band'; end if;
  delete from public.events where user_id = p_member;
  get diagnostics n = row_count;
  delete from public.nudges where user_id = p_member;
  delete from public.push_subscriptions where user_id = p_member;
  update public.band_members set data_deleted_at = now() where member_id = p_member;
  return n;
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.band_owner_of_me(), public.is_band_member(), public.band_status(),
  public.create_band_invite(text), public.revoke_band_invite(uuid), public.accept_band_invite(text),
  public.band_overview(), public.remove_band_member(uuid), public.delete_band_member_data(uuid)
  from public, anon;
grant execute on function public.band_owner_of_me(), public.is_band_member(), public.band_status(),
  public.create_band_invite(text), public.revoke_band_invite(uuid), public.accept_band_invite(text),
  public.band_overview(), public.remove_band_member(uuid), public.delete_band_member_data(uuid)
  to authenticated;
