/**
 * Bare functional test harness. Not the product UI: no design, just every
 * engine feature reachable so it can be tested on a real phone and laptop.
 * Works offline with no account; connecting Supabase adds sign-in, sync and
 * push reminders. The values it asks for (project URL, publishable key,
 * VAPID public key) are public by design; no secret ever goes in the app.
 */
import {
  changeSettings,
  createHost,
  planNudges,
  prompt,
  Replica,
  runModule,
  seedTestDeck,
  sessionFor,
  supabaseRemote,
  TEST_DECK,
  toggleNotifications,
  toggleWindowNotify,
  uploadNudges,
} from '../src/index.ts';
import type { EventBody, ModuleHost, Rating, SupabaseLike, Validation, WindowId } from '../src/index.ts';
import { indexedDbStore } from '../src/stores/indexeddb.ts';

interface Config {
  supabaseUrl?: string;
  publishableKey?: string;
  vapidPublicKey?: string;
}
type Client = SupabaseLike & {
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string; email?: string } } | null } }>;
    signInWithOtp(a: { email: string; options: { emailRedirectTo: string } }): Promise<{ error: { message: string } | null }>;
    verifyOtp(a: { email: string; token: string; type: 'email' }): Promise<{ error: { message: string } | null }>;
    signOut(): Promise<unknown>;
  };
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const deviceId = read<string>('zg-device', '') || (localStorage.setItem('zg-device', JSON.stringify(crypto.randomUUID())), read('zg-device', ''));
/** Public connection settings baked in at build time (Vercel env), if any. */
declare const __ZG_CONFIG__: Config;
const BUILT_IN: Config = typeof __ZG_CONFIG__ === 'object' ? __ZG_CONFIG__ : {};
const builtIn = Boolean(BUILT_IN.supabaseUrl && BUILT_IN.publishableKey);
let config: Config = builtIn ? BUILT_IN : read<Config>('zg-config', {});
let client: Client | null = null;
let userId = 'local';
let replica!: Replica;
let deck!: ModuleHost;
let revealed = false;

function say(text: string) {
  $('status').textContent = `${new Date().toLocaleTimeString()} ${text}`;
}

async function record(r: Validation<EventBody>) {
  if (!r.ok) return say(`Refused: ${r.error}`);
  await replica.record(r.value);
  await afterChange();
}

async function afterChange() {
  render();
  if (client) await syncNow().catch((e) => say(`Saved here; sync failed (${(e as Error).message}). Will retry.`));
}

/** supabase-js, loaded only when the harness is connected. The real app bundles it instead. */
async function supabaseClient(): Promise<Client> {
  const lib = 'https://esm.sh/@supabase/supabase-js@2';
  const { createClient } = (await import(/* @vite-ignore */ lib)) as { createClient(u: string, k: string): Client };
  return createClient(config.supabaseUrl!, config.publishableKey!);
}

async function connect() {
  if (!config.supabaseUrl || !config.publishableKey) return;
  client = await supabaseClient();
  const { data } = await client.auth.getSession();
  if (data.session) userId = data.session.user.id;
  $('account').textContent = data.session ? `Signed in as ${data.session.user.email ?? userId}` : 'Not signed in';
  if (!data.session) client = null; // sync needs a signed-in user
}

async function syncNow() {
  if (!client) return say('Not connected');
  const report = await replica.sync(supabaseRemote(client));
  await uploadNudges(client, planNudges(replica.library, Date.now()));
  say(`Synced: sent ${report.pushed}, received ${report.pulled}${report.rejected.length ? `, ${report.rejected.length} bad rows set aside` : ''}`);
  render();
}

function render() {
  const lib = replica.library;
  const now = Date.now();
  const s = sessionFor(lib, now);
  $('session').textContent =
    `${s.date} · ${s.windowId ?? 'no window'} · ${s.mode}${s.quiet ? ' (quiet hours)' : ''} · ${s.minMinutes}–${s.minutes} min` +
    ` · ${replica.pendingCount} waiting to sync`;

  const review = s.segments.find((x) => x.kind === 'review');
  const next = review && review.kind === 'review' ? (review.due[0]?.memory.cardId ?? review.fresh[0]) : undefined;
  const card = next ? lib.cards.get(next) : undefined;
  const item = card ? lib.items.get(card.itemId) : undefined;
  if (card && item) {
    const q = card.itemId.startsWith('td-') ? prompt(card, item) : { question: `${card.template}: ${JSON.stringify(item.fields)}`, answer: '' };
    $('question').textContent = q.question;
    $('answer').textContent = revealed ? q.answer : '';
    $('card').dataset.card = card.id;
    $('rate').hidden = !revealed;
    $('reveal').hidden = revealed;
  } else {
    $('question').textContent = s.empty ? 'Nothing to do right now.' : 'No cards for this session.';
    $('answer').textContent = '';
    $('rate').hidden = $('reveal').hidden = true;
  }

  $('blocks').replaceChildren(
    ...s.segments.flatMap((seg) => {
      if (seg.kind !== 'block') return [];
      const li = document.createElement('li');
      const b = seg.block;
      li.textContent = `${b.label} · ${b.minutes} min ${seg.done ? '✓' : ''}`;
      if (!seg.done) {
        const btn = document.createElement('button');
        btn.textContent = 'Done';
        btn.onclick = () =>
          record({
            ok: true,
            value:
              b.kind === 'feel-session'
                ? { type: 'feel-session', goalId: b.goalId, durationMs: b.minutes * 60_000, note: prompt_('How did it feel?') }
                : { type: 'task-done', goalId: b.goalId, blockId: b.blockId, durationMs: b.minutes * 60_000 },
          });
        li.append(' ', btn);
      }
      return [li];
    }),
  );

  ($('settings') as HTMLTextAreaElement).value = JSON.stringify(lib.settings, null, 2);
  ($('notify-all') as HTMLInputElement).checked = lib.settings.notifications;
  $('notify-windows').replaceChildren(
    ...lib.settings.windows.map((w) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = w.notify !== false;
      box.onchange = () => record(toggleWindowNotify(replica.library, w.id as WindowId, box.checked));
      label.append(box, ` ${w.id} at ${w.start}`);
      return label;
    }),
  );
  $('connection').hidden = builtIn;
  ($('cfg-url') as HTMLInputElement).value = config.supabaseUrl ?? '';
  ($('cfg-key') as HTMLInputElement).value = config.publishableKey ?? '';
  ($('cfg-vapid') as HTMLInputElement).value = config.vapidPublicKey ?? '';
}

