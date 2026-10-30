# Setup: Supabase, Vercel and push reminders

For Blake. About 45 minutes, once. Everything here is free-tier.

**The one rule: no key, password or secret ever goes into a chat, an email, a GitHub file or the app.** Secrets go only into the Supabase dashboard and your password manager. Where a step shows a value, it appears on your own screen.

Supabase's dashboard changes now and then. If a menu name below differs slightly, look for the nearest match.

## What you will have at the end

| Thing | Public or secret | Where it lives |
|---|---|---|
| Supabase project URL | Public | App settings, Vault |
| Supabase publishable key (older projects: "anon" key) | Public | App settings |
| Supabase secret / service-role key | **Secret** | Nowhere you type it: Supabase gives it to the function automatically |
| Database password | **Secret** | Your password manager only |
| VAPID public key | Public | App settings, function secrets |
| VAPID private key | **Secret** | Function secrets only |
| Cron secret | **Secret** | Function secrets and Vault only |

## 1. Create the Supabase project

1. Go to supabase.com and sign in with GitHub.
2. **New project**. Name: `zuniga-guitar`. Choose the region nearest your users (US East for you).
3. It asks for a database password: use **Generate a password**, then save it in your password manager. You will not need it for anything below.
4. Wait for the project to finish setting up.

## 2. Create the database tables

1. In the project, open **SQL Editor**, then **New query**.
2. Open `supabase/migrations/20261030000000_init.sql` from the repo on GitHub, copy all of it, and paste it into the editor.
3. Click **Run**. It should say "Success. No rows returned."
4. Check: **Table Editor** now shows `events`, `nudges` and `push_subscriptions`, each marked with RLS enabled.

## 3. Make your keys (on your own computer)

1. On your computer, in a copy of the repo, run: `node scripts/vapid-keys.mjs` (Node 22 or newer).
2. It prints three values: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
3. Save all three in your password manager now. Close the terminal afterward.

No Node on your computer? Tell me and I'll give you another way; do not paste the keys anywhere to get help.

## 4. Store the function secrets

1. In Supabase: **Edge Functions**, then **Secrets** (sometimes under Project Settings).
2. Add four secrets, copying values from your password manager:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`: `mailto:` plus a support email you read, e.g. `mailto:support@yourdomain.com`
   - `CRON_SECRET`
3. Supabase already provides the project URL and its secret key to functions; you do not add those.

## 5. Deploy the reminder sender

This uses the Supabase command-line tool through `npx`, so nothing permanent is installed. In the repo folder on your computer:

1. `npx supabase login`: a browser window opens; approve it there. Nothing to paste.
2. `npx supabase link --project-ref YOUR-PROJECT-REF`: the ref is the part of your project URL before `.supabase.co`. If it asks for the database password, paste it from your password manager into the terminal (not a chat).
3. `npx supabase functions deploy send-nudges --no-verify-jwt`
4. Check: **Edge Functions** in the dashboard lists `send-nudges`.

`--no-verify-jwt` is correct here: the scheduler, not a user, calls this function, and it refuses any call without the cron secret.

## 6. Put the app on Vercel

1. Go to vercel.com, sign in with GitHub, **Add New**, then **Project**, and import `bpz82/zuniga_guitar`.
2. Framework preset: **Other**. Leave build settings alone; `vercel.json` sets them.
3. **Deploy**. Note the address it gives you, e.g. `https://zuniga-guitar.vercel.app`.
4. Back in Supabase: **Authentication**, then **URL Configuration**. Set **Site URL** to that address and add it under **Redirect URLs**. This is what makes the email sign-in link come back to the app.

## 7. Turn on the every-minute schedule

1. Supabase: **Database**, then **Extensions**. Enable `pg_cron` and `pg_net`.
2. **SQL Editor**, **New query**. Paste `supabase/setup/schedule-send-nudges.sql`.
3. In the editor only, replace `YOUR-PROJECT-REF` with your ref, and `PASTE-CRON_SECRET-HERE` with the cron secret from your password manager.
4. **Run**. Then close the query tab without saving it.
5. Check: **Integrations** (or **Database**), then **Cron**, shows `zg-send-nudges` running every minute.

## 8. Connect the app

1. Open your Vercel address.
2. In **Account and sync**, enter:
   - Supabase project URL (Supabase: **Project Settings**, **API**)
   - Publishable key (same page; may be labeled "anon public"). The app refuses anything that looks like a secret key.
   - VAPID public key
3. **Save connection**, enter your email, **Email me a sign-in link**, and open the link on the same device.
4. **Sync now**. The status line should say "Synced".

## 9. Your own schedule

In **Settings**, press **Use this device's time zone**, then replace the settings box with your schedule and **Save settings**:

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

## 10. Notifications on your iPhone and laptop

**iPhone** (iOS only allows push for apps on the Home Screen):
1. Open the Vercel address in **Safari**.
2. **Share**, then **Add to Home Screen**.
3. Open the app **from the new icon**, sign in again if asked.
4. Tap **Allow notifications on this device**, then **Allow**.

**Laptop**: open the address in Chrome, Edge, Firefox or Safari, sign in, tap **Allow notifications on this device**.

Each device must do this once. Turning a window's toggle off, or the master switch, takes effect at the next sync.

## 11. Check it end to end

1. In **Settings**, set one window's start to 3 or 4 minutes from now and save.
2. Supabase **Table Editor**, `nudges`: a row for that time appears.
3. At that minute a notification arrives. Afterward the row has a `sent_at` time.
4. Put the window back.

## Before real customers

- **Free projects pause** after about a week of low activity, and the free plan has hard limits. Before customers depend on it, move the project to a paid plan. That is a cost decision for you.
- **Account deletion:** deleting a user in Supabase **Authentication** removes all their data (tested). There is no self-service "delete my account" button yet.
- **Export:** the harness's **Export my data** downloads the user's whole log; **Restore** brings it back.
