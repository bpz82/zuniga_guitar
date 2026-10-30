# Zuniga Guitar: Engine Release Spec (v0.1, draft for sign-off)

## Purpose
A practice app for Blake, where skills compound over time. Phone and computer friendly, built as an installable web app. This release ships the engine and the app frame, not the instrument modules.

## In scope
1. **Core engine** (pure logic, no UI or audio)
   - Items (notes) generate sibling cards; scheduling state lives on cards.
   - FSRS scheduling (D/S/R), 4 ratings: Again, Hard, Good, Easy. Default desired retention 90%. Parameters retrained monthly from the log.
   - Append-only practice log (rating, time taken, optional details such as tempo or timing error). The current card state is derived from the log.
   - Learning and relearning steps, leech detection (8 lapses means flag and suggest a breakdown, no silent suspend), sibling burying, fuzz and load balancing.
   - Whole library acts like one "everything" deck: old material stays alive with long intervals.
   - Return after a break: sort the backlog by risk of forgetting and goal weight, then spread it over a few days.
2. **Goals layer**
   - An intake interview creates each goal (what, why, deadline, the material involved, daily time).
   - Goals change only the target retention, queue order, and time split. They never change memory state.
   - Building blocks: recall cards, tempo ladders (raise tempo only after clean reps, drop back on a sloppy one), feel sessions (guitar yoga: timed, ungraded, a feel note afterward, protected from being skipped), creative prompts (concrete and timed, e.g. 3 songs, a 5-minute window each, recorded), timed tasks (e.g. "10 min in Chord Chemistry," checked off).
   - No arbitrary counts such as "new ideas."
   - Gig goals: higher retention for set songs, deadline peaking, final week shifts to full set run-throughs, improv takes ramp up (e.g. 5 to 10 one-minute takes a day), and a post-gig rundown voice memo. Goals expire cleanly after the date.
   - Several goals can run at once, with weights.
   - Plan adapts at check-ins as the date approaches.
3. **Session builder**
   - Card tags: guitar, pocket with sound, pocket silent.
   - Morning guitar session, 1 hour minimum.
   - Pocket bursts (3 to 5 min): before work (sound), during work (silent only), after work (sound).
   - Gentle notifications at the start of each window, and cards are always available on open. Missed bursts roll forward with no nagging.
   - Pocket results feed guitar priority (e.g. a forgotten bridge moves the song up the next morning).
   - Optional one-tap "I played" log for unstructured time.
4. **Module contract** (versioned, locked early)
   - A module declares its card types and tags, reports rep results to the engine, and asks for due cards. It never writes engine data directly.
5. **App shell**: Today screen, session player, settings, basic stats. Offline first with cloud sync; the append-only log merges across devices.
6. **Built-in test deck**: theory flashcards (fretboard notes, chord spellings), silent pocket mode, used to prove the engine end to end.

## Shared services (interfaces defined now, built with modules)
Randomizer (leans toward least-used options), recorder and player, metronome clock.

## Out of scope (next releases, one specialist bot each)
Songs I Already Know (first), smart metronome and drum machine, ear training, Lage improv recorder, physics and theory lessons, songwriting, metronome workouts.

## Stack (proposed)
TypeScript, installable web app, local database on the device, Supabase free tier for login and sync, Cloudflare R2 for recordings later, free hosting on Vercel, code in a GitHub repository.

## Done means
- Engine unit tests pass for the FSRS math, state transitions, leeches, burying, and backlog sorting.
- The test deck runs a full day: morning plan, three pocket windows, notifications, and offline then sync.
- A gig goal created through the intake visibly reshapes the queue and time split.

---

## Amendments (Blake, 2026-10-30)

Source: `docs/decisions-2026-10-30.md`. Where these conflict with the text above, these win.

