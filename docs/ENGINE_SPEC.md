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
- **Kept:** fuzz, learning and relearning steps (song cards skip the steps, 2026-10-31, below).
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

- **Metronome module (Blake, 2026-10-31):** real recorded drum kit (Virtuosity Drums, CC0 1.0, see `THIRD_PARTY.md`) plus synth beeps with adjustable pitch; Web Audio lookahead scheduler, 30 to 300 BPM; tap tempo; time signatures; subdivisions (8ths, triplets, 16ths); accent on 1; grooves (plain click, rock, shuffle, half-time); per-voice volume; count-in; workouts (steady, tempo ramp, gap click, ladder rep); sessions logged as reviews of the module's own exercise cards (tempo, bars, clean or sloppy, tap-along timing error). Out-of-scope items "smart metronome and drum machine" and "metronome workouts" are now in scope in this minimal form.
- **Tempo ladder goal block is live:** `tempo-ladder` is a runnable block kind with strictly validated params `{ cardId, startBpm, targetBpm, stepBpm, cleanReps, repBars }`. Up a step after `cleanReps` clean reps in a row, down a step after a sloppy one, within start to target. State is replayed from the log.
- **Shared metronome clock service defined** (`src/services/metronome-clock.ts`); the metronome implements it. Recorder and improv takes will sync to it.
- **Contract v0 addition:** `host.reviews(cardId)`, reviews of the module's own cards only.
- **Design guardrails (Blake, 2026-10-31):** all visual styling in `harness/static/theme/` (CSS, icons, fonts, one design-tokens file); every element the code uses has a fixed `data-zg` hook; behavior and timing stay out of the theme. Editable files: `docs/THEME.md`.
- **Morning reminder always fires (Blake, 2026-10-31):** the morning window's reminder is sent even when nothing is due. Setting `alwaysRemindMorning`, default on; nothing is sent until the user turns notifications on (master switch still off by default), and the morning window's own toggle still wins. All other windows still only remind when something is due.
- **Songs I Already Know (Blake, 2026-10-31):** a song is a title only (one item, one `song` card tagged `guitar`). Add one, paste a list (one title per line), rename, archive and restore; no hard delete. Practice: the morning session serves it through the normal FSRS queue, Blake plays it and rates it Again/Hard/Good/Easy. No chords, keys, tabs or links. Built on contract v0 with no contract changes.
- **Songs skip learning steps (Blake, 2026-10-31):** song cards schedule in whole days from every rating (no 10-minute same-session repeat, no 1-minute relearning step); all other cards keep the steps. `NO_STEP_MODULES` in `src/scheduler.ts`.
- **Module contract locked as v1 (Blake, 2026-10-31):** v0 unchanged. Changes need Blake's yes and a new version; a test freezes the surface. Songs are ordinary events, so the database and row-level security are unchanged.

