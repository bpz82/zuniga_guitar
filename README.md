# Zuniga Guitar

Practice engine for Blake's guitar app. Engine only: logic, data, scheduling, goals, sessions, sync. The UI is built separately against [`docs/API.md`](docs/API.md).

- Spec, amendments and the "Knowingly NOT doing" list: [`docs/ENGINE_SPEC.md`](docs/ENGINE_SPEC.md)
- Mandatory before every build step, checked in every design check:
  - Design bylaws: [`docs/IMPORTANT_design-spec-sheet.txt`](docs/IMPORTANT_design-spec-sheet.txt)
  - Architecture principles: [`docs/IMPORTANT_architecture-principles.md`](docs/IMPORTANT_architecture-principles.md)

## Run the tests

Needs **Node 22.18 or newer** (22 or 24 LTS). Node runs the TypeScript directly, so there is no build step. Node 20 is not supported: it reached end of life on 2026-04-30 and Supabase's JavaScript libraries dropped it on 2026-06-30. On an older Node, `npm test` stops with a message saying so.

```sh
npm test               # engine, server logic, Web Push crypto: node's built-in runner
npm install            # dev tools for the rest
npm run typecheck
npm run test:sql       # database security rules on a throwaway Postgres 16 (needs Postgres installed)
npm run test:browser   # the built harness in headless Chromium (needs Playwright)
npm run build          # app into public/ (Vercel runs this; public connection comes from ZG_* env vars)
npm run bundle:function  # one-file reminder function for the Supabase dashboard editor
```

Setting up Supabase, Vercel and push reminders: [`docs/SETUP.md`](docs/SETUP.md). Third-party material and licenses: [`THIRD_PARTY.md`](THIRD_PARTY.md). What the graphics lead may edit: [`docs/THEME.md`](docs/THEME.md).

FSRS comes from a pinned, vendored copy of ts-fsrs: see [`vendor/ts-fsrs/VENDORED.md`](vendor/ts-fsrs/VENDORED.md).

## Where the code lives

- `src/`: the engine (log, scheduler, goals, sessions, sync) and `src/modules/` (metronome, recorder, ear, theory, songwriting, songs, test deck).
- `harness/`: the app's UI code, one folder per module (2026-11-03), mirroring `src/modules`:

| Folder | What is in it |
|---|---|
| `harness/main.ts` | Wires everything together (the only file that sees every folder; the build's entry point) |
| `harness/metronome/` | `metronome-ui.ts` |
| `harness/recorder/` | `recorder-ui.ts` (takes, improv) |
| `harness/ear/` | `ear-ui.ts` |
| `harness/theory/` | `theory-ui.ts` (Cards: the curriculum) |
| `harness/songs/` | `songs-ui.ts` (songs, baselines, tabs, a band member's Songs) |
| `harness/home/` | `today.ts` (Home's objectives), `teach.ts` (Teach), `goals-ui.ts` (Goals) |
| `harness/band/` | `band-ui.ts` (Settings' Band section) |
| `harness/shared/` | `shell.ts` and `routes.ts` (the menu, screens, hash routing), `hooks.ts`, `sheets.ts` (used by Sign-in, Band, Songs), `swipe.ts`, `install.ts` |
| `harness/static/` | HTML, `base.css`, the service worker, sounds, and `theme/` (the look; see `docs/THEME.md`) |

A module folder imports only its own files, `harness/shared/` and the engine, never another module's folder; `shared/` imports no module folder. `test/harness-layout.test.ts` enforces this (architecture principle 1, failure isolation).

## Status

| Checkpoint | State |
|---|---|
| 1. Data model | Approved 2026-10-30 |
| 2. Scheduler | Approved 2026-10-30 |
| 3. Goals layer (and 3am day boundary) | Approved 2026-10-30 |
| 4. Session builder | Approved 2026-10-30 |
| 5. App shell (storage, sync, module contract, test deck, Web Push, harness) | Approved 2026-10-30; live on Blake's iPhone |
| Metronome module | Built, awaiting review |
| Songs I Already Know (and morning reminder always on) | Approved 2026-10-31 |
| Songs skip learning steps; module contract locked as v1 | Built, awaiting review |
| Ear training module | Built, awaiting review |
| Recorder and improv takes (Storage bucket + RLS) | Built, awaiting review |
| Goals intake and songwriting prompts | Built, awaiting review |
| Theory and physics flashcards; gig memo on gig night | Built, awaiting review |
| App shell: Today, tabs and side nav, Settings behind the gear, hash routing | Built, awaiting review |
| Social-style tab bar: centre Record, More sheet, due badges | Built, awaiting review |
| Layout redesign of every screen; theme v6 (lighter) | Built, awaiting review |
| Theme v8: Home like final_mock4, Zuniga Mission v2; harness split into module folders | Built, awaiting review |
