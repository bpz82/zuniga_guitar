/**
 * Bare functional test harness. Not the product UI: no design, just every
 * engine feature reachable so it can be tested on a real phone and laptop.
 * Works offline with no account; connecting Supabase adds sign-in, sync and
 * push reminders. The values it asks for (project URL, publishable key,
 * VAPID public key) are public by design; no secret ever goes in the app.
 *
 * Single-page flow (Blake, 2026-11-02): Today opens with the current goal,
 * then what today holds for it, then today's lesson (the curriculum reading,
 * the cards and songs due, the goal's tasks, the metronome). Signed out with
 * a connection set up: the sign-in popup shows at launch.
 */
import {
  adoptDeviceTimeZone,
  changeSettings,
  createHost,
  dueToday,
  nudgesBetween,
  practiceDay,
  todayBlocks,
  planNudges,
  prompt,
  rateSong,
  Replica,
  runModule,
  seedTestDeck,
  sessionFor,
  songByCard,
  SONGS,
  supabaseRemote,
  TEST_DECK,
  toggleAlwaysRemindMorning,
  toggleNotifications,
  toggleWindowNotify,
  uploadNudges,
  uploadPendingTabs,
} from '../src/index.ts';
import type { EventBody, ModuleHost, Rating, SupabaseLike, Validation, WindowId } from '../src/index.ts';
import { indexedDbStore } from '../src/stores/indexeddb.ts';
import { METRONOME, ladderParams } from '../src/modules/metronome/practice.ts';
import { setupMetronome } from './metronome-ui.ts';
import { setupSongs } from './songs-ui.ts';
import { setupEar } from './ear-ui.ts';
import { setupRecorder } from './recorder-ui.ts';
import { setupGoals } from './goals-ui.ts';
import { setupShell } from './shell.ts';
import { setupSheets } from './sheets.ts';
import type { Sheets } from './sheets.ts';
import { badgeText } from './routes.ts';
import type { Shell } from './shell.ts';
import { lessonHeading, setupTheory } from './theory-ui.ts';
import { THEORY, contentOf, seedTheory } from '../src/modules/theory/practice.ts';
import { improvFor, memoFor, songwritingFor } from '../src/modules/recorder/blocks.ts';
import { runTakes } from '../src/modules/recorder/takes.ts';
import { RECORDER, uploadPending } from '../src/modules/recorder/takes.ts';
import { indexedDbBlobStore } from '../src/modules/recorder/blobs.ts';
import type { BlobStore } from '../src/modules/recorder/blobs.ts';
import { supabaseBucketStorage, supabaseTakeStorage, TABS_BUCKET } from '../src/modules/recorder/storage.ts';
import type { StorageClientLike } from '../src/modules/recorder/storage.ts';
import { EAR, seedEar } from '../src/modules/ear/practice.ts';
import { skillOf } from '../src/modules/ear/core.ts';
import { hook, RATINGS } from './hooks.ts';
import type { Hook } from './hooks.ts';
import { blocksForFocus, focusGoal, goalWhen } from './today.ts';

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

const $ = <T extends HTMLElement = HTMLInputElement>(name: Hook) => hook<T>(name);
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
let metronome!: ReturnType<typeof setupMetronome>;
let songsHost!: ModuleHost;
let songsUi!: ReturnType<typeof setupSongs>;
let earHost!: ModuleHost;
let earUi!: ReturnType<typeof setupEar>;
let recHost!: ModuleHost;
let recBlobs!: BlobStore;
let tabBlobs!: BlobStore;
let recorder!: ReturnType<typeof setupRecorder>;
let goalsUi!: ReturnType<typeof setupGoals>;
let theoryHost!: ModuleHost;
let theoryUi!: ReturnType<typeof setupTheory>;
let shell!: Shell;
let sheets!: Sheets;
/** Takes storage, when signed in. */
const cloud = () => (client && userId !== 'local' ? { storage: supabaseTakeStorage(client as unknown as StorageClientLike), userId } : null);
/** Tab storage, when signed in. */
const tabCloud = () => (client && userId !== 'local' ? { storage: supabaseBucketStorage(client as unknown as StorageClientLike, TABS_BUCKET), userId } : null);
let revealed = false;
/** A connection is set up and it answered: nobody is signed in on this device. */
let signedOut = false;

function say(text: string) {
  $('status').textContent = `${new Date().toLocaleTimeString()} ${text}`;
}