const prompt_ = (q: string) => window.prompt(q) ?? '';

async function enableNotifications() {
  if (!client || !config.vapidPublicKey) return say('Connect and sign in first, and set the VAPID public key.');
  if (!('PushManager' in window)) return say('This browser cannot receive push here. On iPhone: Share, then Add to Home Screen, and open it from there.');
  if ((await Notification.requestPermission()) !== 'granted') return say('Notifications not allowed.');
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(config.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await client.rpc('save_push_subscription', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
  if (error) return say(`Could not register this device: ${error.message}`);
  await record(toggleNotifications(replica.library, true));
  say('Notifications on for this device.');
}

function wire() {
  $('reveal').onclick = () => ((revealed = true), render());
  for (const rating of ['again', 'hard', 'good', 'easy'] as Rating[]) {
    $(`r-${rating}`).onclick = async () => {
      const cardId = $('card').dataset.card!;
      const started = Number($('card').dataset.started ?? Date.now());
      revealed = false;
      if (cardId.startsWith('td-')) {
        const r = await runModule(deck, () => deck.reportRep(cardId, rating, Math.max(0, Date.now() - started)));
        if (!r.ok) say(`Test deck switched off: ${r.error}`);
      } else {
        await replica.record({ type: 'review', cardId, rating, durationMs: Math.max(0, Date.now() - started) });
      }
      $('card').dataset.started = String(Date.now());
      await afterChange();
    };
  }
  $('played').onclick = () => record({ ok: true, value: { type: 'played', minutes: Number(prompt_('Minutes played?')) || 15 } });
  $('save-settings').onclick = () => {
    try {
      void record(changeSettings(replica.library, JSON.parse(($('settings') as HTMLTextAreaElement).value)));
    } catch (e) {
      say(`Not valid JSON: ${(e as Error).message}`);
    }
  };
  $('use-zone').onclick = () =>
    record(changeSettings(replica.library, { dayStart: { ...replica.library.settings.dayStart, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }));
  $('notify-all').onchange = () => record(toggleNotifications(replica.library, ($('notify-all') as HTMLInputElement).checked));
  $('enable-push').onclick = () => void enableNotifications().catch((e) => say((e as Error).message));
  $('save-config').onclick = () => {
    config = { supabaseUrl: ($('cfg-url') as HTMLInputElement).value.trim(), publishableKey: ($('cfg-key') as HTMLInputElement).value.trim(), vapidPublicKey: ($('cfg-vapid') as HTMLInputElement).value.trim() };
    if (/sb_secret_|service_role/.test(JSON.stringify(config))) return say('That looks like a secret key. Only the publishable key belongs here.');
    localStorage.setItem('zg-config', JSON.stringify(config));
    location.reload();
  };
  $('sign-in').onclick = async () => {
    if (!config.supabaseUrl) return say('Save the Supabase settings first.');
    const c = await supabaseClient();
    const { error } = await c.auth.signInWithOtp({ email: ($('email') as HTMLInputElement).value.trim(), options: { emailRedirectTo: location.origin } });
    say(error ? error.message : 'Check your email. Type the code below (on iPhone, use the code, not the link).');
  };
  // The code, not the link: on iPhone a link opens Safari, which is separate
  // from the Home Screen app, so the app itself would never be signed in.
  $('verify').onclick = async () => {
    const token = ($('code') as HTMLInputElement).value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) return say('Enter the code from the email.');
    const c = await supabaseClient();
    const { error } = await c.auth.verifyOtp({ email: ($('email') as HTMLInputElement).value.trim(), token, type: 'email' });
    if (error) return say(error.message);
    location.reload();
  };
  $('sign-out').onclick = async () => {
    await client?.auth.signOut();
    location.reload();
  };
  $('sync').onclick = () => void syncNow().catch((e) => say(`Sync failed: ${(e as Error).message}`));
  $('export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([replica.exportJson()], { type: 'application/json' }));
    a.download = `zuniga-guitar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  ($('import') as HTMLInputElement).onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const parsed = JSON.parse(await file.text()) as { events?: unknown[] };
    const r = await replica.restore(parsed.events ?? []);
    say(`Restored ${r.added} events${r.rejected.length ? `, ${r.rejected.length} set aside` : ''}`);
    await afterChange();
  };
}

async function main() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  await connect().catch((e) => say(`Supabase: ${(e as Error).message}`));
  replica = await Replica.open(await indexedDbStore(userId), deviceId);
  deck = createHost(replica, TEST_DECK);
  const seeded = await runModule(deck, () => seedTestDeck(deck));
  wire();
  $('card').dataset.started = String(Date.now());
  render();
  say(seeded.ok ? `Ready (${userId === 'local' ? 'this device only' : 'synced account'})` : `Test deck failed: ${seeded.error}`);
  if (client) await syncNow().catch((e) => say(`Offline: ${(e as Error).message}`));
  setInterval(render, 30_000);
  (window as unknown as { zg: unknown }).zg = { replica, deck };
}

void main();
