// Supabase Edge Function (Deno). Called every minute by pg_cron (see
// docs/SETUP.md). All logic lives in ../_shared, which is unit-tested.
import { sendDueNudges } from '../_shared/send-nudges.ts';
import { restDb } from '../_shared/rest-db.ts';

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing secret ${name}`);
  return v;
};

/** Constant-time comparison, so the cron secret can't be guessed by timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !same(req.headers.get('x-cron-secret') ?? '', env('CRON_SECRET'))) {
    return new Response('forbidden', { status: 403 });
  }
  const secretKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY');
  const report = await sendDueNudges({
    db: restDb(env('SUPABASE_URL'), secretKey, fetch),
    vapid: { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') },
    now: Date.now(),
    fetch,
  });
  return Response.json(report);
});
