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

-- ------------------------------------------------------------ takes (Storage)
\set aliceTake '\'aaaaaaaa-0000-0000-0000-000000000001/take-k1.webm\''
select pg_temp.expect((select not public and file_size_limit = 52428800 from storage.buckets where id = 'takes'), 'takes bucket is private, 50 MB per file');
select pg_temp.expect((select allowed_mime_types @> array['audio/webm', 'audio/mp4'] and not allowed_mime_types && array['text/html', 'image/svg+xml'] from storage.buckets where id = 'takes'), 'audio types only');
insert into storage.buckets (id, name) values ('other', 'other');

select pg_temp.as_user(:alice);
insert into storage.objects (bucket_id, name) values ('takes', :aliceTake);
insert into storage.objects (bucket_id, name) values ('takes', 'aaaaaaaa-0000-0000-0000-000000000001/take-k2.m4a');
select pg_temp.expect((select count(*) from storage.objects) = 2, 'alice sees her 2 takes');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'bbbbbbbb-0000-0000-0000-000000000002/take-x.webm')$$, 'alice cannot write into bob''s folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'take-x.webm')$$, 'no file outside a user folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'aaaaaaaa-0000-0000-0000-000000000001/sub/take-x.webm')$$, 'no nested folders');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'aaaaaaaa-0000-0000-0000-000000000001/take-x.html')$$, 'audio extensions only');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'aaaaaaaa-0000-0000-0000-000000000001/notes.webm')$$, 'take names only');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('other', 'aaaaaaaa-0000-0000-0000-000000000001/take-x.webm')$$, 'these policies open no other bucket');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'aaaaaaaa-0000-0000-0000-000000000001/take-k1.webm')$$, 'no overwriting a take (same name)');
update storage.objects set name = 'aaaaaaaa-0000-0000-0000-000000000001/take-renamed.webm' where name = :aliceTake;
delete from storage.objects where name = :aliceTake;
update storage.buckets set public = true where id = 'takes';
select pg_temp.expect_error($$insert into storage.buckets (id, name, public) values ('mine', 'mine', true)$$, 'users cannot create buckets');
reset role;
select pg_temp.expect((select count(*) from storage.objects where name = :aliceTake) = 1, 'alice can neither rename nor delete a take');
select pg_temp.expect((select not public from storage.buckets where id = 'takes'), 'users cannot make the bucket public');

select pg_temp.as_user(:bob);
select pg_temp.expect((select count(*) from storage.objects) = 0, 'bob cannot see alice''s takes');
delete from storage.objects;
reset role;
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'takes') = 2, 'bob cannot delete alice''s takes');

set role anon;
select pg_temp.expect((select count(*) from storage.objects) = 0, 'signed out: no takes visible');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'aaaaaaaa-0000-0000-0000-000000000001/take-anon.webm')$$, 'signed out: cannot upload');
reset role;

-- ------------------------------------------------------- tabs (Storage, 2026-11-02)
\set aliceTab '\'aaaaaaaa-0000-0000-0000-000000000001/tab-t1.pdf\''
select pg_temp.expect((select not public and file_size_limit = 20971520 from storage.buckets where id = 'tabs'), 'tabs bucket is private, 20 MB per file');
select pg_temp.expect((select allowed_mime_types @> array['application/pdf', 'image/jpeg', 'text/plain'] and not allowed_mime_types && array['text/html', 'image/svg+xml', 'application/javascript'] from storage.buckets where id = 'tabs'), 'PDF, pictures and plain text only');

