# Zuniga Guitar

Practice engine for Blake's guitar app. Engine only: logic, data, scheduling, goals, sessions, sync. The UI is built separately against [`docs/API.md`](docs/API.md).

- Spec, amendments and the "Knowingly NOT doing" list: [`docs/ENGINE_SPEC.md`](docs/ENGINE_SPEC.md)
- Mandatory before every build step, checked in every design check:
  - Design bylaws: [`docs/IMPORTANT_design-spec-sheet.txt`](docs/IMPORTANT_design-spec-sheet.txt)
  - Architecture principles: [`docs/IMPORTANT_architecture-principles.md`](docs/IMPORTANT_architecture-principles.md)

## Run the tests

Needs **Node 22.18 or newer** (22 or 24 LTS). Node runs the TypeScript directly, so there is no build step. Node 20 is not supported: it reached end of life on 2026-04-30 and Supabase's JavaScript libraries dropped it on 2026-06-30. On an older Node, `npm test` stops with a message saying so.

```sh
npm test          # node's built-in test runner, no dependencies
npm install       # only needed for the type check
npm run typecheck
```

FSRS comes from a pinned, vendored copy of ts-fsrs: see [`vendor/ts-fsrs/VENDORED.md`](vendor/ts-fsrs/VENDORED.md).

## Status

| Checkpoint | State |
|---|---|
| 1. Data model | Approved 2026-10-30 |
| 2. Scheduler | Approved 2026-10-30 |
| 3. Goals layer (and 3am day boundary) | Approved 2026-10-30 |
| 4. Session builder | Built, awaiting review |
| 5. App shell (storage, sync, module contract, test deck, notifications, test harness) | Not started |