/** Sign-in messages show in the popup (the status line is behind it) and in the status line. */
function signInSay(text: string) {
  $('signin-note').textContent = text;
  say(text);
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
  signedOut = !data.session;
  if (!data.session) client = null; // sync needs a signed-in user
}

async function syncNow() {
  if (!client) return say('Not connected');
  const report = await replica.sync(supabaseRemote(client));
  await uploadNudges(client, planNudges(replica.library, Date.now()));
  const c = cloud();
  const up = c ? await uploadPending(recHost, recBlobs, c.storage, c.userId) : null;
  const t = tabCloud();
  const tabsUp = t ? await runModule(songsHost, () => uploadPendingTabs(songsHost, tabBlobs, t.storage, t.userId)) : null;
  const tabs = tabsUp?.ok ? tabsUp.value : null;
  // Marking takes and tabs uploaded wrote new events: send them too.
  if ((up && up.uploaded > 0) || (tabs && tabs.uploaded > 0)) await replica.sync(supabaseRemote(client));
  say(
    `Synced: sent ${report.pushed}, received ${report.pulled}${report.rejected.length ? `, ${report.rejected.length} bad rows set aside` : ''}` +
      (up ? `; takes uploaded ${up.uploaded}${up.failed.length ? `, ${up.failed.length} waiting (${up.failed[0]!.error})` : ''}` : '') +
      (tabs && (tabs.uploaded > 0 || tabs.failed.length > 0) ? `; tabs uploaded ${tabs.uploaded}${tabs.failed.length ? `, ${tabs.failed.length} waiting (${tabs.failed[0]!.error})` : ''}` : ''),
  );
  render();
}

const WINDOW_LABEL: Record<string, string> = {
  morning: 'Morning session',
  'before-work': 'Before-work burst',
  'during-work': 'Work-hours burst',
  'after-work': 'After-work burst',
};

/**
 * Today, the single page (2026-11-02): the goal first, then what today holds
 * for it (the session, the goal's blocks, the current lesson), then the lesson
 * itself (drawn by render()).
 */
function renderToday() {
  const lib = replica.library;
  const now = Date.now();
  const today = practiceDay(now, lib.settings.dayStart);

  // 1. The goal.
  const focus = focusGoal(lib, today);
  $('goal-focus').textContent = focus ? focus.goal.what : 'No goal yet';
  $('goal-focus-when').textContent = focus
    ? `${goalWhen(focus.goal, today)}${focus.others ? ` · and ${focus.others} more ${focus.others === 1 ? 'goal' : 'goals'}` : ''}`
    : 'Set a goal (a gig, a record, a deadline) and every day is planned around it.';
  $('goal-focus-why').textContent = focus?.goal.why ?? '';
  $('goal-focus-why').hidden = !focus?.goal.why;
  $('goal-focus-link').textContent = focus ? 'All goals' : 'Set your goal';

  // 2. What today holds for it.
  const s = sessionFor(lib, now);
  const review = s.segments.find((x) => x.kind === 'review');
  const due = review && review.kind === 'review' ? review.due.length : 0;
  const fresh = review && review.kind === 'review' ? review.fresh.length : 0;
  const where = `${WINDOW_LABEL[s.windowId ?? ''] ?? 'Practice'} (${s.mode}${s.quiet ? ', quiet hours' : ''})`;
  $('today-now').textContent = s.empty ? `${where}: nothing due right now.` : `${where}: ${due} due, ${fresh} new.`;
  const goalName = (id: string) => lib.goals.get(id)?.what ?? 'another goal';
  const rows = blocksForFocus(todayBlocks(lib, now), focus?.goal.id ?? null).map(({ seg, focus: mine }) => {
    const li = document.createElement('li');
    li.dataset.zg = 'today-block';
    li.textContent = `${seg.block.label} · ${seg.block.minutes} min${seg.done ? ' ✓' : ''}${mine ? '' : ` · for ${goalName(seg.block.goalId)}`}`;
    return li;
  });
  const lesson = theoryUi.current();
  if (lesson) {
    const li = document.createElement('li');
    li.dataset.zg = 'today-lesson';
    li.textContent = `${lessonHeading(lesson)} · ${lesson.started === 0 ? 'new today' : `${lesson.ready} of ${lesson.total} cards solid`}`;
    rows.push(li);
  }
  $('today-blocks').replaceChildren(...rows);
  if (rows.length === 0) $('today-blocks').textContent = 'No goal blocks today.';
  $('today-start').textContent = s.empty ? 'Open today\'s lesson' : 'Start today\'s lesson';
  const zone = lib.settings.dayStart.timeZone;
  const next = nudgesBetween(lib, now, now + 7 * 24 * 60 * 60 * 1000)[0];
  $('today-reminder').textContent = !lib.settings.notifications
    ? 'Reminders are off (turn them on in Settings).'
    : next
      ? `Next reminder: ${WINDOW_LABEL[next.windowId] ?? next.windowId}, ${new Date(next.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone })}.`
      : 'No reminders in the next 7 days.';

  // 3. Today's lesson opens with the current curriculum lesson's reading.
  theoryUi.renderReading();
}

