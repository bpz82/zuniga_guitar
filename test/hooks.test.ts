/**
 * Design guardrails (Blake, 2026-10-31). The graphics lead edits only the
 * theme; these tests fail if a code hook goes missing or gets renamed, or if
 * behavior and styling get mixed. See docs/THEME.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { CREATED_HOOKS, HOOKS, MX_VOICES } from '../harness/hooks.ts';
import { VOICES } from '../src/modules/metronome/core.ts';

const read = (p: string) => readFileSync(p, 'utf8');
const html = read('harness/static/index.html');
const hooksIn = (text: string) => [...text.matchAll(/\sdata-zg="([^"]+)"/g)].map((m) => m[1]!); // attributes on elements, not lookup strings

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

test('every hook the code relies on is in index.html exactly once', () => {
  const found = hooksIn(html);
  for (const h of HOOKS) assert.equal(found.filter((x) => x === h).length, 1, `[data-zg="${h}"] missing or duplicated`);
});

test('index.html has no hooks the code does not know about (catches renames)', () => {
  const known = new Set<string>(HOOKS);
  const unknown = hooksIn(html).filter((h) => !known.has(h));
  assert.deepEqual(unknown, [], 'add these to harness/hooks.ts or restore their names');
});

const HARNESS_CODE = readdirSync('harness').filter((f) => f.endsWith('.ts')).map((f) => join('harness', f));

test('elements the code creates carry their hooks', () => {
  const code = HARNESS_CODE.map(read).join('\n');
  for (const h of CREATED_HOOKS) assert.ok(code.includes(`dataset.zg = '${h}'`), h);
});

test('the setup-keys page hooks are intact', () => {
  const page = read('harness/static/setup-keys.html');
  for (const h of ['key-pub', 'key-priv', 'key-cron']) {
    assert.equal(hooksIn(page).filter((x) => x === h).length, 1, h);
    assert.ok(page.includes(`[data-zg="${h}"]`), `${h} is looked up by its hook`);
  }
});

test('metronome voice hooks match the voices the engine plays', () => {
  assert.deepEqual([...MX_VOICES], [...VOICES]);
});

test('code finds elements only through hooks and never styles them', () => {
  assert.ok(HARNESS_CODE.includes(join('harness', 'songs-ui.ts')), 'every harness file is scanned');
  for (const f of [...HARNESS_CODE, ...files('src')]) {
    const code = read(f);
    for (const banned of ['getElementById', 'getElementsByClassName', ".querySelector('#", '.querySelectorAll(', '.style.', '.className', 'classList.', 'style=']) {
      assert.ok(!code.includes(banned), `${f} uses ${banned}`);
    }
  }
});

test('the theme holds only look files: no scripts, no markup, and it cannot override hiding', () => {
  const allowed = new Set(['.css', '.png', '.svg', '.webp', '.ico', '.woff2', '.woff', '.md']);
  for (const f of files('harness/static/theme')) {
    assert.ok(allowed.has(extname(f)), `${f}: only CSS, images, fonts and notes belong in the theme`);
    if (extname(f) === '.css') assert.ok(!/\[hidden\]/.test(read(f)), `${f} must not restyle [hidden] (behavior)`);
  }
  assert.ok(read('harness/static/theme/tokens.css').includes('--zg-color-'), 'tokens.css defines the design tokens');
});

test('pages load tokens, then theme, then the protected base.css; no inline styles', () => {
  for (const f of ['harness/static/index.html', 'harness/static/setup-keys.html']) {
    const page = read(f);
    const order = ['theme/tokens.css', 'theme/theme.css', 'base.css'].map((s) => page.indexOf(s));
    assert.ok(order.every((i) => i >= 0) && order[0]! < order[1]! && order[1]! < order[2]!, `${f} stylesheet order`);
    assert.ok(!/<style|style="/.test(page), `${f} has inline styling`);
  }
  assert.match(read('harness/static/base.css'), /\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/);
});

// ------------------------------------------------- app shell (2026-10-31) --

test('app shell: one container per screen; every section sits inside exactly one screen; only Today starts visible', async () => {
  const { SCREENS } = await import('../harness/routes.ts');
  const main = html.slice(html.indexOf('<main data-zg="screens">'), html.indexOf('</main>'));
  assert.ok(main.length > 0, 'screens container present');
  const opens = SCREENS.map((s) => ({ s, at: main.indexOf(`<div data-zg="screen-${s}"`) }));
  for (const o of opens) assert.ok(o.at >= 0, `screen-${o.s}`);
  const sorted = [...opens].sort((a, b) => a.at - b.at);
  // Everything with a section tag in the page lives inside <main>, in some screen.
  assert.equal(html.split('<section').length - 1, main.split('<section').length - 1, 'no section outside the screens');
  assert.ok(main.indexOf('<section') > sorted[0]!.at, 'no section before the first screen');
  for (const { s, at } of opens) {
    const tag = main.slice(at, main.indexOf('>', at) + 1);
    assert.equal(/\shidden[\s>]/.test(tag), s !== 'today', `screen-${s} starts ${s === 'today' ? 'visible' : 'hidden'}`);
  }
  // Each menu item links to its screen's hash.
  for (const s of SCREENS) {
    const hook = s === 'settings' ? 'menu-settings' : `tab-${s}`;
    assert.match(html, new RegExp(`<a href="#/${s}" data-zg="${hook}"`), hook);
  }
});

test('base.css: the protected hidden rule, then structure only, all at zero specificity so the theme wins', () => {
  const css = read('harness/static/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
  // touch-action and overscroll-behavior-x (2026-11-03) are behavior, not look: they let Home and Teach swipe.
  const STRUCTURAL = new Set(['position', 'left', 'right', 'top', 'bottom', 'z-index', 'display', 'flex', 'flex-direction', 'min-width', 'text-align', 'align-items', 'justify-content', 'gap', 'column-gap', 'grid-template-columns', 'grid-template-areas', 'grid-area', 'padding-bottom', 'background', 'touch-action', 'overscroll-behavior-x']);
  for (const { selector, body } of rules) {
    if (selector === '[hidden]') continue;
    assert.match(selector, /^:where\(/, `${selector} is wrapped in :where()`);
    for (const decl of body.split(';').map((d) => d.trim()).filter(Boolean)) {
      const [prop, value] = decl.split(':').map((x) => x.trim()) as [string, string];
      assert.ok(STRUCTURAL.has(prop), `${selector}: ${prop} is not structural`);
      if (prop === 'background') assert.ok(['Canvas', 'none'].includes(value), `${selector}: background only as a placeholder (${value})`);
    }
  }
});

// ------------------------------------------ social-style tab bar (2026-11-01) --

test('menu: one button in the top bar; its list holds Home, Teach, Record, Songs, Ear training, Goals, Cards, Settings, in that order', async () => {
  const { MENU } = await import('../harness/routes.ts');
  const top = html.slice(html.indexOf('<header data-zg="topbar">'), html.indexOf('</header>'));
  assert.ok(top.includes('<nav data-zg="nav"'), 'the menu lives in the top bar');
  const list = top.slice(top.indexOf('data-zg="menu-list"'));
  const items = MENU.map((m) => (m === 'settings' ? 'menu-settings' : `tab-${m}`));
  for (let i = 0; i < items.length; i++) {
    assert.ok(list.includes(`data-zg="${items[i]}"`), `${items[i]} is in the list`);
    if (i > 0) assert.ok(list.indexOf(`data-zg="${items[i - 1]}"`) < list.indexOf(`data-zg="${items[i]}"`));
  }
  assert.equal((top.match(/<button /g) ?? []).length, 1, 'one button: the menu');
  // Removed 2026-11-03: the bottom tab bar, its More sheet, the side nav, the gear.
  for (const gone of ['nav-more', 'more-sheet', 'more-settings', 'gear']) assert.ok(!html.includes(`data-zg="${gone}"`), gone);
  assert.ok(!html.slice(html.indexOf('</header>')).includes('data-zg="tab-'), 'no tab links outside the menu');
});

test('menu: the button is a disclosure for its list, closed at load', () => {
  const button = /<button ([^>]*)data-zg="menu"([^>]*)>/.exec(html);
  assert.ok(button, 'Menu is a button');
  const attrs = button![0];
  assert.match(attrs, /type="button"/);
  assert.match(attrs, /aria-expanded="false"/);
  const controls = /aria-controls="([^"]+)"/.exec(attrs)?.[1];
  assert.ok(controls && new RegExp(`<div id="${controls}" data-zg="menu-list">`).test(html), 'aria-controls names the list');
  assert.ok(!/data-zg="menu-list"[^>]*data-open/.test(html), 'the list starts closed');
});

test('menu: every item is an inline SVG icon (currentColor, hidden from screen readers) plus a short label', () => {
  const nav = html.slice(html.indexOf('<nav data-zg="nav"'), html.indexOf('</nav>'));
  const items = [...nav.matchAll(/<(a|button) [^>]*data-zg="(tab-[a-z]+|menu|menu-settings)"[^>]*>([\s\S]*?)<\/\1>/g)];
  assert.equal(items.length, 9, 'Menu, then Home, Teach, Record, Songs, Ear training, Goals, Cards, Settings');
  for (const [, , hook, inner] of items) {
    const svg = /^<svg ([^>]*)>/.exec(inner!);
    assert.ok(svg, `${hook} starts with its icon`);
    assert.match(svg![1]!, /stroke="currentColor"/, `${hook} icon follows the text colour`);
    assert.match(svg![1]!, /aria-hidden="true"/, hook!);
    assert.match(svg![1]!, /focusable="false"/, hook!);
    assert.ok(!/fill="#|stroke="#|fill="rgb|stroke="rgb/.test(inner!), `${hook}: no hard-coded colours`);
    const label = /<\/svg><span>([^<]+)<\/span>/.exec(inner!)?.[1];
    assert.ok(label && label.length <= 12, `${hook} has a short label (${label})`);
  }
});

test('menu: due-count badges sit inside Home and Cards in the list, hidden until something is due', async () => {
  const { BADGED } = await import('../harness/routes.ts');
  const list = html.slice(html.indexOf('data-zg="menu-list"'), html.indexOf('</nav>'));
  for (const b of BADGED) {
    const link = new RegExp(`data-zg="tab-${b}">[\\s\\S]*?</a>`).exec(list)?.[0] ?? '';
    assert.match(link, new RegExp(`<span data-zg="nav-badge-${b}" aria-hidden="true" hidden></span></a>$`), b);
  }
});

test('page dots: Home and Teach links, under the top bar, hidden until a page shows', async () => {
  const { PAGES } = await import('../harness/routes.ts');
  const pager = html.slice(html.indexOf('<nav data-zg="pager"'), html.indexOf('</nav>', html.indexOf('<nav data-zg="pager"')));
  assert.match(pager, /^<nav data-zg="pager" aria-label="[^"]+" hidden>/);
  for (const p of PAGES) assert.match(pager, new RegExp(`<a href="#/${p}" data-zg="pager-${p}">`));
  assert.ok(html.indexOf('data-zg="pager"') > html.indexOf('</header>') && html.indexOf('data-zg="pager"') < html.indexOf('<main'));
});

// --------------------------------------------- layout redesign (2026-11-01) --

test('sheets: each is a labelled dialog in its own screen, closed at load, with its close button inside and its open button outside', async () => {
  const { SHEETS, SCREENS, APP_SHEETS } = await import('../harness/routes.ts');
  for (const name of SHEETS) {
    const open = html.indexOf(`<dialog data-zg="sheet-${name}"`);
    assert.ok(open >= 0, `sheet-${name} is a <dialog>`);
    const tag = html.slice(open, html.indexOf('>', open) + 1);
    assert.ok(!/\sopen[\s>]/.test(tag), `sheet-${name} starts closed`);
    const label = /aria-labelledby="([^"]+)"/.exec(tag)?.[1];
    const body = html.slice(open, html.indexOf('</dialog>', open));
    assert.ok(label && body.includes(`<h2 id="${label}">`), `sheet-${name} is labelled by its heading`);
    assert.ok(body.includes(`data-zg="close-${name}"`), `close-${name} is inside the sheet`);
    assert.ok(!body.includes(`data-zg="open-${name}"`), `open-${name} is outside the sheet`);
    // Same screen: the nearest screen opened before each.
    const screenOf = (at: number) => SCREENS.map((s) => ({ s, i: html.lastIndexOf(`data-zg="screen-${s}"`, at) })).sort((a, b) => b.i - a.i)[0]!.s;
    assert.equal(screenOf(html.indexOf(`data-zg="open-${name}"`)), screenOf(open), `open-${name} and its sheet share a screen`);
  }
  // App sheets (sign-in, tab viewer): labelled dialogs outside every screen, closed at load, close button inside.
  const main = [html.indexOf('<main data-zg="screens">'), html.indexOf('</main>')] as const;
  for (const name of APP_SHEETS) {
    const open = html.indexOf(`<dialog data-zg="sheet-${name}"`);
    assert.ok(open >= 0, `sheet-${name} is a <dialog>`);
    assert.ok(open > main[1] || open < main[0], `sheet-${name} sits outside the screens`);
    const tag = html.slice(open, html.indexOf('>', open) + 1);
    assert.ok(!/\sopen[\s>]/.test(tag), `sheet-${name} starts closed`);
    const label = /aria-labelledby="([^"]+)"/.exec(tag)?.[1];
    const body = html.slice(open, html.indexOf('</dialog>', open));
    assert.ok(label && new RegExp(`<h2 id="${label}"`).test(body), `sheet-${name} is labelled by its heading`);
    assert.ok(body.includes(`data-zg="close-${name}"`), `close-${name} is inside the sheet`);
  }
  assert.equal(html.split('<dialog').length - 1, SHEETS.length + APP_SHEETS.length, 'no other dialogs');
  // Sign-in fields live in the sign-in popup.
  const signin = html.slice(html.indexOf('<dialog data-zg="sheet-signin"'), html.indexOf('</dialog>', html.indexOf('<dialog data-zg="sheet-signin"')));
  for (const h of ['email', 'sign-in', 'code', 'verify', 'signin-note', 'signin-later']) assert.ok(signin.includes(`data-zg="${h}"`), `${h} is in the sign-in popup`);
});

test('Home is the deck: what it works toward and the popup again, then cards and songs, goal tasks, metronome', () => {
  const home = html.slice(html.indexOf('<div data-zg="screen-today">'), html.indexOf('<div data-zg="screen-teach"'));
  const order = ['home', 'home-goal', 'today-objectives', 'now', 'card', 'plan', 'blocks', 'metronome', 'mx-start', 'mx-note'];
  const at = order.map((h) => home.indexOf(`data-zg="${h}"`));
  at.forEach((i, k) => assert.ok(i >= 0, `${order[k]} is on Home`));
  for (let k = 1; k < at.length; k++) assert.ok(at[k - 1]! < at[k]!, `${order[k - 1]} before ${order[k]}`);
  assert.ok(!html.includes('data-zg="card-source"'), 'no sources on the cards (Blake, 2026-11-02)');
});

test("Home's objectives popup holds the goal, the session, the bullets and Start; Teach's holds the chapter, the lesson, the bullets and Start", () => {
  const popup = (name: string) => html.slice(html.indexOf(`<dialog data-zg="sheet-${name}"`), html.indexOf('</dialog>', html.indexOf(`<dialog data-zg="sheet-${name}"`)));
  const home = popup('objectives');
  const order = ['close-objectives', 'today', 'goal-focus', 'goal-focus-when', 'goal-focus-why', 'goal-focus-link', 'today-plan', 'today-now', 'today-blocks', 'today-reminder', 'today-start'];
  for (let k = 1; k < order.length; k++) assert.ok(home.indexOf(`data-zg="${order[k - 1]}"`) < home.indexOf(`data-zg="${order[k]}"`), `${order[k - 1]} before ${order[k]}`);
  assert.match(home, /<ul data-zg="today-blocks"><\/ul>/, 'the objectives are a bullet list');
  const teach = popup('teach-objectives');
  const torder = ['close-teach-objectives', 'teach-chapter', 'teach-lesson', 'teach-goals', 'teach-start'];
  for (let k = 1; k < torder.length; k++) assert.ok(teach.indexOf(`data-zg="${torder[k - 1]}"`) < teach.indexOf(`data-zg="${torder[k]}"`), `${torder[k - 1]} before ${torder[k]}`);
  assert.match(teach, /<ul data-zg="teach-goals"><\/ul>/);
  for (const start of ['today-start', 'teach-start']) assert.match(html, new RegExp(`data-zg="${start}" autofocus>Start<`), `${start} takes the focus`);
});

test('Teach: the heading and the popup again, then the reading, then the lesson deck with its own card', () => {
  const teach = html.slice(html.indexOf('<div data-zg="screen-teach"'), html.indexOf('<div data-zg="screen-songs"'));
  const order = ['teach', 'teach-progress', 'teach-objectives', 'lesson', 'lesson-reading', 'lesson-title', 'lesson-text', 'teach-deck', 'teach-status', 'teach-card', 'teach-question', 'teach-answer', 'teach-choices', 'teach-feedback', 'teach-reveal', 'teach-rate', 'teach-r-again', 'teach-r-easy'];
  const at = order.map((h) => teach.indexOf(`data-zg="${h}"`));
  at.forEach((i, k) => assert.ok(i >= 0, `${order[k]} is on Teach`));
  for (let k = 1; k < at.length; k++) assert.ok(at[k - 1]! < at[k]!, `${order[k - 1]} before ${order[k]}`);
});

test('the long forms live in sheets; each screen keeps its main action outside them', () => {
  const inSheet = (hook: string) => {
    const at = html.indexOf(`data-zg="${hook}"`);
    return html.lastIndexOf('<dialog', at) > html.lastIndexOf('</dialog>', at);
  };
  for (const h of ['mx-groove', 'mx-workout', 'mx-vol-kick', 'mx-allowDuringQuietHours', 'songs-paste', 'improv-prompt', 'goal-what', 'goal-save']) assert.ok(inSheet(h), `${h} is in a sheet`);
  for (const h of ['reveal', 'mx-start', 'mx-bpm', 'rec-start', 'improv-start', 'songs-add', 'ear-play', 'theory-lessons', 'baseline-list', 'notify-all', 'open-signin', 'teach-reveal', 'today-objectives', 'teach-objectives']) assert.ok(!inSheet(h), `${h} stays on its screen`);
});

// ---------------------------------------------------- band members (2026-11-03) --

test('band members: what a member does not get is wrapped so it hides whole; the Band section and its confirm', () => {
  const inside = (outer: string, inner: string, closing: string) => {
    const at = html.indexOf(`data-zg="${outer}"`);
    const end = html.indexOf(closing, at);
    const i = html.indexOf(`data-zg="${inner}"`);
    return at >= 0 && i > at && i < end;
  };
  assert.ok(inside('songs-new-label', 'songs-new', '</label>'), 'the title box sits in its label');
  for (const h of ['notify-all', 'notify-windows', 'enable-push']) assert.ok(inside('settings-notify', h, '</section>'), h);
  for (const h of ['quiet-start', 'quiet-end', 'save-quiet', 'use-zone']) assert.ok(inside('settings-times', h, '</section>'), h);
  for (const h of ['band-role', 'band-manage', 'band-invite-note', 'band-invite', 'band-invite-made', 'band-invite-link', 'band-invite-copy', 'band-note', 'band-invites', 'band-members']) {
    assert.ok(inside('band', h, '</section>'), `${h} is in the Band section`);
  }
  assert.ok(inside('screen-settings', 'band', 'data-zg="dev"'), 'the Band section is in Settings, before the setup tools');
  assert.match(html, /<div data-zg="band-manage" hidden>/, 'the owner controls start hidden');
  assert.match(html, /<div data-zg="band-invite-made" hidden>/, 'no link until one is made');
  assert.match(html, /<input type="text" data-zg="band-invite-link" readonly>/);
  assert.ok(inside('screen-songs', 'songs-band', 'data-zg="songs-baseline"'), 'the band note heads Songs');
  assert.match(html, /<section data-zg="songs-band" hidden>/);
  assert.ok(inside('sheet-signin', 'signin-invite', '</dialog>'), 'the invite note is in the sign-in popup');
  const confirm = html.slice(html.indexOf('<dialog data-zg="sheet-band-delete"'), html.indexOf('</dialog>', html.indexOf('<dialog data-zg="sheet-band-delete"')));
  for (const h of ['band-delete-who', 'band-delete-confirm', 'band-delete-cancel']) assert.ok(confirm.includes(`data-zg="${h}"`), h);
  assert.match(confirm, /data-zg="band-delete-cancel" autofocus>Keep it</, 'the safe choice has the focus');
});
