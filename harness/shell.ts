/**
 * The app shell's DOM side (Blake, 2026-10-31): shows exactly one screen,
 * marks the active tab (aria-current="page"), follows the URL hash so back
 * and forward work, and remembers the last tab for the practice day.
 * Structure only: the look is the theme's job.
 */
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';
import { hashOf, LAST_TAB_KEY, parseHash, readRemembered, remember, SCREENS, startScreen, TABS } from './routes.ts';
import type { Screen } from './routes.ts';

export interface Shell {
  /** Moves to a screen (adds a history entry, so Back returns). */
  go(screen: Screen): void;
  current(): Screen;
}

/**
 * Starts routing. `today()` gives the current practice day (for the
 * remembered tab); `onShow` runs after each change of screen.
 */
export function setupShell(today: () => string, onShow: (screen: Screen) => void = () => undefined): Shell {
  let current: Screen = 'today';

  const store = {
    read(): string | null {
      try {
        return localStorage.getItem(LAST_TAB_KEY);
      } catch {
        return null;
      }
    },
    write(value: string) {
      try {
        localStorage.setItem(LAST_TAB_KEY, value);
      } catch {
        // private mode or storage blocked: the shell works without memory
      }
    },
  };

  const show = (screen: Screen) => {
    // Screens share the page's scroll: a newly opened screen starts at the top.
    if (screen !== current) window.scrollTo(0, 0);
    current = screen;
    for (const s of SCREENS) hook<HTMLElement>(`screen-${s}` as Hook).hidden = s !== screen;
    for (const t of TABS) {
      const tab = hook<HTMLElement>(`tab-${t}` as Hook);
      if (t === screen) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    const gear = hook<HTMLElement>('gear');
    if (screen === 'settings') gear.setAttribute('aria-current', 'page');
    else gear.removeAttribute('aria-current');
    const r = remember(screen, today());
    if (r) store.write(JSON.stringify(r));
    onShow(screen);
  };

  window.addEventListener('hashchange', () => {
    const screen = parseHash(location.hash);
    if (screen) show(screen);
    else location.replace(hashOf(current)); // a bad link: stay where we are, no extra history entry
  });

  const start = startScreen(location.hash, readRemembered(store.read()), today());
  if (start.replace) history.replaceState(null, '', hashOf(start.screen));
  show(start.screen);

  return {
    go(screen) {
      if (screen === current) return;
      location.hash = hashOf(screen); // hashchange shows it
    },
    current: () => current,
  };
}