- **Builder scope:** engine only. Logic, data, scheduling, goals, session builder, sync, notifications plumbing, tests, and a bare functional test harness. No graphics, styling or visual design; the UI is built separately against a documented engine API (`docs/API.md`).
- **One builder** for the engine and all future modules. ZUNIGA GUITAR MANAGER is manager, tester and gate: nothing goes live without its testing. Nothing is deleted without Blake's yes.
- **Isolation rule:** modules touch the engine only through the module contract, never its data. A broken module must never be able to corrupt the event log.
- **Notifications stay in scope:** Web Push (VAPID) with a Supabase cron/edge function, for the installed app on iPhone (home-screen install) and laptop.
- **Goal blocks:** recorder- and metronome-dependent blocks are deferred to their modules, but the block types are designed now so they slot in without rework.
- **Kept:** fuzz, learning and relearning steps.
- **Check-in:** when the app is opened within N days of a goal's deadline, it re-shows that goal's plan and lets Blake adjust the daily time.
- **Stats:** at most one line on Today (due count and retention).
- **Recordings, later:** Supabase Storage, not Cloudflare R2.
- **Done means, revised:** burying leaves the engine test list (deferred to Songs).
- **FSRS (2026-10-30, second round):** FSRS-6, from a pinned vendored copy of ts-fsrs v5.4.2 with its license (`vendor/ts-fsrs/VENDORED.md`).
- **Runtime:** Node 22.18 or newer. Node 20 is end-of-life and not supported.
- **Architecture principles** (`docs/IMPORTANT_architecture-principles.md`) are mandatory alongside the design sheet.
- **Config in the log (2026-10-30, third round):** items, cards, goals and settings stay in the log as versioned events.
- **Day boundary:** a practice day starts at 3:00am America/New_York (Blake wakes 3:30 to 4am, sleeps by midnight), stored as `settings.dayStart` in the log.
- **ts-fsrs Date side effect:** left alone unless it causes a real problem.
- **Goals layer (approved 2026-10-30):** check-ins at 14, 7 and 2 days out; gig default retention 95%; final 7 practice days (gig day included) are full set run-throughs, due cards still served in pocket bursts; order is risk x (1 + weight) and goals never hide other due cards; changing the day start re-buckets past reviews.
- **Schedule (2026-10-30):** morning guitar session 4:00am; pocket windows 9:45am (sound), 1:00pm (silent; work is 10:30am to 4:00pm), 4:30pm (sound). All in settings.
- **Session builder (approved 2026-10-30):** quiet hours override every window; morning length is a setting, 60 minimum; new cards limited by time, not count; module contract moved to checkpoint 5.
- **Shipping to customers (Blake, 2026-10-30):** every schedule and notification setting is user-editable at any time; engine defaults are neutral (Blake's schedule is his own settings event, `fixtures/blake.ts`); onboarding sets a new user's schedule; master and per-window notification toggles (master off until the user opts in); per-user data isolation everywhere (one local database per user, row-level security on every table, per-user handling on the server).
- **Reminders design (checkpoint 5, for review):** each user's app plans its next 7 days of reminders and uploads them; the server only sends what is due and never runs the engine or reads practice data. A reminder seen more than 15 minutes late is skipped, never sent late.

## Knowingly NOT doing (v0.1)

| Requirement | Why not |
|---|---|
| Monthly FSRS parameter retraining | One user won't have enough history for a while; automation goes last. Use default parameters; revisit once the log is substantial. |
| Load balancing | Solves clumping in large multi-user decks. One person with a small library doesn't have that problem. |
| Stats screen | No decision depends on it. One line on Today at most. |
| Cloudflare R2 | Outside the locked stack. Supabase Storage covers recordings later. |
| Sibling burying | Only matters once songs have several sibling cards. Built with Songs I Already Know. The item-to-cards link stays in the model. |
| Pocket results feeding guitar priority | Needs guitar song cards to prove. Built with Songs I Already Know. |
| Post-gig voice memo, recorded creative prompts, improv takes | Need the recorder. Ship with the recorder module; block types are reserved now. |
| Tempo ladders | Need the metronome clock. Ship with the metronome module; block type reserved now. |
| Shared-service interfaces (randomizer, recorder, metronome) | Defined with the first module that uses each one, not predicted now. |
| Locking the module contract early | Stays v0 until Songs I Already Know proves it; locked then. The isolation rule is enforced from v0. |
| Conversational intake interview | Would need an AI service (no paid services). A form asks the same five questions. |
| One specialist bot per module | Conflicts with the minimal-headcount rule. One builder for everything. |
| Self-service account deletion button | Deleting a user in Supabase Auth already removes all their data (tested). A button needs a server function and a confirm flow; add before public launch. |
| Moving a signed-out device's practice into a new account | Local-only practice stays in its own local database. Export then Restore moves it. |
| Product UI | Built separately against `docs/API.md`; the harness is deliberately bare. |
| Removing `setup-keys.html` | Needed only for setup. On the pre-customer checklist in `docs/SETUP.md`; removal waits for Blake's yes. |
