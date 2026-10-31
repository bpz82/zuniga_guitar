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

test('elements the code creates carry their hooks', () => {
  const code = read('harness/main.ts');
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
  for (const f of ['harness/main.ts', 'harness/metronome-ui.ts', ...files('src')]) {
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
