/**
 * NudgeDb over Supabase's REST API (PostgREST) with plain fetch: no client
 * library. Uses the server-only secret key, which bypasses row-level
 * security, so this file must only ever run inside the Edge Function.
 */
import type { DueNudge, NudgeDb } from './send-nudges.ts';
import type { Subscription } from './webpush.ts';

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export function restDb(projectUrl: string, secretKey: string, fetchFn: Fetch): NudgeDb {
  const base = `${projectUrl.replace(/\/$/, '')}/rest/v1`;
  const headers: Record<string, string> = { apikey: secretKey, 'Content-Type': 'application/json' };
  // Legacy service-role keys are JWTs and also go in Authorization; new sb_secret_ keys go in apikey only.
  if (secretKey.startsWith('eyJ')) headers.Authorization = `Bearer ${secretKey}`;

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetchFn(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
    if (!res.ok) throw new Error(`Supabase REST ${res.status}: ${await res.text()}`);
    return res;
  };
  const list = (values: readonly (string | number)[]) => `(${values.map((v) => encodeURIComponent(String(v))).join(',')})`;

  return {
    async dueNudges(now) {
      const q = `select=id,user_id,window_id,silent,at&sent_at=is.null&at=lte.${encodeURIComponent(now.toISOString())}&order=at.asc&limit=1000`;
      return (await (await call(`/nudges?${q}`)).json()) as DueNudge[];
    },
    async subscriptions(userIds) {
      if (userIds.length === 0) return [];
      const q = `select=user_id,endpoint,p256dh,auth&user_id=in.${list(userIds)}`;
      return (await (await call(`/push_subscriptions?${q}`)).json()) as (Subscription & { user_id: string })[];
    },
    async markSent(ids, now) {
      if (ids.length === 0) return;
      await call(`/nudges?id=in.${list(ids)}`, { method: 'PATCH', body: JSON.stringify({ sent_at: now.toISOString() }), headers: { Prefer: 'return=minimal' } });
    },
    async dropSubscription(endpoint) {
      await call(`/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    },
  };
}
