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
  // Each tab and the gear link to their screen's hash.
  for (const s of SCREENS) {
    const hook = s === 'settings' ? 'gear' : `tab-${s}`;
    assert.match(html, new RegExp(`<a href="#/${s}" data-zg="${hook}"`), hook);
  }
});

test('base.css: the protected hidden rule, then structure only, all at zero specificity so the theme wins', () => {
  const css = read('harness/static/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
  const STRUCTURAL = new Set(['position', 'left', 'right', 'top', 'bottom', 'z-index', 'display', 'flex', 'flex-direction', 'min-width', 'text-align', 'align-items', 'justify-content', 'gap', 'column-gap', 'grid-template-columns', 'grid-template-areas', 'grid-area', 'padding-bottom', 'background']);
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

test('nav: the five phone slots in order, then the More sheet with Ear training, Goals, Cards, Settings', async () => {
  const { BAR, MORE } = await import('../harness/routes.ts');
  const nav = html.slice(html.indexOf('<nav data-zg="nav"'), html.indexOf('</nav>'));
  const at = (hook: string) => nav.indexOf(`data-zg="${hook}"`);
  const slots = BAR.map((b) => (b === 'more' ? 'nav-more' : `tab-${b}`));
  for (let i = 1; i < slots.length; i++) assert.ok(at(slots[i - 1]!) >= 0 && at(slots[i - 1]!) < at(slots[i]!), `${slots[i - 1]} before ${slots[i]}`);
  const sheet = nav.slice(at('more-sheet'), nav.lastIndexOf('</div>'));
  assert.ok(at('more-sheet') > at('nav-more'), 'the sheet follows the More button');
  const items = MORE.map((m) => (m === 'settings' ? 'more-settings' : `tab-${m}`));
  for (let i = 0; i < items.length; i++) {
    assert.ok(sheet.includes(`data-zg="${items[i]}"`), `${items[i]} is in the sheet`);
    if (i > 0) assert.ok(sheet.indexOf(`data-zg="${items[i - 1]}"`) < sheet.indexOf(`data-zg="${items[i]}"`));
  }
  for (const s of slots.filter((x) => x !== 'nav-more')) assert.ok(!sheet.includes(`data-zg="${s}"`), `${s} is in the bar, not the sheet`);
  assert.match(html, /<a href="#\/settings" data-zg="more-settings"/);
});

test('nav: the More button is a disclosure for the sheet, closed at load', () => {
  const button = /<button ([^>]*)data-zg="nav-more"([^>]*)>/.exec(html);
  assert.ok(button, 'More is a button');
  const attrs = button![0];
  assert.match(attrs, /type="button"/);
  assert.match(attrs, /aria-expanded="false"/);
  const controls = /aria-controls="([^"]+)"/.exec(attrs)?.[1];
  assert.ok(controls && new RegExp(`<div id="${controls}" data-zg="more-sheet">`).test(html), 'aria-controls names the sheet');
  assert.ok(!/data-zg="more-sheet"[^>]*data-open/.test(html), 'the sheet starts closed');
});

test('nav: every item is an inline SVG icon (currentColor, hidden from screen readers) plus a short label', () => {
  const nav = html.slice(html.indexOf('<nav data-zg="nav"'), html.indexOf('</nav>'));
  const items = [...nav.matchAll(/<(a|button) [^>]*data-zg="(tab-[a-z]+|nav-more|more-settings)"[^>]*>([\s\S]*?)<\/\1>/g)];
  assert.equal(items.length, 9, 'Today, Practice, Record, Songs, More, Ear training, Goals, Cards, Settings');
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
  assert.match(nav, /data-zg="tab-record"><svg width="32" height="32"/, 'Record is the larger centre icon');
});

test('nav: due-count badges sit inside Practice and Cards, hidden until something is due', async () => {
  const { BADGED } = await import('../harness/routes.ts');
  for (const b of BADGED) {
    const link = new RegExp(`data-zg="tab-${b}">[\\s\\S]*?</a>`).exec(html)?.[0] ?? '';
    assert.match(link, new RegExp(`<span data-zg="nav-badge-${b}" aria-hidden="true" hidden></span></a>$`), b);
  }
});