select pg_temp.as_user(:alice);
insert into storage.objects (bucket_id, name) values ('tabs', :aliceTab);
insert into storage.objects (bucket_id, name) values ('tabs', 'aaaaaaaa-0000-0000-0000-000000000001/tab-t2.txt');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'tabs') = 2, 'alice sees her 2 tabs');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'bbbbbbbb-0000-0000-0000-000000000002/tab-x.pdf')$$, 'alice cannot write into bob''s folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'tab-x.pdf')$$, 'no tab outside a user folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'aaaaaaaa-0000-0000-0000-000000000001/sub/tab-x.pdf')$$, 'no nested folders');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'aaaaaaaa-0000-0000-0000-000000000001/tab-x.html')$$, 'tab extensions only');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'aaaaaaaa-0000-0000-0000-000000000001/take-x.webm')$$, 'take names do not go in the tabs bucket');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'aaaaaaaa-0000-0000-0000-000000000001/tab-x.pdf')$$, 'tab names do not go in the takes bucket');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'aaaaaaaa-0000-0000-0000-000000000001/tab-t1.pdf')$$, 'no overwriting a tab (same name)');
update storage.objects set name = 'aaaaaaaa-0000-0000-0000-000000000001/tab-renamed.pdf' where name = :aliceTab;
delete from storage.objects where name = :aliceTab;
update storage.buckets set public = true where id = 'tabs';
reset role;
select pg_temp.expect((select count(*) from storage.objects where name = :aliceTab) = 1, 'alice can neither rename nor delete a tab');
select pg_temp.expect((select not public from storage.buckets where id = 'tabs'), 'users cannot make the tabs bucket public');

select pg_temp.as_user(:bob);
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'tabs') = 0, 'bob cannot see alice''s tabs');
delete from storage.objects where bucket_id = 'tabs';
reset role;
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'tabs') = 2, 'bob cannot delete alice''s tabs');

set role anon;
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'tabs') = 0, 'signed out: no tabs visible');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'aaaaaaaa-0000-0000-0000-000000000001/tab-anon.pdf')$$, 'signed out: cannot upload a tab');
reset role;

-- ------------------------------------------------- band members (2026-11-03)
-- Alice is the owner (Blake), Carol her bass player, Dave someone else new.
\set carol '\'cccccccc-0000-0000-0000-000000000003\''
\set dave  '\'dddddddd-0000-0000-0000-000000000004\''
insert into auth.users values (:carol), (:dave);

-- Alice has a song with a tab, and private practice data around it.
select pg_temp.as_user(:alice);
insert into public.events (id, event) values
  ('s1', '{"id":"s1","type":"item-set","item":{"id":"song-1","module":"songs","fields":{"title":"Blackbird","tab":"t1","tabName":"blackbird.pdf","tabType":"application/pdf","tabBytes":10,"tabUploaded":true}}}'),
  ('s2', '{"id":"s2","type":"card-set","card":{"id":"song-1-c","itemId":"song-1","template":"song","tags":["guitar"],"retired":false}}'),
  ('p1', '{"id":"p1","type":"review","cardId":"song-1-c","rating":"good"}'),
  ('p2', '{"id":"p2","type":"goal-set","goal":{"id":"g1","what":"Gig"}}'),
  ('p3', '{"id":"p3","type":"item-set","item":{"id":"take-1","module":"recorder","fields":{"title":"Blues"}}}'),
  ('p4', '{"id":"p4","type":"card-set","card":{"id":"th-1-c","itemId":"th-1","template":"qa","tags":[],"retired":false}}'),
  ('p5', '{"id":"p5","type":"settings-set","settings":{}}'),
  ('p6', '{"id":"p6","type":"review","cardId":"song-1-c","rating":"easy","item":{"module":"songs"},"card":{"template":"song"}}');
