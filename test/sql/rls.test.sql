-- Security tests for the migration. Each check raises an exception (and
-- fails the run) if a rule is broken. Alice and Bob are two customers.
\set alice '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set bob   '\'bbbbbbbb-0000-0000-0000-000000000002\''
insert into auth.users values (:alice), (:bob);

-- Helper: run as a signed-in user.
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    return;
  end;
  raise exception 'expected failure: %', label;
end $$;
create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'check failed: %', label; end if;
end $$;

-- ---------------------------------------------------------------- events
select pg_temp.as_user(:alice);
insert into public.events (id, event) values ('e1', '{"id":"e1","type":"played"}'), ('e2', '{"id":"e2","type":"played"}');
-- Re-sending is a no-op (what sync does on retry).
insert into public.events (id, event) values ('e1', '{"id":"e1","type":"played"}') on conflict (user_id, id) do nothing;
select pg_temp.expect((select count(*) from public.events) = 2, 'alice sees her 2 events');
select pg_temp.expect((select bool_and(user_id = :alice) from public.events), 'user_id filled from the login');
select pg_temp.expect((select min(seq) < max(seq) from public.events), 'seq increases');
select pg_temp.expect_error($$insert into public.events (user_id, id, event) values ('bbbbbbbb-0000-0000-0000-000000000002', 'x', '{"id":"x"}')$$, 'alice cannot write as bob');
select pg_temp.expect_error($$insert into public.events (id, event) values ('e3', '{"id":"other"}')$$, 'row id must match event id');
select pg_temp.expect_error($$insert into public.events (id, event) values ('e4', '"not an object"')$$, 'event must be an object');
select pg_temp.expect_error($$update public.events set event = '{"id":"e1","type":"edited"}' where id = 'e1'$$, 'no editing history');
select pg_temp.expect_error($$delete from public.events where id = 'e1'$$, 'no deleting history');
select pg_temp.expect_error($$truncate public.events$$, 'no truncate');
reset role;

select pg_temp.as_user(:bob);
select pg_temp.expect((select count(*) from public.events) = 0, 'bob cannot see alice''s events');
insert into public.events (id, event) values ('e1', '{"id":"e1","type":"played"}');
select pg_temp.expect((select count(*) from public.events) = 1, 'same event id is fine for another user');
reset role;

-- Signed out (anon) gets nothing.
set role anon;
select pg_temp.expect_error($$select * from public.events$$, 'anon cannot read events');
select pg_temp.expect_error($$insert into public.events (id, event) values ('z', '{"id":"z"}')$$, 'anon cannot write events');
reset role;

-- ------------------------------------------------------ push subscriptions
\set ep '\'https://web.push.apple.com/device-1\''
\set key '\'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4\''
select pg_temp.as_user(:alice);
select public.save_push_subscription(:ep, :key, 'BTBZMqHH6r4Tts7J_aSIgg');
select pg_temp.expect((select count(*) from public.push_subscriptions) = 1, 'alice registered her phone');
select pg_temp.expect_error($$insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://x/y', 'k', 'a')$$, 'only through save_push_subscription');
reset role;
select pg_temp.as_user(:bob);
select pg_temp.expect((select count(*) from public.push_subscriptions) = 0, 'bob cannot see alice''s devices');
delete from public.push_subscriptions;
reset role;
select pg_temp.expect((select count(*) from public.push_subscriptions) = 1, 'bob cannot remove alice''s device');
-- Bob signs in on Alice's old phone: it becomes his.
select pg_temp.as_user(:bob);
select public.save_push_subscription(:ep, :key, 'BTBZMqHH6r4Tts7J_aSIgg');
reset role;
select pg_temp.expect((select user_id from public.push_subscriptions where endpoint = :ep) = :bob, 'device follows the last sign-in');
select pg_temp.expect((select count(*) from public.push_subscriptions) = 1, 'never two owners');

-- ----------------------------------------------------------------- nudges
select pg_temp.as_user(:alice);
select public.replace_nudges('[{"at":"2026-11-03T09:00:00Z","window_id":"morning","silent":false},{"at":"2026-11-03T18:00:00Z","window_id":"during-work","silent":true}]');
select pg_temp.expect((select count(*) from public.nudges) = 2, 'alice planned 2 reminders');
select public.replace_nudges('[{"at":"2026-11-03T09:00:00Z","window_id":"morning","silent":false}]');
select pg_temp.expect((select count(*) from public.nudges) = 1, 'a new plan replaces unsent ones');
select pg_temp.expect_error($$select public.replace_nudges('[{"at":"2026-11-03T09:00:00Z","window_id":"party","silent":false}]')$$, 'unknown window refused');
select pg_temp.expect_error($$update public.nudges set sent_at = now()$$, 'users cannot mark reminders sent');
reset role;

-- The server marks one sent; Alice's next plan must not erase it.
update public.nudges set sent_at = now();
select pg_temp.as_user(:alice);
select public.replace_nudges('[]');
select pg_temp.expect((select count(*) from public.nudges) = 1, 'sent reminders are kept');
delete from public.nudges where sent_at is not null;
reset role;
select pg_temp.expect((select count(*) from public.nudges where user_id = :alice and sent_at is not null) = 1, 'users cannot delete sent reminders');
select pg_temp.as_user(:bob);
select pg_temp.expect((select count(*) from public.nudges) = 0, 'bob cannot see alice''s reminders');
select public.replace_nudges('[]');
reset role;
select pg_temp.expect((select count(*) from public.nudges where user_id = :alice) = 1, 'bob''s replan never touches alice');

set role anon;
select pg_temp.expect_error($$select public.replace_nudges('[]')$$, 'anon cannot plan reminders');
reset role;

-- ------------------------------------------- reminder sender (service_role)
-- Exactly what supabase/functions/_shared/rest-db.ts does, and no more.
select pg_temp.expect(has_table_privilege('service_role', 'public.nudges', 'SELECT'), 'sender can read reminders');
select pg_temp.expect(has_table_privilege('service_role', 'public.nudges', 'UPDATE'), 'sender can mark reminders sent');
select pg_temp.expect(has_table_privilege('service_role', 'public.push_subscriptions', 'SELECT'), 'sender can read devices');
select pg_temp.expect(has_table_privilege('service_role', 'public.push_subscriptions', 'DELETE'), 'sender can drop expired devices');
select pg_temp.expect(not has_table_privilege('service_role', 'public.events', 'SELECT'), 'sender never reads the practice log');
select pg_temp.expect(not has_table_privilege('service_role', 'public.nudges', 'DELETE'), 'sender cannot delete reminders');
select pg_temp.expect(not has_table_privilege('service_role', 'public.push_subscriptions', 'INSERT'), 'sender cannot add devices');
set role service_role;
select id from public.nudges where sent_at is null and at <= now() order by at limit 1000;
update public.nudges set sent_at = now() where id in (select id from public.nudges where sent_at is null);
select user_id, endpoint, p256dh, auth from public.push_subscriptions;
delete from public.push_subscriptions where endpoint = 'https://web.push.apple.com/no-such-device';
reset role;

-- --------------------------------------------------------- account deletion
delete from auth.users where id = :alice;
select pg_temp.expect((select count(*) from public.events where user_id = :alice) = 0, 'deleting the account deletes the log');
select pg_temp.expect((select count(*) from public.nudges where user_id = :alice) = 0, 'and reminders');
select pg_temp.expect((select count(*) from public.events where user_id = :bob) = 1, 'bob untouched');
