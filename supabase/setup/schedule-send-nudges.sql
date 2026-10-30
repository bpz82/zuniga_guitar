-- Run once in the Supabase SQL Editor, AFTER the migration and AFTER the
-- send-nudges function is deployed. See docs/SETUP.md, step 7.
--
-- Before running: replace the two placeholders below IN THE SQL EDITOR
-- ONLY. Never paste the real values into a chat, a file, or GitHub.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets live in Supabase Vault, not in this SQL.
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'zg_project_url');
select vault.create_secret('PASTE-CRON_SECRET-HERE', 'zg_cron_secret');

-- Every minute: ask the function to send whatever reminders are due.
select cron.schedule(
  'zg-send-nudges',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'zg_project_url') || '/functions/v1/send-nudges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'zg_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To stop reminders entirely:  select cron.unschedule('zg-send-nudges');
