/**
 * The app shell's DOM side (Blake, 2026-10-31): shows exactly one screen,
 * marks the active tab (aria-current="page") and follows the URL hash so back
 * and forward work. Opening the app with no hash shows Today, the goal-first
 * page (2026-11-02). Structure only: the look is the theme's job.
 */
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';
import { hashOf, inMore, MORE, parseHash, SCREENS, startScreen, TABS } from './routes.ts';
import type { Screen } from './routes.ts';

export interface Shell {
  /** Moves to a screen (adds a history entry, so Back returns). */
  go(screen: Screen): void;
  current(): Screen;
  /** Whether the phone's More sheet is open. */
  moreOpen(): boolean;
}

/** Starts routing. `onShow` runs after each change of screen. */
export function setupShell(onShow: (screen: Screen) => void = () => undefined): Shell {
  let current: Screen = 'today';

  // ---- the More sheet (phones; from 800px its links sit in the side nav) ----
  // A disclosure: the button's aria-expanded and the sheet's data-open say
  // whether it is open. It closes on any navigation, a tap outside it, a tap
  // on one of its links, Escape (focus back to More), or keyboard focus
  // moving elsewhere.
  const more = hook<HTMLButtonElement>('nav-more');
  const sheet = hook<HTMLElement>('more-sheet');
  const isOpen = () => more.getAttribute('aria-expanded') === 'true';
  const setOpen = (open: boolean) => {
    more.setAttribute('aria-expanded', String(open));
    sheet.toggleAttribute('data-open', open);
  };
  more.addEventListener('click', () => {
    setOpen(!isOpen());
    if (isOpen()) hook<HTMLElement>(`tab-${MORE[0]}` as Hook).focus();
  });
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) setOpen(false); // a link (or its icon or label) was chosen
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (isOpen() && t instanceof Node && !sheet.contains(t) && !more.contains(t)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      more.focus();
    }
  });
  hook<HTMLElement>('nav').addEventListener('focusout', (e) => {
    // Only when focus moves to a known element outside (Tab key); a null target is a tap, handled above.
    const to = e.relatedTarget;
    if (isOpen() && to instanceof Node && !sheet.contains(to) && !more.contains(to)) setOpen(false);
  });

  const show = (screen: Screen) => {
    setOpen(false);
    // Screens share the page's scroll: a newly opened screen starts at the top.
    if (screen !== current) window.scrollTo(0, 0);
    current = screen;
    for (const s of SCREENS) hook<HTMLElement>(`screen-${s}` as Hook).hidden = s !== screen;
    for (const t of TABS) {
      const tab = hook<HTMLElement>(`tab-${t}` as Hook);
      if (t === screen) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    for (const name of ['gear', 'more-settings'] as const) {
      const link = hook<HTMLElement>(name);
      if (screen === 'settings') link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    // The More button marks that the screen shown lives in its sheet (not aria-current: it is a button, not the page's link).
    more.toggleAttribute('data-current', inMore(screen));
    onShow(screen);
  };

  window.addEventListener('hashchange', () => {
    const screen = parseHash(location.hash);
    if (screen) show(screen);
    else location.replace(hashOf(current)); // a bad link: stay where we are, no extra history entry
  });

  const start = startScreen(location.hash);
  if (start.replace) history.replaceState(null, '', hashOf(start.screen));
  show(start.screen);

  return {
    go(screen) {
      if (screen === current) return;
      location.hash = hashOf(screen); // hashchange shows it
    },
    current: () => current,
    moreOpen: isOpen,
  };
}
