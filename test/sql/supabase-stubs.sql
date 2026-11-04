-- Minimal stand-ins for what Supabase provides, so the migration can be
-- tested on plain Postgres: the auth schema, auth.uid() and the API roles.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
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

-- Supabase Storage, reduced to what the takes migration uses: buckets,
-- objects (RLS on, broad grants as Supabase gives the API roles, so the
-- policies are the guard), and storage.foldername().
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