const BADGE_LABEL = { today: 'Today', cards: 'Cards' } as const;

/** Due-count badges: Today = due in the session open now; Cards = theory cards due today. */
function renderBadges(dueNow: number) {
  const counts: Record<'today' | 'cards', number> = { today: dueNow, cards: dueToday(replica.library, Date.now()).get(THEORY.id) ?? 0 };
  for (const [tab, count] of Object.entries(counts) as ['today' | 'cards', number][]) {
    const text = badgeText(count);
    const badge = $(`nav-badge-${tab}`);
    const link = $(`tab-${tab}`);
    badge.textContent = text ?? '';
    badge.hidden = text === null;
    // The badge is aria-hidden; the count is read as part of the tab's name instead.
    if (text === null) link.removeAttribute('aria-label');
    else link.setAttribute('aria-label', `${BADGE_LABEL[tab]}, ${text} due`);
  }
}

function render() {
  renderToday();
  const lib = replica.library;
  const now = Date.now();
  const s = sessionFor(lib, now);
  const reviewNow = s.segments.find((x) => x.kind === 'review');
  renderBadges(reviewNow && reviewNow.kind === 'review' ? reviewNow.due.length : 0);
  // Quiet hours fields follow the settings, except while being edited.
  for (const [name, value] of [['quiet-start', lib.settings.quietHours.start], ['quiet-end', lib.settings.quietHours.end]] as const) {
    const input = $(name) as HTMLInputElement;
    if (document.activeElement !== input) input.value = value;
  }
  $('session').textContent =
    `${s.date} · ${s.windowId ?? 'no window'} · ${s.mode}${s.quiet ? ' (quiet hours)' : ''} · ${s.minMinutes}–${s.minutes} min` +
    ` · ${replica.pendingCount} waiting to sync`;

  const review = s.segments.find((x) => x.kind === 'review');
  const next = review && review.kind === 'review' ? (review.due[0]?.memory.cardId ?? review.fresh[0]) : undefined;
  const card = next ? lib.cards.get(next) : undefined;
  const item = card ? lib.items.get(card.itemId) : undefined;
  $('practice').hidden = true;
  $('card-tab').hidden = true;
  // Every card shown is named on the card element (tests and ratings read it).
  $('card').dataset.card = card?.id ?? '';
  // Theory cards draw themselves (question, source, options); this also clears them for any other card.
  const isTheory = theoryUi.showCard(card && item?.module === THEORY.id ? card.id : '', revealed, () => Number($('card').dataset.started ?? Date.now()));
  if (isTheory) {
    // drawn by the theory panel
  } else if (card && item && card.template === 'tempo-exercise') {
    // A metronome exercise: practised with the metronome, logged when it stops.
    $('question').textContent = `Metronome exercise: ${String(item.fields.name ?? card.id)}`;
    $('answer').textContent = '';
    $('rate').hidden = $('reveal').hidden = true;
    $('practice').hidden = false;
    $('practice').onclick = () => metronome.select(card.id);
  } else if (card && item && item.module === EAR.id) {
    // An ear-training skill: practised in the ear panel, one fresh exemplar at a time.
    $('question').textContent = `Ear training: ${skillOf(String(item.fields.family), String(item.fields.category))?.label ?? card.id}`;
    $('answer').textContent = '';
    $('rate').hidden = $('reveal').hidden = true;
    $('practice').hidden = false;
    $('practice').onclick = () => (earUi.select(card.id), shell.go('ear'));
  } else if (card && item && item.module === SONGS.id) {
    // A song: no answer to reveal. Play it, then rate how it went. Its tab, if it has one, is a tap away.
    const song = songByCard(songsHost, card.id);
    $('question').textContent = `Play: ${song?.title ?? card.id}`;
    $('answer').textContent = '';
    $('card').dataset.card = card.id;
    $('reveal').hidden = true;
    $('rate').hidden = false;
    $('card-tab').hidden = !song?.tab;
    $('card-tab').onclick = () => song && void songsUi.showTab(song.itemId);
  } else if (card && item) {
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
      li.dataset.zg = 'block';
      const b = seg.block;
      // Improv takes and songwriting prompts: today's concrete prompt, recorded.
      const take = improvFor(b) ?? songwritingFor(b, s.date) ?? memoFor(b);
      li.textContent = `${b.label} · ${b.minutes} min${take ? ` · ${take.prompt} (${take.takes} × ${take.minutes} min, recorded)` : ''} ${seg.done ? '✓' : ''}`;
      if (take && !seg.done) {
        const rec = document.createElement('button');
        rec.dataset.zg = 'block-record';
        rec.textContent = 'Record';
        rec.onclick = () => {
          shell.go('record'); // the recorder's timer and Stop live there
          void recorder.improv(take, { goalId: b.goalId, blockId: b.blockId });
        };
        li.append(' ', rec);
      }
      if (!seg.done) {
        const btn = document.createElement('button');
        btn.dataset.zg = 'block-done';
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
        const ladder = ladderParams(b);
        if (ladder) {
          const go = document.createElement('button');
          go.dataset.zg = 'block-ladder';
          go.textContent = 'Start ladder';
          go.onclick = () => metronome.startLadder({ params: ladder, goalId: b.goalId, blockId: b.blockId });
          li.append(' ', go);
        }
      }
      return [li];
    }),
  );

  ($('settings') as HTMLTextAreaElement).value = JSON.stringify(lib.settings, null, 2);
  ($('notify-all') as HTMLInputElement).checked = lib.settings.notifications;
  ($('notify-morning-always') as HTMLInputElement).checked = lib.settings.alwaysRemindMorning;
  songsUi.render();
  earUi.render();
  recorder.render();
  goalsUi.render();
  theoryUi.renderLessons();
  $('notify-windows').replaceChildren(
    ...lib.settings.windows.map((w) => {
      const label = document.createElement('label');
      label.dataset.zg = 'notify-window';
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

/** Moves down to today's lesson: smoothly, unless the user asked for less motion. */
function goToLesson() {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lesson = $('lesson');
  lesson.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  lesson.focus({ preventScroll: true });
}

function wire() {
  $('today-start').onclick = goToLesson;
  $('reveal').onclick = () => ((revealed = true), render());
  for (const rating of RATINGS as readonly Rating[]) {
    $(`r-${rating}`).onclick = async () => {
      const cardId = $('card').dataset.card!;
      const started = Number($('card').dataset.started ?? Date.now());
      revealed = false;
      const module = replica.library.items.get(replica.library.cards.get(cardId)?.itemId ?? '')?.module;
      if (module === THEORY.id) {
        await theoryUi.rate(cardId, rating, Math.max(0, Date.now() - started));
      } else if (module === SONGS.id) {
        const r = await runModule(songsHost, () => rateSong(songsHost, cardId, rating, Math.max(0, Date.now() - started)));
        if (!r.ok) say(`Songs switched off: ${r.error}`);
        else if (!r.value.ok) say(`Songs: ${r.value.error}`);
      } else if (cardId.startsWith('td-')) {
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
  $('save-quiet').onclick = () =>
    record(changeSettings(replica.library, { quietHours: { start: ($('quiet-start') as HTMLInputElement).value, end: ($('quiet-end') as HTMLInputElement).value } }));
  $('use-zone').onclick = () =>
    record(changeSettings(replica.library, { dayStart: { ...replica.library.settings.dayStart, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }));
  $('notify-all').onchange = () => record(toggleNotifications(replica.library, ($('notify-all') as HTMLInputElement).checked));
  $('notify-morning-always').onchange = () => record(toggleAlwaysRemindMorning(replica.library, ($('notify-morning-always') as HTMLInputElement).checked));
  songsUi.wire();
  earUi.wire();
  recorder.wire();
  goalsUi.wire();
  theoryUi.wire();
  $('enable-push').onclick = () => void enableNotifications().catch((e) => say((e as Error).message));
  $('save-config').onclick = () => {
    config = { supabaseUrl: ($('cfg-url') as HTMLInputElement).value.trim(), publishableKey: ($('cfg-key') as HTMLInputElement).value.trim(), vapidPublicKey: ($('cfg-vapid') as HTMLInputElement).value.trim() };
    if (/sb_secret_|service_role/.test(JSON.stringify(config))) return say('That looks like a secret key. Only the publishable key belongs here.');
    localStorage.setItem('zg-config', JSON.stringify(config));
    location.reload();
  };
  $('open-signin').onclick = () => sheets.open('signin');
  $('signin-later').onclick = () => sheets.close('signin');
  $('sign-in').onclick = async () => {
    if (!config.supabaseUrl) return signInSay('Save the Supabase settings first.');
    const c = await supabaseClient();
    const { error } = await c.auth.signInWithOtp({ email: ($('email') as HTMLInputElement).value.trim(), options: { emailRedirectTo: location.origin } });
    signInSay(error ? error.message : 'Check your email. Type the code below (on iPhone, use the code, not the link).');
  };
  // The code, not the link: on iPhone a link opens Safari, which is separate
  // from the Home Screen app, so the app itself would never be signed in.
  $('verify').onclick = async () => {
    const token = ($('code') as HTMLInputElement).value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) return signInSay('Enter the code from the email.');
    const c = await supabaseClient();
    const { error } = await c.auth.verifyOtp({ email: ($('email') as HTMLInputElement).value.trim(), token, type: 'email' });
    if (error) return signInSay(error.message);
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
  metronome = setupMetronome(replica, createHost(replica, METRONOME), say, afterChange);
  await metronome.init();
  songsHost = createHost(replica, SONGS);
  sheets = setupSheets();
  tabBlobs = await indexedDbBlobStore(userId, indexedDB, 'tabs');
  songsUi = setupSongs(songsHost, say, afterChange, () => sheets.close('songs-paste'), { files: () => tabBlobs, cloud: tabCloud, sheets });
  earHost = createHost(replica, EAR);
  const earSeeded = await runModule(earHost, () => seedEar(earHost));
  if (!earSeeded.ok) say(`Ear training failed: ${earSeeded.error}`);
  earUi = setupEar(replica, earHost, say, afterChange);
  recHost = createHost(replica, RECORDER);
  recBlobs = await indexedDbBlobStore(userId);
  // A goal block's takes are all recorded: tick the block off for today.
  recorder = setupRecorder(recHost, () => recBlobs, cloud, say, afterChange, async ({ runId, block }) => {
    if (!block) return;
    const durationMs = runTakes(recHost, runId).reduce((sum, t) => sum + t.durationMs, 0);
    await record({ ok: true, value: { type: 'task-done', goalId: block.goalId, blockId: block.blockId, durationMs } });
  });
  goalsUi = setupGoals(replica, songsHost, record, say, () => sheets.close('goal-new'));
  theoryHost = createHost(replica, THEORY);
  const dayStart = () => replica.library.settings.dayStart;
  const theorySeeded = await runModule(theoryHost, () => seedTheory(theoryHost, dayStart()));
  if (!theorySeeded.ok) say(`Theory cards failed: ${theorySeeded.error}`);
  theoryUi = setupTheory(theoryHost, say, afterChange, dayStart);
  wire();
  $('card').dataset.started = String(Date.now());
  // Leaving a screen closes its sheets (a modal left open on a hidden screen would block the page).
  shell = setupShell(() => (sheets.closeAll(), render()));
  sheets.closeAll();
  say(seeded.ok ? `Ready (${userId === 'local' ? 'this device only' : 'synced account'})` : `Test deck failed: ${seeded.error}`);
  (window as unknown as { zg: unknown }).zg = { replica, deck, metronome, songs: songsHost, tabs: tabBlobs, ear: { host: earHost, ui: earUi }, recorder: { host: recHost, ui: recorder }, theory: { host: theoryHost, content: (id: string) => contentOf(theoryHost, id) }, shell, sheets };
  // Signed out but able to sign in: ask straight away (Blake, 2026-11-02). "Not now" keeps this device only.
  if (signedOut) sheets.open('signin');
  const synced = client ? await syncNow().then(() => true, (e) => (say(`Offline: ${(e as Error).message}`), false)) : true;
  // Settings never set (on any synced device): use this device's time zone instead of the UTC default.
  if (synced) {
    const zone = adoptDeviceTimeZone(replica.library, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (zone) {
      await record(zone);
      say(`Using this device's time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}) for your practice day and quiet hours. Change it in Settings.`);
    }
  }
  setInterval(render, 30_000);
}

void main();
