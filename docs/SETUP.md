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
4. Check: **Table Editor** shows `events`, `nudges`, `push_subscriptions`, each with RLS enabled.

## 3. Sign-in by email code

On iPhone, a sign-in *link* opens Safari, not the Home Screen app, so the app uses a 6-digit *code* typed into the app.

1. **Authentication**, then **Sign In / Providers** (or **Providers**): make sure **Email** is enabled.
2. **Authentication**, **Emails** (or **Email Templates**). In both the **Magic Link** and **Confirm signup** templates, add this line near the top and save:
   `Your sign-in code: {{ .Token }}`
3. Supabase's built-in email sends only a few messages per hour. Fine for tonight; set up your own email sender before customers.

## 4. Put the app on Vercel (first deploy)

1. vercel.com, sign in with GitHub, **Add New**, **Project**, import `bpz82/zuniga_guitar`.
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

## Before real customers

- Remove `setup-keys.html` from the public site (or keep keys made only once and delete the page).
- Paid Supabase plan (free projects pause after about a week of low activity) and a real email sender.
- Self-service account deletion.

## Appendix: command-line route for step 7

With Node 22+ on any computer, in a copy of the repo: `npx supabase login` (approve in the browser), `npx supabase link --project-ref YOUR-PROJECT-REF`, then `npx supabase functions deploy send-nudges --no-verify-jwt`. Keys can also be made with `node scripts/vapid-keys.mjs`.

## If `vendor/ts-fsrs` files go missing

`npm test` and `npm run build` check them first and stop with the fix: `git checkout -- vendor/ts-fsrs`.