select pg_temp.expect((select public.band_status() ->> 'role') = 'owner', 'a normal account is an owner');
select (x ->> 'token') as carol_token from (select public.create_band_invite('Carol (bass)') as x) s \gset
reset role;
select pg_temp.expect((select count(*) from public.band_invites where token_hash = :'carol_token') = 0, 'the token itself is never stored');
select pg_temp.expect((select bool_and(expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days') from public.band_invites where owner_id = :alice), 'an invite expires after 7 days');

-- Carol signs up through the link and joins.
select pg_temp.as_user(:carol);
select pg_temp.expect((select public.band_status() ->> 'role') = 'owner', 'a brand-new account is an owner until it joins');
select pg_temp.expect((select public.accept_band_invite(:'carol_token') ->> 'owner_id') = :alice, 'carol joins alice''s band');
select pg_temp.expect((select public.band_status()) = jsonb_build_object('role', 'member', 'owner_id', :alice), 'carol is alice''s band member');

-- She reads alice's song and its card, and nothing else of alice's.
select pg_temp.expect((select array_agg(id order by id) from public.events where user_id = :alice) = array['s1', 's2'], 'carol sees exactly alice''s song and its card');
select pg_temp.expect((select count(*) from public.events where event ->> 'type' = 'review') = 0, 'carol cannot read alice''s ratings (even one dressed up as a song)');
select pg_temp.expect((select count(*) from public.events where event ->> 'type' = 'goal-set') = 0, 'carol cannot read alice''s goals');
select pg_temp.expect((select count(*) from public.events where event ->> 'type' = 'played') = 0, 'carol cannot read alice''s practice log');
select pg_temp.expect((select count(*) from public.events where event -> 'item' ->> 'module' = 'recorder') = 0, 'carol cannot read alice''s takes');
select pg_temp.expect((select count(*) from public.events where id = 'p4') = 0, 'carol cannot read alice''s other cards');
select pg_temp.expect((select count(*) from public.events where event ->> 'type' = 'settings-set') = 0, 'carol cannot read alice''s settings');
select pg_temp.expect((select count(*) from public.events where user_id = :bob) = 0, 'carol sees nothing of other owners');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'tabs') = 2, 'carol can read alice''s tab files');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'takes') = 0, 'carol cannot read alice''s take files');

-- She writes her own ratings and settings, and nothing else.
insert into public.events (id, event) values ('c1', '{"id":"c1","type":"review","cardId":"song-1-c","rating":"hard","details":{"baseline":true}}');
insert into public.events (id, event) values ('c2', '{"id":"c2","type":"settings-set","settings":{}}');
select pg_temp.expect((select count(*) from public.events where user_id = :carol) = 2, 'carol keeps her own ratings and settings');
select pg_temp.expect_error($$insert into public.events (id, event) values ('c3', '{"id":"c3","type":"item-set","item":{"id":"song-1","module":"songs","fields":{"title":"Renamed"}}}')$$, 'carol cannot add or edit a song');
select pg_temp.expect_error($$insert into public.events (id, event) values ('c3', '{"id":"c3","type":"card-set","card":{"id":"song-1-c","itemId":"song-1","template":"song","tags":["guitar"],"retired":true}}')$$, 'carol cannot archive a song');
select pg_temp.expect_error($$insert into public.events (id, event) values ('c3', '{"id":"c3","type":"goal-set","goal":{"id":"g9"}}')$$, 'carol keeps no goals');
select pg_temp.expect_error($$insert into public.events (id, event) values ('c3', '{"id":"c3","type":"played","minutes":5}')$$, 'carol keeps no practice log');
select pg_temp.expect_error($$insert into public.events (user_id, id, event) values ('aaaaaaaa-0000-0000-0000-000000000001', 'c3', '{"id":"c3","type":"review","cardId":"song-1-c","rating":"good"}')$$, 'carol cannot write into alice''s rows');
select pg_temp.expect_error($$update public.events set event = '{"id":"s1","type":"item-set"}' where id = 's1'$$, 'carol cannot edit alice''s songs');
select pg_temp.expect_error($$delete from public.events where id = 's1'$$, 'carol cannot delete alice''s songs');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'aaaaaaaa-0000-0000-0000-000000000001/tab-c1.pdf')$$, 'carol cannot add a tab to alice''s folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('tabs', 'cccccccc-0000-0000-0000-000000000003/tab-c1.pdf')$$, 'a band member uploads no tabs, even to his own folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('takes', 'cccccccc-0000-0000-0000-000000000003/take-c1.webm')$$, 'a band member uploads no takes');
update storage.objects set name = 'aaaaaaaa-0000-0000-0000-000000000001/tab-moved.pdf' where bucket_id = 'tabs';
delete from storage.objects where bucket_id = 'tabs';
-- Nothing to manage, no reminders.
select pg_temp.expect_error($$select public.band_overview()$$, 'a member cannot see the band''s invites or members');
select pg_temp.expect_error($$select public.create_band_invite('x')$$, 'a member cannot invite anyone');
select pg_temp.expect_error($$select * from public.band_invites$$, 'no direct access to invites');
select pg_temp.expect_error($$select * from public.band_members$$, 'no direct access to members');
select pg_temp.expect_error($$select public.remove_band_member('cccccccc-0000-0000-0000-000000000003')$$, 'a member cannot remove anyone');
select pg_temp.expect_error($$select public.delete_band_member_data('cccccccc-0000-0000-0000-000000000003')$$, 'a member cannot delete his own data');
select pg_temp.expect_error($$select public.replace_nudges('[{"at":"2026-11-03T09:00:00Z","window_id":"morning","silent":false}]')$$, 'a member plans no reminders');
select pg_temp.expect_error($$select public.save_push_subscription('https://web.push.apple.com/carol', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg')$$, 'a member registers no device');
reset role;
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'tabs' and name like 'aaaaaaaa-0000-0000-0000-000000000001/tab-t%') = 2, 'carol can neither move nor delete alice''s tabs');
select pg_temp.expect((select count(*) from public.events where user_id = :alice) = 10, 'alice''s log untouched by carol');

