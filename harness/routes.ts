/**
 * App shell routing (Blake, 2026-10-31): one screen at a time, chosen by the
 * URL hash ("#/songs"), so the phone's back and forward buttons work and a
 * screen can be linked to. Pure functions only; the DOM side is shell.ts.
 *
 * Single-page flow (Blake, 2026-11-02): Today is the app. It opens with the
 * current goal, then today's breakdown, then today's lesson (what used to be
 * the Practice screen, now part of Today). Opening the app with no hash
 * always shows Today, so the goal comes first. (Superseded: the last tab was
 * remembered for the practice day, 2026-10-31.)
 */
export const TABS = ['today', 'songs', 'ear', 'record', 'goals', 'cards'] as const;
export type Tab = (typeof TABS)[number];
/** Every screen: the tabs, plus Settings behind the gear. */
export const SCREENS = [...TABS, 'settings'] as const;
export type Screen = (typeof SCREENS)[number];

export const DEFAULT_SCREEN: Screen = 'today';

export const hashOf = (screen: Screen) => `#/${screen}`;

/** "#/ear" -> "ear". Anything else (empty, unknown, malformed) -> null. */
export function parseHash(hash: string): Screen | null {
  const m = /^#\/([a-z]+)\/?$/.exec(String(hash));
  const name = m?.[1];
  return name !== undefined && (SCREENS as readonly string[]).includes(name) ? (name as Screen) : null;
}

/**
 * The screen to open at launch. A valid hash wins (a link or a reload).
 * Otherwise Today, the goal-first page. `replace`: the URL should be
 * rewritten (without adding a history entry).
 */
export function startScreen(hash: string): { screen: Screen; replace: boolean } {
  const fromHash = parseHash(hash);
  if (fromHash) return { screen: fromHash, replace: false };
  return { screen: DEFAULT_SCREEN, replace: true };
}

// ------------------------------------------------ navigation (2026-11-01) --

/**
 * The phone's bottom bar, left to right, social-app style: Record is the
 * larger centre action; More opens a sheet with the rest. From 800px the
 * side nav shows everything (the More button is not needed there).
 * 2026-11-02: Practice merged into Today; Goals takes its slot.
 */
export const BAR = ['today', 'goals', 'record', 'songs', 'more'] as const;
/** In the More sheet on phones, in the side nav on laptops. */
export const MORE = ['ear', 'cards', 'settings'] as const;
export type MoreScreen = (typeof MORE)[number];
export const inMore = (screen: Screen): screen is MoreScreen => (MORE as readonly string[]).includes(screen);

/** Tabs that show a due-count badge: Today (due in the session open now) and Cards (theory cards due today). */
export const BADGED = ['today', 'cards'] as const;
export const MAX_BADGE = 99;

/** A badge's text: nothing when none are due, "99+" past the cap. */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > MAX_BADGE ? `${MAX_BADGE}+` : String(Math.floor(count));
}

// ---------------------------------------------------- sheets (2026-11-01) --

/**
 * Bottom sheets (native <dialog>s) holding the long forms, so each screen
 * keeps one primary action: metronome settings (in today's lesson), paste a
 * song list (Songs), improv settings (Record), a new goal (Goals). Each has
 * hooks `sheet-<name>` (the dialog), `open-<name>` and `close-<name>` (buttons).
 */
export const SHEETS = ['mx-settings', 'songs-paste', 'improv', 'goal-new'] as const;
/**
 * Sheets that belong to the whole app rather than one screen (2026-11-02),
 * so they sit outside the screens and the code opens them: the sign-in
 * popup (shown at launch when signed out) and the tab viewer (from a song's
 * row or the song being practised). Hooks `sheet-<name>` and `close-<name>`.
 */
export const APP_SHEETS = ['signin', 'songtab'] as const;
export type SheetName = (typeof SHEETS)[number] | (typeof APP_SHEETS)[number];
