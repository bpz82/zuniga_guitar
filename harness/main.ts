/**
 * Bare functional test harness. Not the product UI: no design, just every
 * engine feature reachable so it can be tested on a real phone and laptop.
 * Works offline with no account; connecting Supabase adds sign-in, sync and
 * push reminders. The values it asks for (project URL, publishable key,
 * VAPID public key) are public by design; no secret ever goes in the app.
 *
 * Home and Teach (Blake, 2026-11-03): opening the app shows only a popup of
 * today's objectives for the current goal; closing it moves smoothly into the
 * day's deck (cards and songs, the goal's tasks, the metronome). No goal yet:
 * the new-goal sheet opens instead. Teach, a swipe away, does the same for
 * the curriculum: its objectives from the current chapter, then the lesson's
 * reading and deck. One menu button reaches everything else. Signed out with
 * a connection set up: the sign-in popup opens too, on top.
 *
 * Band members (Blake, 2026-11-03): an invite link (?invite=...) is kept
 * until its person signs in, then used before anything else happens, so the
 * new account becomes a band member before it holds any data. A band
 * member's app is Songs (the owner's list, read only, rated privately) and
 * his own Settings, nothing else: no module is set up, nothing is seeded,
 * and other screens can't be reached. The server enforces the same.
 */
import {
  adoptDeviceTimeZone,
  changeSettings,
  createHost,
  dueToday,
  nudgesBetween,
  practiceDay,
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
import { acceptInvite, bandRole, inviteFromUrl, isSharedSongEvent, MEMBER_WRITES, parseRole } from '../src/index.ts';
import type { BandRole, EventBody, ModuleHost, Rating, SupabaseLike, Validation, WindowId } from '../src/index.ts';
import { databaseName, indexedDbStore } from '../src/stores/indexeddb.ts';
import { setupBand } from './band/band-ui.ts';
import { installGuide, offerInstall, platformOf } from './shared/install.ts';
import { METRONOME, ladderParams } from '../src/modules/metronome/practice.ts';
import { setupMetronome } from './metronome/metronome-ui.ts';
import { setupSongs } from './songs/songs-ui.ts';
import { setupEar } from './ear/ear-ui.ts';
import { setupRecorder } from './recorder/recorder-ui.ts';
import { setupGoals } from './home/goals-ui.ts';
import { setupShell } from './shared/shell.ts';
import { setupSheets } from './shared/sheets.ts';
import type { Sheets } from './shared/sheets.ts';
import { badgeText } from './shared/routes.ts';
import type { Shell } from './shared/shell.ts';
import { lessonHeading, setupTheory } from './theory/theory-ui.ts';
import { THEORY, contentOf, seedTheory } from '../src/modules/theory/practice.ts';
import { improvFor, memoFor, songwritingFor } from '../src/modules/recorder/blocks.ts';
import { runTakes } from '../src/modules/recorder/takes.ts';
import { RECORDER, uploadPending } from '../src/modules/recorder/takes.ts';
import { blobDatabaseName, indexedDbBlobStore, memoryBlobStore } from '../src/modules/recorder/blobs.ts';
import type { BlobStore } from '../src/modules/recorder/blobs.ts';
import { supabaseBucketStorage, supabaseTakeStorage, TABS_BUCKET } from '../src/modules/recorder/storage.ts';
import type { StorageClientLike } from '../src/modules/recorder/storage.ts';
import { EAR, seedEar } from '../src/modules/ear/practice.ts';
import { skillOf } from '../src/modules/ear/core.ts';
import { hook, RATINGS } from './shared/hooks.ts';
import type { Hook } from './shared/hooks.ts';
import { focusGoal, goalWhen, homeObjectives } from './home/today.ts';
import type { Objective } from './home/today.ts';
import { chapterLine, teachDeck, teachObjectives } from './home/teach.ts';
import { setupSwipe } from './shared/swipe.ts';
import { hashOf, isPage, PAGES, pageAfter, startScreen } from './shared/routes.ts';
import type { Page, Screen } from './shared/routes.ts';

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
let bandUi!: ReturnType<typeof setupBand>;
/** Owner, band member, or a member whose access was removed (2026-11-03). Signed out or local: owner. */
let role: BandRole = { role: 'owner' };
/** Shown once the app is ready (an invite link opened on a device already signed in). */
let bandNotice: string | null = null;
/** Takes storage, when signed in. */
const cloud = () => (client && userId !== 'local' ? { storage: supabaseTakeStorage(client as unknown as StorageClientLike), userId } : null);
/** Tab storage, when signed in: the user's own folder, or for a band member his owner's (read only). */
const tabCloud = () => {
  if (!client || userId === 'local' || role.role === 'removed') return null;
  return { storage: supabaseBucketStorage(client as unknown as StorageClientLike, TABS_BUCKET), userId: role.role === 'member' ? role.ownerId : userId };
};
let revealed = false;
/** Teach's deck: the answer shown for the card on show. */
let teachRevealed = false;
/** A connection is set up and it answered: nobody is signed in on this device. */
let signedOut = false;
/** The sign-in popup is still to open (once, at launch, over the first page's popup). */
let signInPending = false;
/** Pages whose objectives popup has shown since the app opened (each opens with it once). */
const introduced = new Set<Page>();
/** No goal at launch: the new-goal sheet opens on Goals; once saved, Home opens with its popup. */
let goalSheetOnArrival = false;
let firstGoalPending = false;
/** The screen shown before the current one (for the page slide). */
let lastScreen: Screen | null = null;

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
  if (role.role !== 'owner') return memberSync();
  const report = await replica.sync(supabaseRemote(client, userId));
  await uploadNudges(client, planNudges(replica.library, Date.now()));
  const c = cloud();
  const up = c ? await uploadPending(recHost, recBlobs, c.storage, c.userId) : null;
  const t = tabCloud();
  const tabsUp = t ? await runModule(songsHost, () => uploadPendingTabs(songsHost, tabBlobs, t.storage, t.userId)) : null;
  const tabs = tabsUp?.ok ? tabsUp.value : null;
  // Marking takes and tabs uploaded wrote new events: send them too.
  if ((up && up.uploaded > 0) || (tabs && tabs.uploaded > 0)) await replica.sync(supabaseRemote(client, userId));
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

/** Bullets for an objectives popup. */
function bullets(items: readonly Objective[], where: 'today' | 'teach'): HTMLLIElement[] {
  return items.map((o) => {
    const li = document.createElement('li');
    if (where === 'teach') li.dataset.zg = 'teach-objective';
    else if (o.kind === 'block') li.dataset.zg = 'today-block';
    else if (o.kind === 'lesson') li.dataset.zg = 'today-lesson';
    else li.dataset.zg = 'today-objective';
    li.dataset.kind = o.kind;
    if (o.done) li.dataset.done = '';
    li.textContent = o.text;
    return li;
  });
}

/**
 * Home (2026-11-03): its objectives popup (the goal, the session open now,
 * today's objectives as bullets, the next reminder) and the line over the deck.
 */
function renderHome() {
  const lib = replica.library;
  const now = Date.now();
  const today = practiceDay(now, lib.settings.dayStart);

  // The goal.
  const focus = focusGoal(lib, today);
  $('goal-focus').textContent = focus ? focus.goal.what : 'No goal yet';
  $('goal-focus-when').textContent = focus
    ? `${goalWhen(focus.goal, today)}${focus.others ? ` · and ${focus.others} more ${focus.others === 1 ? 'goal' : 'goals'}` : ''}`
    : 'Set a goal (a gig, a record, a deadline) and every day is planned around it.';
  $('goal-focus-why').textContent = focus?.goal.why ?? '';
  $('goal-focus-why').hidden = !focus?.goal.why;
  $('goal-focus-link').textContent = focus ? 'All goals' : 'Set your goal';
  $('home-goal').textContent = focus ? `Working toward ${focus.goal.what} · ${goalWhen(focus.goal, today)}` : 'No goal yet. Set one in Goals and each day is planned around it.';

  // Today's objectives for it.
  const s = sessionFor(lib, now);
  const review = s.segments.find((x) => x.kind === 'review');
  const due = review && review.kind === 'review' ? review.due.length : 0;
  const fresh = review && review.kind === 'review' ? review.fresh.length : 0;
  const where = `${WINDOW_LABEL[s.windowId ?? ''] ?? 'Practice'} (${s.mode}${s.quiet ? ', quiet hours' : ''})`;
  $('today-now').textContent = s.empty ? `${where}: nothing due right now.` : `${where}: ${due} due, ${fresh} new.`;
  const lesson = theoryUi.current();
  $('today-blocks').replaceChildren(...bullets(homeObjectives(lib, now, lesson ? lessonHeading(lesson) : null), 'today'));
  const zone = lib.settings.dayStart.timeZone;
  const next = nudgesBetween(lib, now, now + 7 * 24 * 60 * 60 * 1000)[0];
  $('today-reminder').textContent = !lib.settings.notifications
    ? 'Reminders are off (turn them on in Settings).'
    : next
      ? `Next reminder: ${WINDOW_LABEL[next.windowId] ?? next.windowId}, ${new Date(next.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone })}.`
      : 'No reminders in the next 7 days.';
}

/**
 * Teach (2026-11-03): its objectives popup from the current unlocked chapter,
 * the lesson's reading, and the day's lesson deck (one card at a time).
 */
function renderTeach() {
  const lib = replica.library;
  const state = theoryUi.current();
  const deck = teachDeck(lib, Date.now(), THEORY.id);
  $('teach-chapter').textContent = state ? chapterLine(state) : 'The course';
  $('teach-lesson').textContent = state ? lessonHeading(state) : 'Every lesson has graduated';
  $('teach-goals').replaceChildren(...bullets(teachObjectives(state, { due: deck.due.length, fresh: deck.fresh.length }), 'teach'));
  $('teach-progress').textContent = !theoryHost.enabled
    ? `Theory cards switched off: ${theoryHost.disabledReason}`
    : state
      ? `${chapterLine(state)}. ${lessonHeading(state)}: ${state.ready} of ${state.total} cards solid.`
      : 'Every lesson has graduated. Reviews keep them fresh.';
  theoryUi.renderReading();
  $('teach-status').textContent = `${deck.due.length} due, ${deck.fresh.length} new`;
  const next = theoryHost.enabled ? (deck.due[0] ?? deck.fresh[0]) : undefined;
  const started = () => Number($('teach-card').dataset.started ?? Date.now());
  if (!next || !theoryUi.showCard(next, teachRevealed, started, 'teach')) {
    $('teach-card').dataset.card = '';
    $('teach-question').textContent = state && state.ready < state.total
      ? 'Nothing due right now. These cards come back on a later day; getting them right then is what unlocks the next lesson.'
      : 'Nothing due right now.';
    $('teach-answer').textContent = '';
    $('teach-choices').replaceChildren();
    $('teach-reveal').hidden = $('teach-rate').hidden = true;
  }
}

/**
 * After a page's objectives popup: move smoothly into its deck. The page
 * plays its entrance (the theme animates [data-enter], and does nothing under
 * reduced motion), scrolls to the deck and puts focus there.
 */
function enterDeck(page: Page) {
  if (shell.current() !== page) return; // closed by leaving the page
  const target = page === 'today' ? $('now') : theoryUi.current()?.started === 0 ? $('lesson') : $('teach-deck');
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  play(page, 'deck');
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  target.focus({ preventScroll: true });
}

/** An entrance for a screen: "deck" (after its popup), "from-right" or "from-left" (a page slide). */
function play(screen: Screen, entrance: 'deck' | 'from-right' | 'from-left') {
  const el = $(`screen-${screen}` as Hook);
  el.setAttribute('data-enter', entrance);
  window.setTimeout(() => el.getAttribute('data-enter') === entrance && el.removeAttribute('data-enter'), 900);
}

/**
 * Arriving on a screen (after it is shown). A page opens with its objectives
 * popup the first time it is shown after the app opens. The sign-in popup,
 * if due, opens last, on top.
 */
function arrive(screen: Screen) {
  if (lastScreen && lastScreen !== screen && isPage(lastScreen) && isPage(screen)) {
    play(screen, PAGES.indexOf(screen) > PAGES.indexOf(lastScreen) ? 'from-right' : 'from-left');
  }
  lastScreen = screen;
  if (screen === 'goals' && goalSheetOnArrival) {
    goalSheetOnArrival = false;
    sheets.open('goal-new');
  } else if (isPage(screen) && !introduced.has(screen)) {
    // (Opening the app on Home with no goal goes to Goals instead: see main().)
    introduced.add(screen);
    sheets.open(screen === 'today' ? 'objectives' : 'teach-objectives');
  }
  if (signInPending) {
    signInPending = false;
    sheets.open('signin');
  }
}

const BADGE_LABEL = { today: 'Home', cards: 'Cards' } as const;

/** Due-count badges in the menu: Home = due in the session open now; Cards = theory cards due today. */
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
  if (role.role !== 'owner') return renderMember();
  bandUi.render();
  renderHome();
  renderTeach();
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

// ------------------------------------------------- band members (2026-11-03) --

/** An invite link's token, kept on this device until its person signs in (then used, or dropped, at once). */
const INVITE_KEY = 'zg-invite';
/** The last role the server gave this account on this device, so the app opens offline. */
const roleKey = (id: string) => `zg-band-role-${id}`;
const cachedRole = (id: string): BandRole | null => {
  const r = parseRole(read<unknown>(roleKey(id), null));
  return r.ok ? r.value : null;
};
const cacheRole = (id: string, r: BandRole) =>
  localStorage.setItem(roleKey(id), JSON.stringify(r.role === 'member' ? { role: 'member', owner_id: r.ownerId } : { role: r.role }));
/** This device's copy of the owner's songs and tabs (a band member's): its own databases, never his own data. */
const bandStoreId = (id: string) => `${id}-band`;

/** An invite link was opened: take the token out of the address (and history) straight away. */
function takeInviteFromUrl(): string | null {
  const { token, rest } = inviteFromUrl(location.href);
  if (rest !== null) history.replaceState(null, '', rest);
  return token;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the server took too long')), ms))]);

/**
 * Signed in: settle who this account is before anything opens. A pending
 * invite is used first (the account is brand new, so it becomes a band
 * member before it holds any data); if the server refuses it, this device
 * signs out again and says why, so no owner account is set up by mistake.
 * Otherwise the server says, and the answer is kept for opening offline.
 * An owner, once known, opens without waiting; a band member is checked
 * each time (his access may have been removed).
 */
async function settleRole(): Promise<string | null> {
  const c = client!;
  const pending = localStorage.getItem(INVITE_KEY);
  if (pending) {
    localStorage.removeItem(INVITE_KEY);
    try {
      role = await withTimeout(acceptInvite(c, pending), 10_000);
      cacheRole(userId, role);
      bandNotice = 'Welcome to the band. Here are your band leader\'s songs: rate each one; your ratings are yours alone.';
      return null;
    } catch (e) {
      await c.auth.signOut().catch(() => undefined);
      client = null;
      userId = 'local';
      signedOut = true;
      $('account').textContent = 'Not signed in';
      return `${(e as Error).message} You are not signed in.`;
    }
  }
  const known = cachedRole(userId);
  if (known?.role === 'owner') {
    role = known;
    return null;
  }
  try {
    role = await withTimeout(bandRole(c), 5_000);
    cacheRole(userId, role);
  } catch {
    role = known ?? { role: 'owner' }; // offline: the last answer here; never asked: an owner, as before band members
  }
  return null;
}

/** Deletes this device's copy of the owner's songs and tabs (access removed). The member's own data is not touched. */
async function clearBandCopy(id: string) {
  const drop = (name: string) =>
    new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  await drop(databaseName(bandStoreId(id)));
  await drop(blobDatabaseName(bandStoreId(id), 'tabs'));
}

/**
 * A band member's sync: check he is still a member (if not, reopen as what
 * he is now), send his ratings to his own rows, then fetch his owner's
 * songs into the shared copy. No reminders, takes or tab uploads.
 */
async function memberSync() {
  if (!client) return say('Not connected');
  const now = await bandRole(client);
  const changed = now.role !== role.role || (now.role === 'member' && role.role === 'member' && now.ownerId !== role.ownerId);
  if (changed) {
    cacheRole(userId, now);
    location.reload();
    return;
  }
  if (role.role !== 'member') return say('Your access to the band\'s songs was removed.');
  const own = await replica.sync(supabaseRemote(client, userId));
  const shared = await replica.syncShared(supabaseRemote(client, role.ownerId));
  const bad = own.rejected.length + shared.rejected.length;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  say(`Synced: sent ${n(own.pushed, 'rating', 'ratings')}, received ${n(shared.pulled, 'song update', 'song updates')}${bad ? `, ${bad} bad rows set aside` : ''}`);
  render();
}

/** A band member's screens: Songs (read only, his ratings) and Settings. */
function renderMember() {
  bandUi.render();
  songsUi.render();
  const removed = role.role === 'removed';
  $('songs-band').hidden = false;
  $('songs-band-title').textContent = removed ? 'Access removed' : "Your band's songs";
  $('songs-band-note').textContent = removed
    ? "Your band leader removed your access to their songs. Your own ratings stay on this device; export them in Settings."
    : 'Shared with you by your band leader, read only: open a tab to see or download it. Your ratings are yours alone; nobody else sees them.';
  $('session').textContent = `${replica.pendingCount} waiting to sync`;
}

/**
 * Putting the app on a band member's phone (2026-11-03): the walk-through
 * for this device, its button in Settings, and opening it by itself once
 * per account on this device when he is in a browser (not the Home Screen
 * app). Called once the app is up, so nothing closes it straight away.
 */
function setupInstall(member: boolean) {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
  const guide = installGuide(platformOf(nav.userAgent, nav.maxTouchPoints), location.origin + location.pathname);
  $('install-intro').textContent = guide.intro;
  $('install-steps').replaceChildren(
    ...guide.steps.map((text) => {
      const li = document.createElement('li');
      li.dataset.zg = 'install-step';
      li.textContent = text;
      return li;
    }),
  );
  $('install-open').hidden = !member || standalone;
  $('install-open').onclick = () => sheets.open('install');
  $('install-done').onclick = () => sheets.close('install');
  const key = `zg-install-offered-${userId}`;
  if (offerInstall({ member, standalone, offeredBefore: localStorage.getItem(key) !== null })) {
    localStorage.setItem(key, '1');
    sheets.open('install');
  }
}

/** Opens the app for a band member (or a member whose access was removed). */
async function startMember() {
  const member = role.role === 'member' ? role : null;
  if (!member) await clearBandCopy(userId);
  replica = await Replica.open(await indexedDbStore(userId), deviceId, {
    writable: MEMBER_WRITES,
    ...(member ? { shared: { store: await indexedDbStore(bandStoreId(userId)), accept: isSharedSongEvent } } : {}),
  });
  songsHost = createHost(replica, SONGS);
  sheets = setupSheets();
  bandUi = setupBand({ client: () => client, role: () => role, appUrl: () => location.origin + location.pathname, sheets, say });
  tabBlobs = member ? await indexedDbBlobStore(bandStoreId(userId), indexedDB, 'tabs') : memoryBlobStore();
  const schedule = () => ({ retention: replica.library.settings.desiredRetention, dayStart: replica.library.settings.dayStart });
  songsUi = setupSongs(songsHost, say, afterChange, () => undefined, { files: () => tabBlobs, cloud: tabCloud, sheets }, { schedule, now: Date.now });
  songsUi.wire();
  // Settings a band member doesn't have: reminders, practice times, setup tools.
  for (const h of ['settings-notify', 'settings-times', 'dev'] as const) $(h).hidden = true;
  wireAccount();
  $('account').textContent += member ? ' (band member)' : ' (band access removed)';
  shell = setupShell((screen) => (sheets.closeAll(), render(), screen === 'settings' ? void bandUi.refresh() : bandUi.forget()), 'member');
  (window as unknown as { zg: unknown }).zg = { replica, songs: songsHost, tabs: tabBlobs, shell, sheets, role };
  say(member ? 'Ready (band member)' : 'Ready (band access removed)');
  if (bandNotice) say(bandNotice);
  setupInstall(member !== null);
  const synced = await syncNow().then(() => true, (e) => (say(`Offline: ${(e as Error).message}`), false));
  if (synced && member) {
    const zone = adoptDeviceTimeZone(replica.library, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (zone) await record(zone);
  }
  setInterval(render, 30_000);
  // Removal is checked on every sync; a minute's check catches it while the app sits open.
  if (member) setInterval(() => void syncNow().catch(() => undefined), 60_000);
}

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
  // The objectives popups: Start (or any close) moves into the page's deck; the page's button opens them again.
  $('today-start').onclick = () => sheets.close('objectives');
  $('teach-start').onclick = () => sheets.close('teach-objectives');
  sheets.onClose('objectives', () => enterDeck('today'));
  sheets.onClose('teach-objectives', () => enterDeck('teach'));
  $('today-objectives').onclick = () => (renderHome(), sheets.open('objectives'));
  $('teach-objectives').onclick = () => (renderTeach(), sheets.open('teach-objectives'));
  // Teach's deck: Show answer and the four ratings for its Q/A cards (multiple choice answers itself).
  $('teach-reveal').onclick = () => ((teachRevealed = true), renderTeach());
  for (const rating of RATINGS as readonly Rating[]) {
    $(`teach-r-${rating}`).onclick = async () => {
      const cardId = $('teach-card').dataset.card!;
      const started = Number($('teach-card').dataset.started ?? Date.now());
      teachRevealed = false;
      await theoryUi.rate(cardId, rating, Math.max(0, Date.now() - started), 'teach');
      $('teach-card').dataset.started = String(Date.now());
      await afterChange();
    };
  }
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
  wireAccount();
}

/** Account, sign-in, sync and backup: the same for owners and band members. */
function wireAccount() {
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
  bandUi.wire();
}

async function main() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  const invite = takeInviteFromUrl();
  await connect().catch((e) => say(`Supabase: ${(e as Error).message}`));
  if (invite) {
    // Signed in already: this account is not new, so it can't join. Signed out: kept for the sign-in.
    if (client) bandNotice = 'This device is already signed in. A band invite is for a new account: sign out, then open the invite link again.';
    else localStorage.setItem(INVITE_KEY, invite);
  }
  const inviteFailed = client ? await settleRole() : null;
  if (role.role !== 'owner') return startMember();
  replica = await Replica.open(await indexedDbStore(userId), deviceId);
  deck = createHost(replica, TEST_DECK);
  const seeded = await runModule(deck, () => seedTestDeck(deck));
  metronome = setupMetronome(replica, createHost(replica, METRONOME), say, afterChange);
  await metronome.init();
  songsHost = createHost(replica, SONGS);
  sheets = setupSheets();
  bandUi = setupBand({ client: () => client, role: () => role, appUrl: () => location.origin + location.pathname, sheets, say });
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
  goalsUi = setupGoals(replica, songsHost, record, say, () => {
    sheets.close('goal-new');
    // The first goal, asked for at launch: now Home opens with its objectives.
    if (firstGoalPending) {
      firstGoalPending = false;
      introduced.delete('today');
      shell.go('today');
    }
  });
  theoryHost = createHost(replica, THEORY);
  const dayStart = () => replica.library.settings.dayStart;
  const theorySeeded = await runModule(theoryHost, () => seedTheory(theoryHost, dayStart()));
  if (!theorySeeded.ok) say(`Theory cards failed: ${theorySeeded.error}`);
  theoryUi = setupTheory(theoryHost, say, afterChange, dayStart);
  wire();
  $('card').dataset.started = String(Date.now());
  $('teach-card').dataset.started = String(Date.now());
  // Signed out but able to sign in: ask straight away (Blake, 2026-11-02), on top of the first popup. "Not now" keeps this device only.
  signInPending = signedOut;
  // An invite waiting for its person to sign in (or one the server just refused): say so in the popup.
  $('signin-invite').hidden = !localStorage.getItem(INVITE_KEY);
  if (inviteFailed) $('signin-note').textContent = inviteFailed;
  say(seeded.ok ? `Ready (${userId === 'local' ? 'this device only' : 'synced account'})` : `Test deck failed: ${seeded.error}`);
  if (inviteFailed) say(inviteFailed);
  if (bandNotice) say(bandNotice);
  // Opening on Home with no goal yet: Goals instead, with the new-goal sheet (no extra history entry).
  if (startScreen(location.hash).screen === 'today' && !focusGoal(replica.library, practiceDay(Date.now(), replica.library.settings.dayStart))) {
    history.replaceState(null, '', hashOf('goals'));
    introduced.add('today');
    goalSheetOnArrival = firstGoalPending = true;
  }
  // Leaving a screen closes its sheets (a modal left open on a hidden screen would block the page); arriving may open a page's popup.
  shell = setupShell((screen) => (sheets.closeAll(), render(), screen === 'settings' ? void bandUi.refresh() : bandUi.forget(), arrive(screen)));
  // Swipe between Home and Teach (touch and trackpad); the page dots do the same.
  setupSwipe(
    $('screens'),
    () => !isPage(shell.current()) || sheets.anyOpen() || shell.menuOpen(),
    (swipe) => {
      const to = pageAfter(shell.current(), swipe);
      if (to) shell.go(to);
    },
  );
  (window as unknown as { zg: unknown }).zg = { replica, deck, metronome, songs: songsHost, tabs: tabBlobs, ear: { host: earHost, ui: earUi }, recorder: { host: recHost, ui: recorder }, theory: { host: theoryHost, content: (id: string) => contentOf(theoryHost, id) }, shell, sheets };
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
