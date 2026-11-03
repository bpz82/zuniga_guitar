/**
 * App shell routing (Blake, 2026-10-31): one screen at a time, chosen by the
 * URL hash ("#/songs"), so the phone's back and forward buttons work and a
 * screen can be linked to. Pure functions only; the DOM side is shell.ts.
 *
 * Home (Blake, 2026-11-02 and 2026-11-03): the screen "today" is Home. On app
 * open it shows only a popup of today's objectives, then moves into the day's
 * deck. Opening the app with no hash always shows Home. (Superseded: the last
 * tab was remembered for the practice day, 2026-10-31.)
 *
 * Teach (Blake, 2026-11-03): the curriculum's daily page, beside Home. Swipe
 * between the two (PAGES, left to right) or use the page dots.
 */
export const TABS = ['today', 'teach', 'songs', 'ear', 'record', 'goals', 'cards'] as const;
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

// ------------------------------------------------ navigation (2026-11-03) --

/**
 * One menu button in the top corner (Blake, 2026-11-03) replaces the bottom
 * tab bar and the laptop side nav. Its list, top to bottom: Home, Teach,
 * Record, Songs, Ear training, Goals, Cards, Settings. (Superseded: the
 * five-slot bar and its More sheet, 2026-11-01.)
 */
export const MENU = ['today', 'teach', 'record', 'songs', 'ear', 'goals', 'cards', 'settings'] as const;
/** The menu's label for each screen. */
export const MENU_LABEL: Readonly<Record<Screen, string>> = {
  today: 'Home',
  teach: 'Teach',
  record: 'Record',
  songs: 'Songs',
  ear: 'Ear training',
  goals: 'Goals',
  cards: 'Cards',
  settings: 'Settings',
};

/** The swipeable pages, left to right: Home, then Teach. */
export const PAGES = ['today', 'teach'] as const;
export type Page = (typeof PAGES)[number];
export const isPage = (screen: Screen): screen is Page => (PAGES as readonly string[]).includes(screen);

/**
 * The page a horizontal swipe leads to. A swipe to the left (finger moving
 * left, like turning a page) shows the page on the right; to the right, the
 * page on the left. Null at either end, or off the pages.
 */
export function pageAfter(screen: Screen, swipe: 'left' | 'right'): Page | null {
  if (!isPage(screen)) return null;
  const i = PAGES.indexOf(screen) + (swipe === 'left' ? 1 : -1);
  return PAGES[i] ?? null;
}

/** Menu items that show a due-count badge: Home (due in the session open now) and Cards (theory cards due today). */
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
 * popup (shown at launch when signed out), the tab viewer (from a song's
 * row or the song being practised), and (2026-11-03) the objectives popups
 * that open Home and Teach. Hooks `sheet-<name>` and `close-<name>`.
 */
export const APP_SHEETS = ['signin', 'songtab', 'objectives', 'teach-objectives'] as const;
export type SheetName = (typeof SHEETS)[number] | (typeof APP_SHEETS)[number];
