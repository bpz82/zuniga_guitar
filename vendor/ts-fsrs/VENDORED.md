# Vendored: ts-fsrs v5.4.2 (FSRS-6)

| | |
|---|---|
| Upstream | https://github.com/open-spaced-repetition/ts-fsrs, package `packages/fsrs` |
| Tag | `v5.4.2` |
| Commit | `bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d` (2026-09-01) |
| Algorithm | FSRS-6 (`FSRSVersion`: "v5.4.2 using FSRS-6.0"), default 21 parameters |
| License | MIT, Copyright (c) 2026 Open Spaced Repetition. See `LICENSE`. |
| Vendored on | 2026-10-30 |

## Why this version

Blake chose FSRS-6, the version with published benchmark results. v5.4.2 is the last release of the v5 line, which implements FSRS-6 natively. v6.0.0 (2026-10-27) defaults to FSRS-7 and restructures the library; it was three days old when vendored.

## What is here

- `src/`, `package.json`, `LICENSE`: copied byte-for-byte from the tag. Not modified. (`package.json` is kept because `src/constant.ts` reads its version.)
- `dist/ts-fsrs.mjs`: single-file ES module bundled from `src/` with bun 1.4.4. Readable, not minified. No runtime dependencies.
- `dist/types/`, `dist/ts-fsrs.d.mts`: type declarations generated from `src/` with tsc.

The engine imports only `dist/ts-fsrs.mjs`, and only from `src/scheduler.ts`, so swapping or upgrading the library touches one file.

## Rules

- Never edit anything in this folder by hand.
- To rebuild `dist/`, run `scripts/build-vendor-ts-fsrs.sh`. It must produce no git diff.
- To upgrade: replace `src/`, `package.json` and `LICENSE` from a new tag, rebuild, update this file, and run the full test suite. The test `test/fsrs-reference.test.ts` checks results against values the upstream project cross-checks with fsrs-rs, the Rust implementation Anki uses.
