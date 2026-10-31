-- Recorder takes (Blake, 2026-10-31): audio files in a PRIVATE Storage
-- bucket, one folder per user named by their user id. Row-level security:
--   - a signed-in user can add files to their own folder only, with a fixed
--     name shape ("<user id>/take-<id>.<ext>");
--   - a user can read files in their own folder only;
--   - nobody can overwrite, rename or delete a take (no update or delete
--     policy): the app archives takes, it never deletes them.
-- The app never holds a secret key; these policies are the only guard.
--
-- Note: deleting a user in Supabase Auth does NOT delete their Storage
-- files. Account deletion must also remove the user's folder (pre-customer
-- checklist in docs/SETUP.md).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('takes', 'takes', false, 52428800, array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "zg takes: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "zg takes: add own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'takes'
    and name ~ ('^' || (select auth.uid())::text || '/take-[A-Za-z0-9-]{1,40}\.(webm|m4a|ogg|mp3|aac)$')
  );
-- No update or delete policy on purpose.
