-- The reminder sender (Edge Function send-nudges) runs as service_role.
-- On the live project it failed with "permission denied for table nudges":
-- service_role had no table rights there. These are the grants applied live
-- on 2026-10-30, and exactly what supabase/functions/_shared/rest-db.ts uses:
--   nudges:             read due reminders, mark them sent
--   push_subscriptions: read devices, drop expired ones
-- service_role gets nothing on events: the sender never reads practice data.
grant select, update on public.nudges to service_role;
grant select, delete on public.push_subscriptions to service_role;
