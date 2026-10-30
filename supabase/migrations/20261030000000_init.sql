-- Zuniga Guitar: initial schema.
-- Every table is per user, guarded by row-level security (RLS). Users can
-- only ever see and add their own rows. The practice log is append-only:
-- users have no update or delete rights on it at all.
-- Deleting a user in Supabase Auth deletes all of their rows (cascade).

-- ------------------------------------------------------------------ events
-- One row per engine event. The app validates every event it pulls, so
-- junk a user writes into their own log only ever reaches them, and is set
-- aside there.
create sequence public.events_seq_seq;

create table public.events (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null check (length(id) between 1 and 64),
  seq         bigint      not null default 0,
  event       jsonb       not null check (jsonb_typeof(event) = 'object' and pg_column_size(event) < 65536),
  received_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint event_id_matches check (event ->> 'id' = id)
);
create unique index events_seq_idx on public.events (seq);
create index events_user_seq_idx on public.events (user_id, seq);

-- Sync pulls "everything after seq N". Two devices of one user inserting at
-- once must not commit out of seq order, or one could skip the other's
-- event forever. A per-user lock while assigning seq keeps the order.
create function public.events_assign_seq() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.seq := nextval('public.events_seq_seq');
  new.received_at := now();
  return new;
end $$;
create trigger events_assign_seq before insert on public.events
  for each row execute function public.events_assign_seq();

-- Lock down the trigger's helpers: nobody calls them directly.
revoke all on function public.events_assign_seq() from public;

alter table public.events enable row level security;
create policy "read own events" on public.events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "add own events" on public.events
  for insert to authenticated with check (user_id = (select auth.uid()));
-- No update or delete policy, and no update or delete grant.

-- ------------------------------------------------------ push subscriptions
-- One row per device that allowed notifications.
create table public.push_subscriptions (
  endpoint   text        primary key check (endpoint like 'https://%' and length(endpoint) < 2048),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text        not null check (length(p256dh) between 80 and 100),
  auth       text        not null check (length(auth) between 16 and 32),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "read own devices" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "remove own devices" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- Registering a device: the device belongs to whoever signed in on it last
-- (a shared or handed-down phone stops notifying the previous user).
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth);
end $$;

-- ----------------------------------------------------------------- nudges
-- Reminders the user's app planned for the coming days. The server only
-- sends what is due; it never sees the practice log's contents.
create table public.nudges (
  id        bigint generated always as identity primary key,
  user_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  at        timestamptz not null,
  window_id text        not null check (window_id in ('morning', 'before-work', 'during-work', 'after-work')),
  silent    boolean     not null,
  sent_at   timestamptz
);
create index nudges_due_idx on public.nudges (at) where sent_at is null;
create index nudges_user_idx on public.nudges (user_id);
alter table public.nudges enable row level security;
create policy "read own reminders" on public.nudges
  for select to authenticated using (user_id = (select auth.uid()));
create policy "plan own reminders" on public.nudges
  for insert to authenticated with check (user_id = (select auth.uid()) and sent_at is null);
create policy "replan own unsent reminders" on public.nudges
  for delete to authenticated using (user_id = (select auth.uid()) and sent_at is null);

-- Replaces the user's unsent reminders with a new plan, in one transaction.
-- Runs with the caller's rights, so RLS applies to every row it touches.
create function public.replace_nudges(plan jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(plan) <> 'array' or jsonb_array_length(plan) > 200 then
    raise exception 'plan must be an array of at most 200 reminders';
  end if;
  delete from public.nudges where user_id = auth.uid() and sent_at is null;
  insert into public.nudges (user_id, at, window_id, silent)
    select auth.uid(), (x ->> 'at')::timestamptz, x ->> 'window_id', (x ->> 'silent')::boolean
    from jsonb_array_elements(plan) as x;
end $$;

-- ------------------------------------------------------------------ grants
-- Supabase's defaults grant everything on new tables to anon and
-- authenticated; RLS is the real guard, and these grants are the second one.
revoke all on public.events, public.push_subscriptions, public.nudges from anon, authenticated;
revoke all on sequence public.events_seq_seq from anon, authenticated;
grant select, insert on public.events to authenticated;
grant usage on sequence public.events_seq_seq to authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant select, insert, delete on public.nudges to authenticated;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.replace_nudges(jsonb) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.replace_nudges(jsonb) to authenticated;
