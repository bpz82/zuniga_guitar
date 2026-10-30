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

Setting up Supabase, Vercel and push reminders: [`docs/SETUP.md`](docs/SETUP.md).

FSRS comes from a pinned, vendored copy of ts-fsrs: see [`vendor/ts-fsrs/VENDORED.md`](vendor/ts-fsrs/VENDORED.md).

## Status

| Checkpoint | State |
|---|---|
| 1. Data model | Approved 2026-10-30 |
| 2. Scheduler | Approved 2026-10-30 |
| 3. Goals layer (and 3am day boundary) | Approved 2026-10-30 |
| 4. Session builder | Approved 2026-10-30 |
| 5. App shell (storage, sync, module contract, test deck, Web Push, harness) | Built, awaiting review |
