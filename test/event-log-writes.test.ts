/**
 * Who may append to the event log (architecture principles 1 and 2; Blake,
 * Nov 15 2026). Modules reach the log only through the module contract
 * (src/contract.ts: scoped host, write budget, runModule). Production code
 * (src/ and harness/, not test/) may append directly in exactly these
 * places, pinned here by file and call count:
 *   - src/contract.ts: the one `replica.record` every module write goes through.
 *   - harness/main.ts: `record()` (settings, goals, played, task-done) and
 *     the backup import `replica.restore`; both are engine paths.
 *   - harness/home/practice-ui.ts: `deps.record`, the practice events.
 * A new `.record(` or `.restore(` anywhere else fails this test: route the
 * write through the contract, or name the new engine path here on purpose.
 * Review, item-set and card-set events may only be built in src/contract.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'harness'];
const ALLOWED_APPENDS: Readonly<Record<string, number>> = {
  'src/contract.ts': 1,
  'harness/main.ts': 2,
  'harness/home/practice-ui.ts': 4,
};
const CONTRACT = 'src/contract.ts';

const tsIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? tsIn(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f).split('\\').join('/')] : []));

/** Source without comments, so prose and doc comments cannot trip or hide a match. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** Direct appends: calls to the replica's `record` or `restore` methods (`x.record(`, `x.restore(`). */
const appendsIn = (text: string) => [...code(text).matchAll(/\.(record|restore)\s*\(/g)].length;
/** Events that only the contract may build: a review, item-set or card-set literal (not a type declaration). */
const contractOnlyIn = (text: string) =>
  code(text)
    .split('\n')
    .filter((l) => /\btype:\s*'(review|item-set|card-set)'/.test(l) && !/\breadonly\s+type\b/.test(l)).length;

const files = ROOTS.flatMap(tsIn);

test('the scan sees the production code', () => {
  assert.ok(files.length > 40);
  assert.ok(files.includes(CONTRACT) && files.includes('harness/main.ts') && files.includes('harness/home/practice-ui.ts'));
  assert.ok(files.every((f) => !f.startsWith('test/')));
});

test('production code appends to the event log only at the pinned engine sites', () => {
  const found: Record<string, number> = {};
  for (const f of files) {
    const n = appendsIn(readFileSync(f, 'utf8'));
    if (n > 0) found[f] = n;
  }
  assert.deepEqual(found, ALLOWED_APPENDS);
});

test('review, item-set and card-set events are written only through the contract', () => {
  const bad = files.filter((f) => f !== CONTRACT && contractOnlyIn(readFileSync(f, 'utf8')) > 0);
  assert.deepEqual(bad, [], 'module writes go through host.reportRep / addItem / addCard / retireCard');
  assert.ok(contractOnlyIn(readFileSync(CONTRACT, 'utf8')) >= 4, 'the contract builds them');
});

test('the scan catches a new direct append and a review written outside the contract', () => {
  assert.equal(appendsIn('await replica.record({ type: "played" });'), 1);
  assert.equal(appendsIn('await this.replica.restore(events);'), 1);
  assert.equal(appendsIn('// replica.record(x) in a comment\n/* replica.record(y) */'), 0);
  assert.equal(contractOnlyIn("await replica.record({ type: 'review', cardId, rating });"), 1);
  assert.equal(contractOnlyIn("readonly type: 'review';"), 0);
});