-- Alice cannot see Carol's ratings either; she sees her band.
select pg_temp.as_user(:alice);
select pg_temp.expect((select count(*) from public.events where user_id = :carol) = 0, 'alice cannot read carol''s ratings');
select pg_temp.expect((select public.band_overview() #>> '{members,0,note}') = 'Carol (bass)', 'alice sees carol in her band');
select pg_temp.expect((select public.band_overview() #>> '{invites,0,status}') = 'used', 'and her invite as used');
select pg_temp.expect((select public.band_overview()::text !~ 'token'), 'the overview never carries a token or its hash');
reset role;

-- Bob, another owner, can do nothing to alice's band.
select pg_temp.as_user(:bob);
select pg_temp.expect((select count(*) from public.events where user_id in (:alice, :carol)) = 0, 'bob sees nothing of alice''s or carol''s');
select pg_temp.expect((select public.band_overview()) = '{"invites":[],"members":[]}'::jsonb, 'bob''s band is his own (empty)');
select pg_temp.expect_error($$select public.remove_band_member('cccccccc-0000-0000-0000-000000000003')$$, 'bob cannot remove alice''s member');
select (x ->> 'token') as bob_carol_token from (select public.create_band_invite('Carol') as x) s \gset
reset role;
select pg_temp.as_user(:carol);
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'bob_carol_token'), 'one band at a time');
reset role;

-- Single use, expiry, revoking, and who may join.
select pg_temp.as_user(:dave);
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'carol_token'), 'an invite works once');
select pg_temp.expect_error($$select public.accept_band_invite('not-a-token')$$, 'a malformed token is refused');
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', repeat('0', 64)), 'an unknown token is refused');
reset role;
select pg_temp.as_user(:alice);
select (x ->> 'token') as old_token from (select public.create_band_invite('Dave') as x) s \gset
select (x ->> 'token') as revoked_token, (x ->> 'id') as revoked_id from (select public.create_band_invite('Dave again') as x) s \gset
select (x ->> 'token') as for_bob_token, (x ->> 'id') as for_bob_id from (select public.create_band_invite('Bob') as x) s \gset
select public.revoke_band_invite(:'revoked_id');
select pg_temp.expect_error(format('select public.revoke_band_invite(%L)', :'revoked_id'), 'an invite is revoked once');
select pg_temp.expect((select public.band_overview() -> 'invites' @> '[{"note":"Dave again","status":"revoked"}]'), 'alice sees it as revoked');
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'for_bob_token'), 'alice cannot join her own band');
reset role;
update public.band_invites set expires_at = now() - interval '1 second' where note = 'Dave'; -- a week goes by
select pg_temp.as_user(:dave);
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'old_token'), 'an expired invite does not work');
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'revoked_token'), 'a revoked invite does not work');
select pg_temp.expect((select public.band_status() ->> 'role') = 'owner', 'dave is still a normal account');
reset role;
select pg_temp.as_user(:bob);
select pg_temp.expect_error(format('select public.revoke_band_invite(%L)', :'for_bob_id'), 'bob cannot revoke alice''s invites');
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'for_bob_token'), 'an account with its own data cannot become a member');
select pg_temp.expect((select public.band_status() ->> 'role') = 'owner', 'bob stays an owner');
reset role;
select pg_temp.as_user(:alice);
select pg_temp.expect((select public.band_overview() -> 'invites' @> '[{"note":"Dave","status":"expired"},{"note":"Bob","status":"open"}]'), 'alice sees expired and open invites');
reset role;

