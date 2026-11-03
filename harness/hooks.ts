/**
 * Every element the code relies on, by its fixed data-zg attribute. Code
 * finds elements ONLY through these hooks (never ids, classes or structure),
 * so the theme can restyle freely. Renaming or removing a hook in the HTML
 * fails test/hooks.test.ts. See docs/THEME.md.
 */
import { APP_SHEETS, BADGED, PAGES, SCREENS, SHEETS, TABS } from './routes.ts';

export const MX_NUMBER_FIELDS = ['bpm', 'beatsPerBar', 'beatUnit', 'subdivision', 'accentHz', 'beatHz', 'master', 'countInBars', 'targetBpm', 'stepBpm', 'everyBars', 'playBars', 'muteBars', 'repBars'] as const;
export const MX_TEXT_FIELDS = ['groove', 'sound', 'workout'] as const;
export const MX_VOICES = ['kick', 'snare', 'rim', 'hihat', 'hihatOpen', 'ride', 'beep'] as const;
export const RATINGS = ['again', 'hard', 'good', 'easy'] as const;

const STATIC = [
  // app shell (2026-10-31): screens and menu items are generated below from routes.ts
  'shell', 'topbar', 'nav', 'screens', 'dev',
  // the menu (2026-11-03): one button in the top corner and its list (the More sheet's button and sheet, renamed);
  // badges and the page dots are generated below
  'menu', 'menu-list', 'menu-settings', 'pager',
  // layout redesign (2026-11-01): cards that need a name of their own; sheets are generated below
  'today-plan', 'now', 'plan', 'mx-display', 'songs-archive', 'takes-archive', 'ear-stage', 'rec-stage',
  // Home's objectives popup (2026-11-03; the goal and breakdown of 2026-11-02, moved into it)
  'today', 'today-now', 'today-start', 'today-blocks', 'today-reminder',
  'goal-focus', 'goal-focus-when', 'goal-focus-why', 'goal-focus-link',
  // Home: the deck (2026-11-03)
  'home', 'home-goal', 'today-objectives',
  // Teach (2026-11-03): the reading (moved from Today), the lesson deck, its objectives popup
  'teach', 'teach-progress', 'teach-objectives', 'lesson', 'lesson-reading', 'lesson-title', 'lesson-text',
  'teach-deck', 'teach-status', 'teach-card', 'teach-question', 'teach-answer', 'teach-choices', 'teach-feedback', 'teach-reveal', 'teach-rate',
  'teach-chapter', 'teach-lesson', 'teach-goals', 'teach-start',
  // settings: quiet hours
  'quiet-start', 'quiet-end', 'save-quiet',
  // practice now
  'status', 'session', 'card', 'question', 'answer', 'reveal', 'practice', 'rate', 'blocks', 'played',
  'mc-choices', 'card-feedback', 'card-tab',
  // theory and physics: the curriculum (2026-11-02)
  'theory', 'theory-lessons', 'theory-extras', 'theory-extras-label',
  // goals
  'goals', 'goals-list', 'goal-kind', 'goal-what', 'goal-why', 'goal-deadline', 'goal-songs', 'goal-tasks', 'goal-write-minutes', 'goal-write-takes',
  'goal-write-prompt', 'goal-improv-takes', 'goal-improv-minutes', 'goal-improv-ramp-to', 'goal-improv-ramp-days', 'goal-feel', 'goal-recall',
  'goal-minutes', 'goal-memo', 'goal-save',
  // recorder and takes
  'recorder', 'rec-status', 'rec-timer', 'rec-title', 'rec-start', 'rec-stop', 'improv-prompt', 'improv-takes', 'improv-minutes', 'improv-start',
  'take-player', 'takes-list', 'takes-archived',
  // ear training
  'ear', 'ear-level', 'ear-prompt', 'ear-play', 'ear-choices', 'ear-tap', 'ear-feedback', 'ear-resolve', 'ear-next', 'ear-unlock',
  // songs I already know; baseline ratings and tabs (2026-11-02)
  'songs', 'songs-new', 'songs-add', 'songs-paste', 'songs-paste-add', 'songs-list', 'songs-archived',
  'songs-baseline', 'baseline-status', 'baseline-list', 'songtab-file', 'songtab-title', 'songtab-view', 'songtab-open',
  // metronome
  'metronome', 'mx-position', 'mx-exercise', 'mx-new', 'mx-add', 'mx-start', 'mx-tap', 'mx-allowDuringQuietHours',
  'mx-result', 'mx-summary', 'mx-clean', 'mx-sloppy', 'mx-skip', 'mx-note', 'mx-anyway',
  // notifications, settings, account, backup
  'notify-all', 'notify-morning-always', 'notify-windows', 'enable-push', 'use-zone', 'settings', 'save-settings',
  'account', 'connection', 'cfg-url', 'cfg-key', 'cfg-vapid', 'save-config', 'email', 'sign-in', 'code', 'verify', 'sign-out', 'sync',
  // the sign-in popup (2026-11-02): email, sign-in, code and verify live in it
  'open-signin', 'signin-note', 'signin-later',
  'export', 'import',
] as const;

