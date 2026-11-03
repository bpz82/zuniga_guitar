# Setup: Supabase, Vercel and push reminders (browser only)

Everything below is done in a web browser: no terminal needed. About 45 minutes, once. Free tier.

**The one rule: no key, password or secret ever goes into a chat, an email, a GitHub file or the app.** Secrets go only into the Supabase dashboard and a password manager.

Dashboards change now and then. If a menu name differs slightly, use the nearest match.

## What you need before starting

- A GitHub account with access to `bpz82/zuniga_guitar` (main must be at the commit with this file).
- An email address to put on push messages as the contact (`VAPID_SUBJECT`), e.g. a support address.
- Blake's iPhone on **iOS 16.4 or newer** (needed for push to Home Screen apps).

| Value | Public or secret | Where it goes |
|---|---|---|
| Supabase project URL | Public | Vercel variable, schedule SQL |
| Supabase publishable key (may be labeled "anon public") | Public | Vercel variable |
| VAPID public key | Public | Vercel variable, Supabase function secret |
| VAPID private key | **Secret** | Supabase function secret only |
| Cron secret | **Secret** | Supabase function secret, schedule SQL (in the editor) |
| Database password | **Secret** | Password manager only |
| Supabase secret / service-role key | **Secret** | Nowhere: Supabase gives it to the function itself |

## 1. Create the Supabase project

1. supabase.com, sign in with GitHub, **New project**. Name `zuniga-guitar`, region **US East**.
2. Database password: **Generate a password** and save it in the password manager. Nothing below needs it.
3. Wait until the project is ready.

## 2. Create the tables

1. **SQL Editor**, **New query**.
2. On GitHub, open `supabase/migrations/20261030000000_init.sql`, click **Raw**, select all, copy, paste into the editor.
3. **Run**. Expect "Success. No rows returned."
4. Do the same with every later file in `supabase/migrations/`, in name order. Today that is `20261030232900_service_role_grants.sql`: without it the reminder sender fails with "permission denied for table nudges". (Already applied by hand on the live project on 2026-10-30; running it again is harmless.) Then `20261031180000_takes_storage.sql`: the private `takes` bucket for recordings and its security rules (needed before takes can back up; until then they stay on the device and sync says why). Then `20261102120000_tabs_storage.sql`: the private `tabs` bucket for song tabs and its security rules (the same rules as takes: each user adds and reads in their own folder only; no overwrite, no delete). Until it is applied, tabs stay on the device and sync reports them as waiting. Then `20261103120000_band_members.sql` (2026-11-03): band members. It adds the `band_invites` and `band_members` tables, the functions the app calls to invite, join, remove and delete (`band_status`, `create_band_invite`, `revoke_band_invite`, `accept_band_invite`, `band_overview`, `remove_band_member`, `delete_band_member_data`), and the security rules: a band member reads only his owner's song items, song cards and tab files, writes only his own ratings and settings, uploads nothing, plans no reminders, and loses all of it the moment he is removed. It also replaces `save_push_subscription` with the same function plus a refusal for band members. Until it is applied, the app works exactly as before (every account is an owner), and making an invite says the server is missing the function.
5. Check: **Table Editor** shows `events`, `nudges`, `push_subscriptions`, `band_invites`, `band_members`, each with RLS enabled. (The two band tables have RLS on and no policies on purpose: the app reaches them only through the functions above.)

## 3. Sign-in by email code

On iPhone, a sign-in *link* opens Safari, not the Home Screen app, so the app uses a 6-digit *code* typed into the app.

1. **Authentication**, then **Sign In / Providers** (or **Providers**): make sure **Email** is enabled.
2. **Authentication**, **Emails** (or **Email Templates**). In both the **Magic Link** and **Confirm signup** templates, add this line near the top and save:
   `Your sign-in code: {{ .Token }}`
3. The code length is a project setting. **On the live project it is 8 digits**; the app accepts 6 to 10, so nothing needs changing.
4. Supabase's built-in email sends only a few messages per hour. The live project sends through Gmail SMTP instead (see Troubleshooting if codes stop arriving). Use a real email service before customers.

