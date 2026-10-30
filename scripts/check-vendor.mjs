// Fails fast, with the fix, if the vendored FSRS build is missing or changed.
// vendor/ts-fsrs/DIST-SHA256 lists every file in dist/ with its hash.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../vendor/ts-fsrs/', import.meta.url).pathname;
const bad = [];
for (const line of readFileSync(join(root, 'DIST-SHA256'), 'utf8').trim().split('\n')) {
  const [hash, file] = line.split(/\s+/);
  try {
    if (createHash('sha256').update(readFileSync(join(root, file))).digest('hex') !== hash) bad.push(`changed: ${file}`);
  } catch {
    bad.push(`missing: ${file}`);
  }
}
if (bad.length) {
  console.error(
    `The vendored FSRS library is not intact:\n  ${bad.join('\n  ')}\n` +
      'Restore it with:  git checkout -- vendor/ts-fsrs\n' +
      'It is never edited by hand; see vendor/ts-fsrs/VENDORED.md.',
  );
  process.exit(1);
}
