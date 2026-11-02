-- Song tabs (Blake, 2026-11-02): one file per song (a PDF, a picture or
-- plain text) in a PRIVATE Storage bucket, one folder per user named by
-- their user id. The same rules as takes (20261031180000_takes_storage.sql):
--   - a signed-in user can add files to their own folder only, with a fixed
--     name shape ("<user id>/tab-<id>.<ext>");
--   - a user can read files in their own folder only;
--   - nobody can overwrite, rename or delete a tab (no update or delete
--     policy): replacing a song's tab adds a new file, it never deletes.
-- The app never holds a secret key; these policies are the only guard.
--
-- Note: deleting a user in Supabase Auth does NOT delete their Storage
-- files. Account deletion must also remove the user's folders in both
-- buckets (pre-customer checklist in docs/SETUP.md).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tabs', 'tabs', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "zg tabs: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'tabs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "zg tabs: add own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tabs'
    and name ~ ('^' || (select auth.uid())::text || '/tab-[A-Za-z0-9-]{1,40}\.(pdf|png|jpg|webp|gif|txt)$')
  );
-- No update or delete policy on purpose.