## 4. Put the app on Vercel (first deploy)

1. vercel.com, sign in with GitHub, **Add New**, **Project**, import `bpz82/zuniga_guitar`. The live Vercel project is named **`zuniga_guitar`**.
2. Framework preset **Other**. Leave build settings alone (`vercel.json` sets them). **Deploy**.
3. Note the address, e.g. `https://zuniga-guitar.vercel.app`. Below, this is **APP**.
4. Supabase: **Authentication**, **URL Configuration**: **Site URL** = APP; add APP under **Redirect URLs**.

## 5. Make the push keys (in the browser)

1. Open **APP/setup-keys.html**. It makes three values inside the browser and sends nothing anywhere.
2. Copy each into the password manager: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
3. Close the tab. (Reloading it makes different keys; use only the saved ones from now on.)

## 6. Store the function secrets

Supabase: **Edge Functions**, **Secrets** (sometimes under **Project Settings**). Add:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`: `mailto:` plus the contact email, e.g. `mailto:support@example.com`
- `CRON_SECRET`

## 7. Deploy the reminder sender (dashboard editor)

1. Supabase: **Edge Functions**, **Deploy a new function**, **Via Editor**.
2. Name it exactly `send-nudges`.
3. On GitHub, open `supabase/dashboard/send-nudges.ts`, **Raw**, copy everything, and replace all the code in the editor with it.
4. **Deploy**.
5. Open the function's **Details** or **Settings** and turn **off** "Verify JWT" / "Enforce JWT verification", then save. (The schedule, not a user, calls it; it refuses any call without the cron secret.)
6. Check: calling it from **Test** without the `x-cron-secret` header returns **403 forbidden**. That is correct.

If the dashboard has no editor option, use the command-line route in the appendix.

## 8. Turn on the every-minute schedule

1. **Database**, **Extensions**: enable `pg_cron` and `pg_net`.
2. **SQL Editor**, **New query**: paste `supabase/setup/schedule-send-nudges.sql` (from GitHub, **Raw**).
3. In the editor only: replace `YOUR-PROJECT-REF` with the project ref (the part of the project URL before `.supabase.co`) and `PASTE-CRON_SECRET-HERE` with the cron secret.
4. **Run**. Close the tab without saving the query.
5. Check: **Integrations**, **Cron** (or **Database**, **Cron Jobs**) shows `zg-send-nudges`, every minute, succeeding. **Edge Functions**, `send-nudges`, **Logs** shows calls answered 200.

## 9. Build the connection into the app

1. Supabase **Project Settings**, **API** (or **API Keys**): copy the **Project URL** and the **publishable** key. Never the secret / service-role key; the build refuses it anyway.
2. Vercel: the project, **Settings**, **Environment Variables**. Add for Production:
   - `ZG_SUPABASE_URL` = Project URL
   - `ZG_SUPABASE_PUBLISHABLE_KEY` = publishable key
   - `ZG_VAPID_PUBLIC_KEY` = VAPID public key
3. **Deployments**, latest, **Redeploy**.
4. Check: the build log ends with `built-in: supabaseUrl, publishableKey, vapidPublicKey`, and APP no longer shows the connection fields.

## 10. Blake's iPhone

1. Open **APP** in **Safari**.
2. **Share**, **Add to Home Screen**, **Add**.
3. Open the app **from the new icon** (not Safari) and do everything below there.
4. **Account and sync**: enter your email, **Email me a sign-in code**, type the code from the email, **Sign in**.
5. **Settings**: replace the box with your schedule and **Save settings**:

```json
{
  "desiredRetention": 0.9,
  "dayStart": { "timeZone": "America/New_York", "hour": 3 },
  "quietHours": { "start": "10:30", "end": "16:00" },
  "morningMinutes": 60,
  "notifications": true,
  "windows": [
    { "id": "morning", "start": "04:00" },
    { "id": "before-work", "start": "09:45" },
    { "id": "during-work", "start": "13:00" },
    { "id": "after-work", "start": "16:30" }
  ]
}
```

6. **Notifications**: **Allow notifications on this device**, then **Allow** on the iPhone prompt. The status line says "Notifications on for this device."

Laptop: open APP in Chrome, Edge or Safari, sign in with a code, **Allow notifications on this device**.

## 11. Test a reminder tonight

1. In **Settings**, change one window's `start` to about 4 minutes from now (New York time) and save. Saving syncs and plans reminders.
2. Supabase **Table Editor**, `nudges`: a row for that time appears.
3. Lock the phone. At that minute the notification arrives; afterward the row has a `sent_at` time.
4. Put the window back and save.

If nothing arrives: check `push_subscriptions` has a row for the phone, the function's **Logs** for the minute, and that **Settings** shows `"notifications": true`.

## Troubleshooting

**Sign-in codes stop arriving.** Supabase **Authentication**, **Logs** shows `535 BadCredentials` on `POST /otp`.
Cause: the project sends email through Gmail SMTP with a Google *app password*, and Google deletes all app passwords when 2-Step Verification is turned off on that Google account.
Fix: turn 2-Step Verification back on, create a new app password (Google Account, **Security**, **App passwords**), save it in the password manager, and paste it into Supabase **Authentication**, **Emails**, **SMTP Settings**, **Password**. Never into a chat. Then request a new code.

**Reminders fail with "permission denied for table nudges".** The grants migration is missing; run `supabase/migrations/20261030232900_service_role_grants.sql` (step 2).

## Before real customers (checklist)

- [ ] **TODO: remove `setup-keys.html` before shipping to customers.** It is a one-time setup tool and should not be on a customer-facing site. Not deleted yet: it stays until Blake approves its removal. File: `harness/static/setup-keys.html`.
- [ ] Paid Supabase plan (free projects pause after about a week of low activity).
- [ ] A real email service instead of Gmail SMTP (sending limits; the app-password failure above).
- [ ] Self-service account deletion.
- [ ] **Account deletion must also delete the user's takes and tabs folders in Storage.** Supabase does not remove Storage files when an Auth user is deleted, so a user's recordings and tabs would outlive their account (shown in `test/sql/rls.test.sql`). Needs a small server function (service role) that removes `takes/<user id>/` and `tabs/<user id>/` before deleting the user.
- [ ] **Account deletion and band members** (`20261103120000_band_members.sql`). What already happens by itself, and is tested in `test/sql/rls.test.sql`:
  - Deleting an **owner** (Blake) deletes his invites (cascade). His band members keep their own accounts and their own ratings, but lose all access at once (their membership keeps no owner; the app shows "access removed"). His `tabs/<owner id>/` folder still has to be removed by hand or by the function above, as for any account.
  - Deleting a **band member** deletes his membership and his own rows of the log (his ratings and settings) by cascade. A band member has nothing in Storage: the rules let him upload nothing.
  - Deleting a member's **data** without deleting his account is in the app: Blake removes him in Settings, Band, then **Delete their data**, and confirms. Only his owner can, and only after removing him (`delete_band_member_data`). It is the one delete path on the log, and it reaches only that member's rows.
  - Still to decide before customers: whether deleting an owner should also delete his band members' accounts (today they stay, with no access). Self-service account deletion (above) must cover both roles.
- [ ] Band invite links carry a single-use token (7 days). The token is stored only as a SHA-256 hash on the server. On the invited person's device it sits in local storage from opening the link until sign-in, then it is used and dropped (or dropped if refused).

## Appendix: command-line route for step 7

With Node 22+ on any computer, in a copy of the repo: `npx supabase login` (approve in the browser), `npx supabase link --project-ref YOUR-PROJECT-REF`, then `npx supabase functions deploy send-nudges --no-verify-jwt`. Keys can also be made with `node scripts/vapid-keys.mjs`.

## If `vendor/ts-fsrs` files go missing

`npm test` and `npm run build` check them first and stop with the fix: `git checkout -- vendor/ts-fsrs`.
