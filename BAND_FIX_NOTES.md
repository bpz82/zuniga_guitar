# Band invite fix: test account blocking the real band mate (2026-11-04)

## What went wrong

An invite link was a single-use bearer token: **whichever account used it first
became the band member**, and the invite was then marked used. When the test
account (`bpz82bear@gmail.com`) signed up through an invite link, it used that
invite up. When the real band mate opened the same link, the server answered
"This invite was already used. Ask for a new link.", the app signed him out
again, and he could not get in.

There is no one-member limit, and the owner account was not turned into a member
(the server refuses an owner's own invite). The only problem was the invite being
used by the wrong account.

A second thing can block the band mate. If he ever signed in **without** an
invite link, that made a normal (owner) account for his email, and the app saved
starter data to it. After that, any invite for that email is refused with
"Invites are for new accounts…". Step 3 below shows how to check for this.

## What the code change does

- New migration `supabase/migrations/20261104120000_band_invite_email.sql`. An
  invite can be locked to one email. Only an account signed in with that email
  can use it. Any other account is refused **before** the invite is touched, so
  the invite stays open for the right person. Invites without an email work as
  they did before.
- In the app: if you type an email address in **Who it's for** (for example
  `Mike (bass) mike@example.com`), the invite is locked to that email. The page
  layout and text are unchanged.
- Tests: `test/band.test.ts` (app side) and `test/sql/rls.test.sql` (server rules;
  run with `npm run test:sql` on a machine that has Postgres).

## Cleanup steps (nothing gets deleted)

Do these in order. None of them deletes an account or any data.

1. **Apply the migration.** In the Supabase dashboard, open SQL Editor and run the
   contents of `supabase/migrations/20261104120000_band_invite_email.sql` once.
   Then deploy the app as usual so it includes the new `src/band.ts`.

2. **Take the test account out of the band.** In the app, signed in as Blake, go
   to Settings, Band, Band members. Find the member who joined through the test
   (`bpz82bear@gmail.com`) and tap **Remove**. Do **not** tap
   "Delete their data". The account and its ratings stay on the server; it just
   loses access. If you can't tell which row is the test account, run this
   read-only query in SQL Editor:

   ```sql
   select m.member_id, u.email, m.note, m.status, m.joined_at
   from public.band_members m join auth.users u on u.id = m.member_id
   where m.owner_id = (select id from auth.users where email = 'bpzuniga82@gmail.com');
   ```

3. **Check the band mate's email** (read only). Replace the placeholder with his
   address:

   ```sql
   select u.id, u.email, u.created_at,
          (select count(*) from public.events e where e.user_id = u.id) as events,
          exists (select 1 from public.band_members b where b.member_id = u.id) as is_member
   from auth.users u where lower(u.email) = lower('BANDMATE_EMAIL_HERE');
   ```

   - **No row:** he has no account yet. Go to step 4.
   - **A row with `events` = 0 and `is_member` = false:** an empty account. The
     invite will work. Go to step 4.
   - **A row with `events` > 0 and `is_member` = false:** he signed in once
     without an invite, so his email is now a normal account and the server
     won't let it join. Don't delete it. Have him use a different email
     address (for example a `+band` Gmail alias such as `name+band@gmail.com`)
     and put that address in the invite in step 4.

4. **Make a new, locked invite.** Settings, Band, **Who it's for**: type his name
   and his email, for example `Mike (bass) mike@example.com`. Tap
   **Make an invite link**. The confirmation should say
   "Invite link made for mike@example.com…". You can **Revoke** any older open
   invites in the list. Revoking only cancels them; nothing is deleted.

5. **Send him the link.** He should open it on his phone while signed out, then
   sign in with **that same email** and enter the code from the email. If someone
   else opens the link first, they are refused and the invite stays open for him.

6. **Testing yourself from now on:** make a separate invite locked to the test
   email (`bpz82bear@gmail.com`). Never use the band mate's link for a test.