-- Removing Carol cuts her off at once; her own data is kept until alice deletes it.
select pg_temp.as_user(:alice);
select pg_temp.expect_error($$select public.delete_band_member_data('cccccccc-0000-0000-0000-000000000003')$$, 'data is deleted only after removing the member');
select public.remove_band_member(:carol);
select pg_temp.expect((select public.band_overview() #>> '{members,0,status}') = 'removed', 'alice sees carol removed');
reset role;
select pg_temp.as_user(:carol);
select pg_temp.expect((select public.band_status()) = '{"role":"removed"}'::jsonb, 'carol''s app learns she was removed');
select pg_temp.expect((select count(*) from public.events where user_id = :alice) = 0, 'removal cuts carol off from alice''s songs at once');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'tabs') = 0, 'and from alice''s tab files');
select pg_temp.expect_error($$insert into public.events (id, event) values ('c4', '{"id":"c4","type":"review","cardId":"song-1-c","rating":"good"}')$$, 'a removed member writes nothing');
select pg_temp.expect((select count(*) from public.events where user_id = :carol) = 2, 'removing kept carol''s own ratings');
reset role;
select pg_temp.as_user(:bob);
select pg_temp.expect_error($$select public.delete_band_member_data('cccccccc-0000-0000-0000-000000000003')$$, 'only her own owner can delete a member''s data');
reset role;
select pg_temp.as_user(:alice);
select pg_temp.expect((select public.delete_band_member_data(:carol)) = 2, 'alice deletes carol''s 2 rows');
select pg_temp.expect((select public.band_overview() #>> '{members,0,data_deleted}') = 'true', 'and sees it done');
reset role;
select pg_temp.expect((select count(*) from public.events where user_id = :carol) = 0, 'carol''s data is gone from the server');
select pg_temp.expect((select count(*) from public.events where user_id = :alice) = 10, 'alice''s data untouched');

-- A new invite lets a removed member back in.
select pg_temp.as_user(:alice);
select (x ->> 'token') as rejoin_token from (select public.create_band_invite('Carol') as x) s \gset
reset role;
select pg_temp.as_user(:carol);
select public.accept_band_invite(:'rejoin_token');
select pg_temp.expect((select count(*) from public.events where user_id = :alice) = 2, 'carol rejoins and reads the songs again');
reset role;

-- Invites locked to an email (2026-11-04): a stray test account that opens
-- the link first is refused and the invite stays open for its person.
\set erin  '\'eeeeeeee-0000-0000-0000-000000000005\''
\set frank '\'ffffffff-0000-0000-0000-000000000006\''
insert into auth.users (id, email) values (:erin, 'Erin.Bass@Example.com'), (:frank, 'test-account@example.com');
update auth.users set email = 'alice@example.com' where id = :alice;
select pg_temp.as_user(:alice);
select pg_temp.expect_error($$select public.create_band_invite('Me', 'ALICE@example.com')$$, 'an owner cannot lock an invite to her own email');
select pg_temp.expect_error($$select public.create_band_invite('Erin', 'not an email')$$, 'a bad email is refused');
select (x ->> 'token') as erin_token, (x ->> 'email') as erin_email from (select public.create_band_invite('Erin (bass)', ' erin.bass@example.com ') as x) s \gset
select pg_temp.expect(:'erin_email' = 'erin.bass@example.com', 'the invite is locked to erin''s email, lowercased');
select pg_temp.expect((select public.band_overview() -> 'invites' @> '[{"note":"Erin (bass)","email":"erin.bass@example.com","status":"open"}]'), 'alice sees whom it is locked to');
select (x ->> 'token') as open_token from (select public.create_band_invite('Anyone') as x) s \gset
select pg_temp.expect((select public.band_overview() -> 'invites' @> '[{"note":"Anyone","email":null,"status":"open"}]'), 'an invite with no email is open to anyone, as before');
reset role;
select pg_temp.as_user(:frank);
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'erin_token'), 'a stray account cannot use an invite locked to another email');
select pg_temp.expect((select public.band_status() ->> 'role') = 'owner', 'the stray account did not join');
reset role;
select pg_temp.expect((select used_at is null and used_by is null from public.band_invites where email = 'erin.bass@example.com'), 'the refused attempt left the invite unused');
select pg_temp.as_user(:erin);
select pg_temp.expect((select public.accept_band_invite(:'erin_token') ->> 'owner_id') = :alice, 'erin (her email in another case) joins with the locked invite');
reset role;
select pg_temp.as_user(:frank);
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'erin_token'), 'and it is used up');
reset role;
select pg_temp.as_user(:alice);
select pg_temp.expect((select public.band_overview() -> 'members' @> jsonb_build_array(jsonb_build_object('member_id', :erin, 'note', 'Erin (bass)', 'status', 'active'))), 'alice sees erin in her band');
select pg_temp.expect(not (select public.band_overview() -> 'members' @> jsonb_build_array(jsonb_build_object('member_id', :frank))), 'and not the stray account');
reset role;

