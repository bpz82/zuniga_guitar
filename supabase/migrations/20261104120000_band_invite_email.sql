-- Band invites locked to one email (Blake, 2026-11-04).
--
-- The bug: an invite link was a bearer token for whoever used it first. Blake
-- tested the band-mate flow by signing up a test account through a link; that
-- account used the invite up (it became the band's member), so when his real
-- band mate opened the same link he got "This invite was already used" and
-- could not join. Any stray account that reaches a link first (a test, a
-- forwarded message, a shared device holding the pending link) does the same.
--
-- The fix: an invite can name the one email it is for. Only an account
-- signed in with that email can use it; any other account is refused BEFORE
-- the invite is touched, so the invite stays open for its person. Invites
-- without an email work as before (single use, first come). The app sets the
-- email from an address typed in "Who it's for" (src/band.ts, inviteFor).
--
-- The email is compared with the signed-in account's email in auth.users
-- (set by Supabase Auth, not by the app), lowercased and trimmed.

alter table public.band_invites
  add column email text
  check (email is null or (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- create_band_invite(p_note) becomes create_band_invite(p_note, p_email):
-- p_email is optional, so the app's older call (p_note only) still works.
drop function public.create_band_invite(text);
create function public.create_band_invite(p_note text, p_email text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_note text := btrim(coalesce(p_note, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_created public.band_invites%rowtype;
begin
  if me is null then raise exception 'not signed in'; end if;
  if public.is_band_member() then raise exception 'band members cannot invite anyone'; end if;
  if length(v_note) > 100 or v_note ~ '[[:cntrl:]]' then raise exception 'the note must be one line of at most 100 characters'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'that email address does not look right';
  end if;
  if v_email is not null and v_email = (select lower(btrim(u.email)) from auth.users u where u.id = me) then
    raise exception 'that is your own email. Use your band member''s email.';
  end if;
  if (select count(*) from public.band_invites i
      where i.owner_id = me and i.used_at is null and i.revoked_at is null and i.expires_at > now()) >= 20 then
    raise exception 'you have 20 open invites; revoke some first';
  end if;
  insert into public.band_invites (owner_id, token_hash, note, email, expires_at)
    values (me, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_note, v_email, now() + interval '7 days')
    returning * into v_created;
  return jsonb_build_object('id', v_created.id, 'token', v_token, 'expires_at', v_created.expires_at, 'email', v_created.email);
end $$;

-- As before, plus: an invite for an email is refused, untouched, for any
-- account signed in with another email. That check runs before every other
-- check about the account, so a wrong account learns nothing else and the
-- invite stays open.
create or replace function public.accept_band_invite(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  inv public.band_invites%rowtype;
  mine public.band_members%rowtype;
  my_email text;
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
  if inv.email is not null then
    select lower(btrim(u.email)) into my_email from auth.users u where u.id = me;
    if my_email is null or my_email <> inv.email then
      raise exception 'This invite is for a different email address. Sign in with the email the invite was sent to.';
    end if;
  end if;

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

-- As before, plus each invite's email (null when it has none), so the owner
-- sees who each link is locked to. Still never the token or its hash.
create or replace function public.band_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if public.is_band_member() then raise exception 'band members cannot manage a band'; end if;
  return jsonb_build_object(
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id, 'note', i.note, 'email', i.email, 'created_at', i.created_at, 'expires_at', i.expires_at,
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

revoke all on function public.create_band_invite(text, text), public.accept_band_invite(text), public.band_overview() from public, anon;
grant execute on function public.create_band_invite(text, text), public.accept_band_invite(text), public.band_overview() to authenticated;
