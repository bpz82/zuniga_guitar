/**
 * Every element the code relies on, by its fixed data-zg attribute. Code
 * finds elements ONLY through these hooks (never ids, classes or structure),
 * so the theme can restyle freely. Renaming or removing a hook in the HTML
 * fails test/hooks.test.ts. See docs/THEME.md.
 */
import { BADGED, SCREENS, TABS } from './routes.ts';

export const MX_NUMBER_FIELDS = ['bpm', 'beatsPerBar', 'beatUnit', 'subdivision', 'accentHz', 'beatHz', 'master', 'countInBars', 'targetBpm', 'stepBpm', 'everyBars', 'playBars', 'muteBars', 'repBars'] as const;
export const MX_TEXT_FIELDS = ['groove', 'sound', 'workout'] as const;
export const MX_VOICES = ['kick', 'snare', 'rim', 'hihat', 'hihatOpen', 'ride', 'beep'] as const;
export const RATINGS = ['again', 'hard', 'good', 'easy'] as const;

const STATIC = [
  // app shell (2026-10-31): screens and tabs are generated below from routes.ts
  'shell', 'topbar', 'gear', 'nav', 'screens', 'dev',
  // social-style tab bar (2026-11-01): More button and its sheet; badges generated below
  'nav-more', 'more-sheet', 'more-settings',
  // today
  'today', 'today-now', 'today-start', 'today-blocks', 'today-reminder',
  // settings: quiet hours
  'quiet-start', 'quiet-end', 'save-quiet',
  // practice now
  'status', 'session', 'card', 'question', 'answer', 'reveal', 'practice', 'rate', 'blocks', 'played',
  'mc-choices', 'card-feedback', 'card-source',
  // theory and physics cards
  'theory', 'theory-topics',
  // goals
  'goals', 'goals-list', 'goal-kind', 'goal-what', 'goal-why', 'goal-deadline', 'goal-songs', 'goal-tasks', 'goal-write-minutes', 'goal-write-takes',
  'goal-write-prompt', 'goal-improv-takes', 'goal-improv-minutes', 'goal-improv-ramp-to', 'goal-improv-ramp-days', 'goal-feel', 'goal-recall',
  'goal-minutes', 'goal-memo', 'goal-save',
  // recorder and takes
  'recorder', 'rec-status', 'rec-timer', 'rec-title', 'rec-start', 'rec-stop', 'improv-prompt', 'improv-takes', 'improv-minutes', 'improv-start',
  'take-player', 'takes-list', 'takes-archived',
  // ear training
  'ear', 'ear-level', 'ear-prompt', 'ear-play', 'ear-choices', 'ear-tap', 'ear-feedback', 'ear-resolve', 'ear-next', 'ear-unlock',
  // songs I already know
  'songs', 'songs-new', 'songs-add', 'songs-paste', 'songs-paste-add', 'songs-list', 'songs-archived',
  // metronome
  'metronome', 'mx-position', 'mx-exercise', 'mx-new', 'mx-add', 'mx-start', 'mx-tap', 'mx-allowDuringQuietHours',
  'mx-result', 'mx-summary', 'mx-clean', 'mx-sloppy', 'mx-skip',
  // notifications, settings, account, backup
  'notify-all', 'notify-morning-always', 'notify-windows', 'enable-push', 'use-zone', 'settings', 'save-settings',
  'account', 'connection', 'cfg-url', 'cfg-key', 'cfg-vapid', 'save-config', 'email', 'sign-in', 'code', 'verify', 'sign-out', 'sync',
  'export', 'import',
] as const;

export type MxField = (typeof MX_NUMBER_FIELDS)[number] | (typeof MX_TEXT_FIELDS)[number];
export type Hook =
  | (typeof STATIC)[number]
  | `tab-${(typeof TABS)[number]}`
  | `screen-${(typeof SCREENS)[number]}`
  | `nav-badge-${(typeof BADGED)[number]}`
  | `mx-${MxField}`
  | `mx-vol-${(typeof MX_VOICES)[number]}`
  | `r-${(typeof RATINGS)[number]}`;

/** Hooks that must each appear exactly once in index.html. */
export const HOOKS: readonly Hook[] = [
  ...STATIC,
  ...TABS.map((t) => `tab-${t}` as const),
  ...SCREENS.map((s) => `screen-${s}` as const),
  ...BADGED.map((b) => `nav-badge-${b}` as const),
  ...MX_NUMBER_FIELDS.map((f) => `mx-${f}` as const),
  ...MX_TEXT_FIELDS.map((f) => `mx-${f}` as const),
  ...MX_VOICES.map((v) => `mx-vol-${v}` as const),
  ...RATINGS.map((r) => `r-${r}` as const),
];

/** Hooks the code puts on elements it creates (lists, per-row buttons). */
export const CREATED_HOOKS = ['block', 'block-done', 'block-ladder', 'notify-window', 'song', 'song-rename', 'song-archive', 'song-restore', 'ear-choice', 'take', 'take-play', 'take-rename', 'take-archive', 'take-restore', 'goal-song', 'goal', 'goal-checkin', 'goal-checkin-save', 'goal-archive', 'block-record', 'mc-choice', 'theory-topic', 'today-block'] as const;

/** Finds a hooked element; throws if it is missing, so a broken page fails loudly. */
export function hook<T extends HTMLElement = HTMLInputElement>(name: Hook, root: ParentNode = document): T {
  const el = root.querySelector<T>(`[data-zg="${name}"]`);
  if (!el) throw new Error(`missing element [data-zg="${name}"]`);
  return el;
}
