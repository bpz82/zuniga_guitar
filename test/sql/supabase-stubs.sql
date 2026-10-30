-- Minimal stand-ins for what Supabase provides, so the migration can be
-- tested on plain Postgres: the auth schema, auth.uid() and the API roles.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase's default privileges for the API roles on new public tables.
-- service_role gets NO default table rights here: on the live project the
-- reminder sender failed with "permission denied for table nudges" until it
-- was granted explicitly (2026-10-30), so tests must not assume them.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
