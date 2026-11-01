/**
 * App shell routing (Blake, 2026-10-31): one screen at a time, chosen by the
 * URL hash ("#/songs"), so the phone's back and forward buttons work and a
 * screen can be linked to. Pure functions only; the DOM side is shell.ts.
 *
 * Opening the app with no hash: the last tab if it was used earlier the same
 * practice day, otherwise Today. Settings is never remembered.
 */
export const TABS = ['today', 'practice', 'songs', 'ear', 'record', 'goals', 'cards'] as const;
export type Tab = (typeof TABS)[number];
/** Every screen: the tabs, plus Settings behind the gear. */
export const SCREENS = [...TABS, 'settings'] as const;
export type Screen = (typeof SCREENS)[number];

export const DEFAULT_SCREEN: Screen = 'today';
/** localStorage key for the remembered tab. */
export const LAST_TAB_KEY = 'zg-last-tab';

export const hashOf = (screen: Screen) => `#/${screen}`;

/** "#/ear" -> "ear". Anything else (empty, unknown, malformed) -> null. */
export function parseHash(hash: string): Screen | null {
  const m = /^#\/([a-z]+)\/?$/.exec(String(hash));
  const name = m?.[1];
  return name !== undefined && (SCREENS as readonly string[]).includes(name) ? (name as Screen) : null;
}

export interface Remembered {
  readonly tab: Tab;
  /** Practice day it was used, "YYYY-MM-DD". */
  readonly day: string;
}

/** What to store after showing a screen (null: leave the stored tab alone). */
export function remember(screen: Screen, day: string): Remembered | null {
  return (TABS as readonly string[]).includes(screen) ? { tab: screen as Tab, day } : null;
}

/** Reads a stored value defensively: anything malformed counts as nothing remembered. */
export function readRemembered(raw: string | null): Remembered | null {
  try {
    const v = JSON.parse(raw ?? 'null') as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const { tab, day } = v as Record<string, unknown>;
    if (typeof tab !== 'string' || !(TABS as readonly string[]).includes(tab)) return null;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    return { tab: tab as Tab, day };
  } catch {
    return null;
  }
}

/**
 * The screen to open at launch. A valid hash wins (a link or a reload). With
 * no valid hash: the remembered tab if it is from today, else Today.
 * `replace`: the URL should be rewritten (without adding a history entry).
 */
export function startScreen(hash: string, remembered: Remembered | null, today: string): { screen: Screen; replace: boolean } {
  const fromHash = parseHash(hash);
  if (fromHash) return { screen: fromHash, replace: false };
  const screen: Screen = remembered && remembered.day === today ? remembered.tab : DEFAULT_SCREEN;
  return { screen, replace: true };
}

// ------------------------------------------------ navigation (2026-11-01) --

/**
 * The phone's bottom bar, left to right, social-app style: Record is the
 * larger centre action; More opens a sheet with the rest. From 800px the
 * side nav shows everything (the More button is not needed there).
 */
export const BAR = ['today', 'practice', 'record', 'songs', 'more'] as const;
/** In the More sheet on phones, in the side nav on laptops. */
export const MORE = ['ear', 'goals', 'cards', 'settings'] as const;
export type MoreScreen = (typeof MORE)[number];
export const inMore = (screen: Screen): screen is MoreScreen => (MORE as readonly string[]).includes(screen);

/** Tabs that show a due-count badge. */
export const BADGED = ['practice', 'cards'] as const;
export const MAX_BADGE = 99;

/** A badge's text: nothing when none are due, "99+" past the cap. */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > MAX_BADGE ? `${MAX_BADGE}+` : String(Math.floor(count));
}
