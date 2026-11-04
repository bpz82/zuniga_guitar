/**
 * The harness layout (Blake, 2026-11-03): UI code lives in one folder per
 * module, mirroring src/modules (metronome, recorder, ear, theory, songs,
 * home, band), plus harness/shared for what they all use (shell, menu
 * routes, hooks, sheets, swipe, install). Failure isolation (architecture
 * principle 1): a module folder may import only its own files, harness/shared
 * and the engine (src/); never another module's folder. shared imports no
 * module folder. Only harness/main.ts, which wires everything, sees them all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

const HARNESS = 'harness';
const MODULE_FOLDERS = ['metronome', 'recorder', 'ear', 'theory', 'songs', 'home', 'band'];
const SHARED = 'shared';

const folders = readdirSync(HARNESS).filter((f) => statSync(join(HARNESS, f)).isDirectory() && f !== 'static');
const tsIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? tsIn(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));

/** Relative import specifiers in a file: static imports, re-exports and dynamic import(). */
function importsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\1/gm)].map((m) => m[2]!);
}

/** The harness folder a path sits in ('' for harness/ itself, null outside harness/). */
function folderOf(path: string): string | null {
  const rel = relative(HARNESS, normalize(path));
  if (rel.startsWith('..')) return null;
  const parts = rel.split(sep);
  return parts.length > 1 ? parts[0]! : '';
}

test('harness has exactly the agreed folders', () => {
  assert.deepEqual([...folders].sort(), [...MODULE_FOLDERS, SHARED].sort());
  assert.deepEqual(readdirSync(HARNESS).filter((f) => f.endsWith('.ts')), ['main.ts'], 'only main.ts stays at the top of harness/');
});

test('module folders under harness/ do not import each other (only harness/shared)', () => {
  const bad: string[] = [];
  let checked = 0;
  for (const folder of [...MODULE_FOLDERS, SHARED]) {
    for (const file of tsIn(join(HARNESS, folder))) {
      for (const spec of importsOf(file)) {
        checked++;
        const target = folderOf(join(dirname(file), spec));
        if (target === null) continue; // the engine (src/) or vendor: allowed
        const ok = target === folder || (folder !== SHARED && target === SHARED);
        if (!ok) bad.push(`${file} imports ${spec}`);
      }
    }
  }
  assert.ok(checked > 20, 'the scan saw the imports');
  assert.deepEqual(bad, []);
});

test('the boundary check catches a cross-module import', () => {
  const file = join(HARNESS, 'songs', 'songs-ui.ts');
  assert.equal(folderOf(join(dirname(file), '../band/band-ui.ts')), 'band');
  assert.equal(folderOf(join(dirname(file), '../shared/hooks.ts')), SHARED);
  assert.equal(folderOf(join(dirname(file), '../../src/index.ts')), null);
});