- **Ear training module (Blake, 2026-10-31):** built from `docs/ear-training-research.md`. Out-of-scope item "ear training" is now in scope in this form: seven exercise families (pitch direction, scale degree after a cadence, intervals, chord quality, chord function, meter, rhythm echo) on a six-level mastery ladder; every trial a fresh synthesized exemplar; immediate corrective feedback with scaffolding after two misses; FSRS schedules the skills (the research's half-life multipliers map onto ratings; its score is logged for later fitting). Cards are tagged pocket-sound and guitar. Contract v1 unchanged; database and row-level security unchanged. Details in `docs/API.md`.

- **Recorder and improv takes (Blake, 2026-10-31):** takes recorded in the browser on phone and laptop; timed improv prompts (N takes, a window each, saved separately; default 3 x 5 minutes); takes back up to a private per-user Supabase Storage bucket (`takes`, RLS: add and read own folder only, no overwrite or delete), queue offline and upload on sync; list, play, rename, archive, restore; no hard delete. Out-of-scope item "Lage improv recorder" is in scope in this form. Recordings use Supabase Storage as decided (not R2).

- **Goals intake and songwriting prompts (Blake, 2026-10-31):** an intake form for a gig or a deadline ("write a new record by X") with timed tasks ("10 min in Chord Chemistry"), a daily songwriting prompt (concrete, timed, recorded; 20 prompts rotating, or the goal's own), improv takes (with the gig ramp, e.g. 5 to 10 one-minute takes), guitar yoga and recall for the goal's songs. `improv-takes` and `creative-prompt` are runnable block kinds now; `gig-memo` stays reserved. Planned blocks carry their params (this also fixes the tempo-ladder button, which never appeared because params were dropped) and days to the deadline. The log's rules for these two block kinds are unchanged so older goals still load; new goals are checked strictly by the form. Check-ins (14, 7, 2 days) and archiving are in the harness. Contract v1 unchanged.

## Knowingly NOT doing (v0.1)

| Requirement | Why not |
|---|---|
| Monthly FSRS parameter retraining | One user won't have enough history for a while; automation goes last. Use default parameters; revisit once the log is substantial. |
| Load balancing | Solves clumping in large multi-user decks. One person with a small library doesn't have that problem. |
| Stats screen | No decision depends on it. One line on Today at most. |
| Cloudflare R2 | Outside the locked stack. Supabase Storage covers recordings later. |
| Sibling burying | A song has exactly one card (title only, Blake 2026-10-31), so there are no siblings to bury. Deferred until an item has more than one card. The item-to-cards link stays in the model (`cardsOfItem`). |
| Pocket results feeding guitar priority | Songs are guitar-only (title, play, rate), so no song has a pocket card whose result could move it up. Deferred until a module makes pocket cards linked to guitar cards. |
| Locking the module contract early (superseded Oct 31 2026: contract locked as v1, see amendments) | Songs I Already Know needed no contract change. Proposed: lock v0 as v1 unchanged. Awaiting Blake's yes. The isolation rule is enforced from v0. |
| Post-gig voice memo, recorded creative prompts, improv takes (superseded Oct 31 2026 except the gig memo: recorder, improv takes and songwriting prompts built, see amendments) | Need the recorder. Ship with the recorder module; block types are reserved now. |
| Shared-service interfaces (randomizer, recorder, metronome) | Defined with the first module that uses each one, not predicted now. |
| Conversational intake interview | Would need an AI service (no paid services). A form asks the same five questions. |
| One specialist bot per module | Conflicts with the minimal-headcount rule. One builder for everything. |
| Self-service account deletion button | Deleting a user in Supabase Auth already removes all their data (tested). A button needs a server function and a confirm flow; add before public launch. |
| Moving a signed-out device's practice into a new account | Local-only practice stays in its own local database. Export then Restore moves it. |
| Product UI | Built separately against `docs/API.md`; the harness is deliberately bare. |
| Graphics pass changing layout structure, behavior, timing or beat-tied animation | The graphics lead (ChatGPT) edits only look files in `harness/static/theme/` (CSS, design tokens, icons, fonts; see `docs/THEME.md`). Structure is fixed by `data-zg` hooks guarded by `test/hooks.test.ts`; behavior, timing and anything tied to the beat stay in code. |
| Metronome pattern/groove editor | UI work; the four presets cover the request. Patterns are already data (`hitsFor`), so an editor can be added without engine changes. |
| Timing error from the microphone | Needs the recorder module (mic access). Until then timing error comes from tapping along, which includes touch-screen delay. |
| Recorder, improv takes, creative prompts, gig memo (superseded Oct 31 2026 except the gig memo, see amendments) | Still deferred: they need the recorder, not the metronome. They will sync to the metronome clock service. |
| Removing `setup-keys.html` | Needed only for setup. On the pre-customer checklist in `docs/SETUP.md`; removal waits for Blake's yes. |
| Hard delete of a song | The log is append-only; Blake asked for archive. Archived songs are not served and can be restored with their history. |
| Song details (chords, keys, tabs, links) | Blake, 2026-10-31: a song card holds only a title. |
| Ear: the research's own half-life scheduler (R = 2^(-t/S) with cold-start multipliers) | FSRS already estimates stability and difficulty from answers, with fitted parameters; the research itself says to replace its multipliers with fitted ones. Its signals map onto FSRS ratings, and its score is logged per answer for later fitting. |
| Ear: singing, sing-back and melodic imitation | Need the microphone and pitch tracking: ship with the recorder module. |
| Ear: transcription, notation, fretboard entry, chord transcription, real-recording extraction | Need notation or fretboard input UI, or licensed recordings; deferred. Rhythm echo covers "tap the rhythm". |
| Ear: confidence ratings | One more tap per answer; left out of the score (renormalized) until Blake wants it. |
| Ear: research ladder levels 7 to 9 (minor and chromatic degrees, secondary dominants, swing and tuplets, modal mixture, modulation, 7th chords, polyphonic and real-recording work); inversions and bass-degree hearing; harmonic (simultaneous) intervals; tonic inference from a melody without a cadence | Next ear levels once 1 to 6 are in use. The ladder is data (`LADDER`), so levels slot in without rework. |
| Ear: a shared randomizer service that leans toward least-used options | The module uses a small seeded generator; exemplar variety comes from random key, register, timbre and direction. Define the shared service when a second module needs it. |
| Ear: enforcing the daily minutes | The research's 18 minutes is a suggestion, not a proven optimum. Shown on the panel; extra practice is always on offer. |
| Recorder: syncing takes to the metronome clock (recording with a click, aligned) | The clock service exists, but recording while the metronome plays needs headphones and latency compensation to line up. Free and improv takes first. |
| Recorder: deleting takes (locally or in storage) | Blake: archive, never hard delete. The storage rules allow no delete at all. |
| Recorder: removing a user's takes when their account is deleted | Supabase Storage does not cascade with Auth users. On the pre-customer checklist (`docs/SETUP.md`); needs a service-role function. |
| Recorder: trimming, waveforms, mixing, sharing links | Not asked for. Takes play as recorded. |
| Recorder: blocking recording in quiet hours | The recorder makes no sound; playing back is the user's choice. The metronome keeps its own quiet-hours rule. |
| Goals: the post-gig rundown voice memo (`gig-memo`) | The recorder can record it, but it belongs after the gig, when the goal has already expired. Needs a decision on when it shows (gig night? the next morning?). Stays reserved. |
| Goals: AI-written or personalised songwriting prompts | Would need an AI service (no paid services). Twenty fixed prompts rotate; a goal can set its own. |
| Goals: counting songs written, "ideas", or output | No arbitrary counts (spec). Blocks are timed and recorded; the takes are the record of the work. |
| Goals: editing a goal's blocks after saving | Check-ins adjust the daily minutes, as specified. For new blocks, archive the goal and make a new one (history kept). |
