/**
 * Every element the code relies on, by its fixed data-zg attribute. Code
 * finds elements ONLY through these hooks (never ids, classes or structure),
 * so the theme can restyle freely. Renaming or removing a hook in the HTML
 * fails test/hooks.test.ts. See docs/THEME.md.
 */

export const MX_NUMBER_FIELDS = ['bpm', 'beatsPerBar', 'beatUnit', 'subdivision', 'accentHz', 'beatHz', 'master', 'countInBars', 'targetBpm', 'stepBpm', 'everyBars', 'playBars', 'muteBars', 'repBars'] as const;
export const MX_TEXT_FIELDS = ['groove', 'sound', 'workout'] as const;
export const MX_VOICES = ['kick', 'snare', 'rim', 'hihat', 'hihatOpen', 'ride', 'beep'] as const;
export const RATINGS = ['again', 'hard', 'good', 'easy'] as const;

const STATIC = [
  // practice now
  'status', 'session', 'card', 'question', 'answer', 'reveal', 'practice', 'rate', 'blocks', 'played',
  // metronome
  'metronome', 'mx-position', 'mx-exercise', 'mx-new', 'mx-add', 'mx-start', 'mx-tap', 'mx-allowDuringQuietHours',
  'mx-result', 'mx-summary', 'mx-clean', 'mx-sloppy', 'mx-skip',
  // notifications, settings, account, backup
  'notify-all', 'notify-windows', 'enable-push', 'use-zone', 'settings', 'save-settings',
  'account', 'connection', 'cfg-url', 'cfg-key', 'cfg-vapid', 'save-config', 'email', 'sign-in', 'code', 'verify', 'sign-out', 'sync',
  'export', 'import',
] as const;

export type MxField = (typeof MX_NUMBER_FIELDS)[number] | (typeof MX_TEXT_FIELDS)[number];
export type Hook =
  | (typeof STATIC)[number]
  | `mx-${MxField}`
  | `mx-vol-${(typeof MX_VOICES)[number]}`
  | `r-${(typeof RATINGS)[number]}`;

/** Hooks that must each appear exactly once in index.html. */
export const HOOKS: readonly Hook[] = [
  ...STATIC,
  ...MX_NUMBER_FIELDS.map((f) => `mx-${f}` as const),
  ...MX_TEXT_FIELDS.map((f) => `mx-${f}` as const),
  ...MX_VOICES.map((v) => `mx-vol-${v}` as const),
  ...RATINGS.map((r) => `r-${r}` as const),
];

/** Hooks the code puts on elements it creates (lists, per-row buttons). */
export const CREATED_HOOKS = ['block', 'block-done', 'block-ladder', 'notify-window'] as const;

/** Finds a hooked element; throws if it is missing, so a broken page fails loudly. */
export function hook<T extends HTMLElement = HTMLInputElement>(name: Hook, root: ParentNode = document): T {
  const el = root.querySelector<T>(`[data-zg="${name}"]`);
  if (!el) throw new Error(`missing element [data-zg="${name}"]`);
  return el;
}
