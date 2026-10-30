# Zuniga Guitar

Practice engine for Blake's guitar app. Engine only: logic, data, scheduling, goals, sessions, sync. The UI is built separately against [`docs/API.md`](docs/API.md).

- Spec, amendments and the "Knowingly NOT doing" list: [`docs/ENGINE_SPEC.md`](docs/ENGINE_SPEC.md)
- Mandatory before every build step, checked in every design check:
  - Design bylaws: [`docs/IMPORTANT_design-spec-sheet.txt`](docs/IMPORTANT_design-spec-sheet.txt)
  - Architecture principles: [`docs/IMPORTANT_architecture-principles.md`](docs/IMPORTANT_architecture-principles.md)

## Run the tests

Needs Node 22.18 or newer (runs TypeScript directly, no build step).

```sh
npm test          # node's built-in test runner, no dependencies
npm install       # only needed for the type check
npm run typecheck
```

## Status

| Checkpoint | State |
|---|---|
| 1. Data model | Built, awaiting review |
| 2. Scheduler | Not started |
| 3. Goals layer | Not started |
| 4. Session builder | Not started |
| 5. App shell (storage, sync, notifications, test harness) | Not started |
