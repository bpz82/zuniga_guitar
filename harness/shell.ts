/**
 * The app shell's DOM side (Blake, 2026-10-31): shows exactly one screen,
 * marks the active menu item (aria-current="page") and follows the URL hash
 * so back and forward work. Opening the app with no hash shows Home.
 * 2026-11-03: one menu button in the top corner replaces the tab bar and the
 * side nav; the page dots under it switch between Home and Teach. Structure
 * only: the look is the theme's job.
 * 2026-11-03 (band members): a band member's menu lists only Songs and
 * Settings, and a link to any other screen goes back to where he was.
 */
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';
import { hashOf, isPage, MENU, PAGES, SCREENS, screenFor, screensFor, startScreen } from './routes.ts';
import type { Role, Screen } from './routes.ts';

export interface Shell {
  /** Moves to a screen (adds a history entry, so Back returns). */
  go(screen: Screen): void;
  current(): Screen;
  /** Whether the menu's list is open. */
  menuOpen(): boolean;
}

/** The menu item that opens a screen. */
const menuHook = (screen: Screen) => (screen === 'settings' ? 'menu-settings' : `tab-${screen}`) as Hook;

/** Starts routing for a role. `onShow` runs after each change of screen. */
export function setupShell(onShow: (screen: Screen) => void = () => undefined, role: Role = 'owner'): Shell {
  const allowed = screensFor(role);
  const menu = MENU.filter((m) => allowed.includes(m));
  let current: Screen = startScreen('', role).screen;
  // Menu items for screens this role can't reach are not offered at all.
  for (const m of MENU) hook<HTMLElement>(menuHook(m)).hidden = !allowed.includes(m);

  // ---- the menu (2026-11-03; the More sheet's logic, 2026-11-01) ----
  // A disclosure: the button's aria-expanded and the list's data-open say
  // whether it is open. It closes on any navigation, a tap outside it, a tap
  // on one of its links, Escape (focus back to the button), or keyboard focus
  // moving elsewhere.
  const more = hook<HTMLButtonElement>('menu');
  const sheet = hook<HTMLElement>('menu-list');
  const isOpen = () => more.getAttribute('aria-expanded') === 'true';
  const setOpen = (open: boolean) => {
    more.setAttribute('aria-expanded', String(open));
    sheet.toggleAttribute('data-open', open);
  };
  more.addEventListener('click', () => {
    setOpen(!isOpen());
    if (isOpen()) hook<HTMLElement>(menuHook(menu[0]!)).focus();
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
    const mark = (el: HTMLElement, on: boolean) => (on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'));
    for (const m of menu) mark(hook<HTMLElement>(menuHook(m)), m === screen);
    // The page dots: shown on Home and Teach only, the current page marked.
    hook<HTMLElement>('pager').hidden = !isPage(screen);
    for (const p of PAGES) mark(hook<HTMLElement>(`pager-${p}` as Hook), p === screen);
    onShow(screen);
  };

  window.addEventListener('hashchange', () => {
    const screen = screenFor(location.hash, role);
    if (screen) show(screen);
    else location.replace(hashOf(current)); // a bad link, or a screen this role can't see: stay where we are, no extra history entry
  });

  const start = startScreen(location.hash, role);
  if (start.replace) history.replaceState(null, '', hashOf(start.screen));
  show(start.screen);

  return {
    go(screen) {
      if (screen === current || !allowed.includes(screen)) return;
      location.hash = hashOf(screen); // hashchange shows it
    },
    current: () => current,
    menuOpen: isOpen,
  };
}