export type MxField = (typeof MX_NUMBER_FIELDS)[number] | (typeof MX_TEXT_FIELDS)[number];
export type Hook =
  | (typeof STATIC)[number]
  | `tab-${(typeof TABS)[number]}`
  | `screen-${(typeof SCREENS)[number]}`
  | `nav-badge-${(typeof BADGED)[number]}`
  | `sheet-${(typeof SHEETS)[number]}`
  | `open-${(typeof SHEETS)[number]}`
  | `close-${(typeof SHEETS)[number]}`
  | `sheet-${(typeof APP_SHEETS)[number]}`
  | `close-${(typeof APP_SHEETS)[number]}`
  | `mx-${MxField}`
  | `mx-vol-${(typeof MX_VOICES)[number]}`
  | `r-${(typeof RATINGS)[number]}`
  | `teach-r-${(typeof RATINGS)[number]}`
  | `pager-${(typeof PAGES)[number]}`;

/** Hooks that must each appear exactly once in index.html. */
export const HOOKS: readonly Hook[] = [
  ...STATIC,
  ...TABS.map((t) => `tab-${t}` as const),
  ...SCREENS.map((s) => `screen-${s}` as const),
  ...BADGED.map((b) => `nav-badge-${b}` as const),
  ...SHEETS.flatMap((s) => [`sheet-${s}` as const, `open-${s}` as const, `close-${s}` as const]),
  ...APP_SHEETS.flatMap((s) => [`sheet-${s}` as const, `close-${s}` as const]),
  ...MX_NUMBER_FIELDS.map((f) => `mx-${f}` as const),
  ...MX_TEXT_FIELDS.map((f) => `mx-${f}` as const),
  ...MX_VOICES.map((v) => `mx-vol-${v}` as const),
  ...RATINGS.map((r) => `r-${r}` as const),
  ...RATINGS.map((r) => `teach-r-${r}` as const),
  ...PAGES.map((p) => `pager-${p}` as const),
];

/** Hooks the code puts on elements it creates (lists, per-row buttons). */
export const CREATED_HOOKS = ['block', 'block-done', 'block-ladder', 'notify-window', 'song', 'song-rename', 'song-archive', 'song-restore', 'ear-choice', 'take', 'take-play', 'take-rename', 'take-archive', 'take-restore', 'goal-song', 'goal', 'goal-checkin', 'goal-checkin-save', 'goal-archive', 'block-record', 'mc-choice', 'today-block',
  // 2026-11-02: the lesson row in today's breakdown, curriculum lessons, baseline ratings, song tabs
  'today-lesson', 'theory-chapter', 'theory-lesson', 'baseline-song', 'baseline-rate', 'song-tab', 'song-tab-attach', 'songtab-content',
  // 2026-11-03: objectives bullets (Home and Teach); the Teach deck's multiple-choice options
  'today-objective', 'teach-objective', 'teach-choice'] as const;

/** Finds a hooked element; throws if it is missing, so a broken page fails loudly. */
export function hook<T extends HTMLElement = HTMLInputElement>(name: Hook, root: ParentNode = document): T {
  const el = root.querySelector<T>(`[data-zg="${name}"]`);
  if (!el) throw new Error(`missing element [data-zg="${name}"]`);
  return el;
}