-- Signed out: none of it.
set role anon;
select pg_temp.expect_error($$select public.band_status()$$, 'anon has no band status');
select pg_temp.expect_error($$select public.create_band_invite('x')$$, 'anon cannot invite');
select pg_temp.expect_error(format('select public.accept_band_invite(%L)', :'for_bob_token'), 'anon cannot join');
reset role;
select pg_temp.expect(not has_table_privilege('service_role', 'public.band_invites', 'SELECT') and not has_table_privilege('service_role', 'public.band_members', 'SELECT'), 'the reminder sender reads no band data');

-- --------------------------------------------------------- account deletion
delete from auth.users where id = :alice;
select pg_temp.expect((select count(*) from public.events where user_id = :alice) = 0, 'deleting the account deletes the log');
select pg_temp.expect((select count(*) from public.nudges where user_id = :alice) = 0, 'and reminders');
select pg_temp.expect((select count(*) from public.events where user_id = :bob) = 1, 'bob untouched');
-- Storage files do not cascade with the account (Supabase behaviour): the
-- pre-customer checklist covers removing the folder on account deletion.
select pg_temp.expect((select count(*) from storage.objects where name like 'aaaaaaaa-0000-0000-0000-000000000001/%') = 4, 'takes and tabs outlive the account: cleanup needed (docs/SETUP.md)');
-- Band (2026-11-03): alice's invites go with her account; carol keeps her
-- account but no access (her membership keeps no owner).
select pg_temp.expect((select count(*) from public.band_invites where owner_id = :alice) = 0, 'deleting the owner deletes her invites');
select pg_temp.expect((select owner_id is null from public.band_members where member_id = :carol), 'carol''s membership keeps no owner');
select pg_temp.as_user(:carol);
select pg_temp.expect((select public.band_status()) = '{"role":"removed"}'::jsonb, 'carol''s app shows access removed');
select pg_temp.expect_error($$insert into public.events (id, event) values ('c5', '{"id":"c5","type":"review","cardId":"song-1-c","rating":"good"}')$$, 'and she writes nothing');
reset role;
delete from auth.users where id = :carol;
select pg_temp.expect((select count(*) from public.band_members where member_id = :carol) = 0, 'deleting a member deletes his membership');

