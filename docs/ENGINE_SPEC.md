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

- **Post-gig memo on gig night (Blake, 2026-10-31):** the `gig-memo` block is live. On the gig's own practice day, from 18:00 (or the block's `from` time) until the day ends (3am for Blake, so late-night rundowns count), it shows in whatever session is open with Record: one take, up to 30 minutes. Not part of the daily time split. Gig goals made with the form include it by default (untick to leave it out). No block kind is reserved now.
- **Theory and physics flashcards (Blake, 2026-10-31):** 120 starter cards in ten topics (harmonic series, strings and scale length, intonation and temperament, resonance and pickups, decibels and hearing, guitar frequency ranges, signal flow and gain staging, EQ/compression/reverb, tape and noise reduction for Fostex cassette 4-tracks with dbx and Maxell XLII, practical guitar theory). Q/A and multiple-choice cards, all `pocket-silent` (off-instrument, fine at work), FSRS through contract v1, each citing Benade (Fundamentals of Musical Acoustics, Dover) or Winer (The Audio Expert, 2nd ed., Routledge 2018) by chapter, or saying plainly when a fact comes from neither. Written in original words: no quotations, no figures. Topics switch on and off. Out-of-scope item "physics and theory lessons" is in scope in this flashcard form.
- **New cards take turns between modules (2026-10-31):** within a weight, the module with the fewest started cards goes next, so one large deck (the built-in test deck's 102 cards) never holds back another module's new cards. A newly added deck catches up first.

- **App shell (Blake, 2026-10-31; phone tab bar superseded 2026-11-01, see the next amendment):** phone-first shell replacing the one stacked page. Today is the default screen (what is due now, Start session, today's goal blocks, the next reminder); a bottom tab bar on phones and a side nav on laptops for Today, Practice (session + metronome), Songs, Ear, Record, Goals, Cards; Settings behind a gear (notifications, morning reminder, quiet hours, account, sign out, backup) with setup and raw settings in a closed developer panel. One screen at a time, hash routing (back and forward work), last tab remembered for the practice day (a new day opens on Today; Settings is never remembered). Today also has a tab, so there is always a way back to it. Module logic, contract v1 and every existing hook unchanged; structure only in `base.css` (zero-specificity `:where()` rules the theme can override).
- **Social-style tab bar (2026-11-01):** the phone bar becomes five fixed slots like Instagram or TikTok: Today, Practice, a larger centre Record (opens the Recorder), Songs, and More. More opens a sheet just above the bar with Ear training, Goals, Cards and Settings (it closes on choosing, a tap outside, Escape, More again or tabbing away). Each item is a simple inline SVG icon (currentColor) and a short label; the active one has `aria-current="page"`, and More is marked `data-current` when the screen shown lives in its sheet. Due-count badges: Practice shows what is due in the session open now; Cards shows theory cards due today (`dueToday`); hidden at zero, "99+" past 99, read with the tab name. From 800px the side nav lists every section and there is no More button. Hash routing, back and forward, the last tab per practice day (including screens in the sheet) and every existing hook unchanged; the gear stays in the top bar as well. Structure only, in `base.css` `:where()` rules.

- **Layout redesign (Blake, 2026-11-01):** every screen redesigned mobile first: fewer, larger rounded cards; one primary action per screen; long forms in bottom sheets (metronome settings, paste a song list, improv settings, new goal) as native modal dialogs closing on Escape, a backdrop tap, the close button or leaving the screen; archived songs and takes collapsed; 44px+ touch targets (tested on every screen); subtle transitions with reduced-motion respected; a cleaner bottom bar with a raised centre Record. Theme v6: lighter warm paper with the wood textures and Zuniga Mission kept as accents. Engine, module contract v1, the log and every existing hook untouched; no behaviour or timing changes (the sheets only move fields; modules read them as before).

- **Seven changes (Blake, 2026-11-02):**
  1. *Sign-in popup:* signed out with a connection set up, a sign-in popup (email code) opens at launch; "Not now" keeps this device only. The sign-in fields moved from Settings into the popup (Settings opens it).
  2. *Metronome silent, root cause:* the engine's neutral default time zone is UTC and nothing in the app replaced it unless the user pressed "Use this device's time zone". In New York the default quiet hours (9:00 to 17:00) then fell at 4am to noon local, covering the morning session, and the metronome refuses to sound in quiet hours; its only message went to the status line at the top of the page, out of sight. Fixed: settings never set get the device's time zone once (`adoptDeviceTimeZone`); a refusal shows under Start with "Play anyway" for that once; audio the browser keeps off is reported instead of playing silently; older iOS without the audio-session API gets a silent `<audio>` in the tap so the ring/silent switch does not mute the clicks.
  3. *Card sources* are no longer shown. Each card keeps its book and chapter as data.
  4. *Song tabs:* one file per song (PDF, picture, plain text), on the device and backed up to a private per-user `tabs` bucket (add and read own folder only, no overwrite or delete).
  5. *Baseline ratings:* songs never rated can be rated from the Songs screen without playing; that first review sets the starting memory state.
  6. *Curriculum:* one course from both books replaces the topic deck: 24 lessons in five chapters from absolute basics, every term defined before use, each lesson locked until the one before graduates (every card right last time with FSRS stability of 7+ days). The old deck's book cards are retired (history kept); its general cards are Extras, off by default.
  7. *Single-page flow:* Today leads with the current goal, then today's breakdown for it, then today's lesson (reading, cards and songs, goal tasks, metronome). The Practice screen is merged into Today; Goals takes its tab-bar slot. Songs, Record, Cards, Ear and Settings stay reachable. Opening the app always shows Today (the remembered last tab is superseded).

- **Home, menu and Teach (Blake, 2026-11-03):**
  1. *Home opens with a popup only:* on app open, Home shows a popup (opaque backdrop: nothing behind it shows) of today's objectives as bullet points. The goal summary and the day's breakdown moved into it; Home itself is the day's deck.
  2. *Objectives from the current goal:* the live goal with the nearest deadline, tied to what the plan covers now: its blocks for today, its songs in the session, the rest of the deck, other goals' blocks, the lesson on Teach.
  3. *Into the deck:* closing the popup (Start, the close button, Escape or a backdrop tap) moves smoothly into the deck (an entrance animation, a scroll to the deck, focus there); none of the animation under reduced motion. Opening on Home with no goal yet opens the new-goal sheet on Goals instead; saving that first goal returns to Home with its popup.
  4. *No tab bar:* the bottom bar, its More sheet, the laptop side nav and the gear are gone. No screen is removed.
  5. *One menu button* in the top corner (at least 44 by 44) lists Home, Teach, Record, Songs, Ear training, Goals, Cards, Settings, with the due-count badges (Home, Cards). It reuses the More sheet's disclosure logic and hooks, renamed (`menu`, `menu-list`, `menu-settings`).
  6. *Swipe between Home and Teach* by touch (a quick, mostly sideways stroke) and trackpad (horizontal wheel scrolling, once per gesture); the page dots (Home, Teach) are the visible, accessible way to do the same. Back and forward work as for any screen.
  7. *Teach* uses Home's flow: a popup of today's objectives from the current unlocked chapter, then the reading and the day's lesson deck (theory cards from the same scheduler, whatever the practice window). Chapter locking and graduation are unchanged.

- **Band members (Blake, 2026-11-03):**
  1. *Invite link:* in Settings, Band, an owner makes a single-use link (7 days) with a note saying who it is for, sees his invites (open, used, revoked, expired) and revokes open ones. The token is random (244 bits), stored on the server only as its SHA-256, shown to the owner once. Signing up through the link makes a band member account tied to the owner; it must be a brand-new account (no practice data, no band of its own), checked by the server. A sign-up without a link is an owner, exactly as before.
  2. *Role-limited app:* a band member's app has Songs and his own Settings (account, sign-out, sync, backup, his band status) and nothing else. No other module is set up or seeded; the menu lists only those two; any other screen's link (or a reload on one) lands on Songs (`screensFor`, `startScreen(hash, role)` in `harness/routes.ts`).
  3. *Shared data is read only:* he sees the owner's song titles and tabs and can open and download a tab; no add, rename, archive, restore or attach (not shown, refused by his app's replica, refused by the server). The owner's ratings, takes, goals, settings, other cards and practice log never reach him (the server sends only song items and song cards; his app checks again).
  4. *His own ratings:* baseline (without playing) and played ratings go to his own log as `review` events, in his own rows, and his own scheduler state comes from them alone. Each song row says when it is next due for him. They never mix with the owner's: neither can read the other's.
  5. *Enforced by the server:* `supabase/migrations/20261103120000_band_members.sql` (RLS on `events`, the `tabs` bucket, `nudges`; security-definer functions for everything else). Proven in `test/sql/rls.test.sql`.
  6. *Removal and deletion:* removing a member ends his access on the server immediately (every rule checks the membership on every query); his app sees it on its next sync (every rating, every minute, every launch online), reopens as "access removed" and deletes its copy of the owner's songs and tabs. Nothing of his is deleted by removal. Deleting his data is a separate action: owner only, only after removal, behind a confirm in the app. **It is the one delete path on the log** (principle 2 otherwise holds): it deletes only that removed member's own rows, the same rows deleting his account would delete. `test/log.test.ts` allows exactly these two band calls and nothing else.
  7. *Engine changes (contract v1 and the append-only log untouched):* a replica can carry a read-only *shared layer* (`Replica.open(store, device, { shared: { store, accept } })`): someone else's events in their own local store, pulled with their own cursor (`syncShared`), filtered by `accept`, never recorded to, uploaded or exported; the library is projected from both. `writable` limits which event types a replica records, restores or uploads (a band member: `review`, `settings-set`). `supabaseRemote(client, stream)` pulls one user's events (one cursor per user: two users' events can commit out of seq order).

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
| Post-gig voice memo, recorded creative prompts, improv takes (superseded Oct 31 2026: recorder, improv takes, songwriting prompts and the gig memo built, see amendments) | Need the recorder. Ship with the recorder module; block types are reserved now. |
| Shared-service interfaces (randomizer, recorder, metronome) | Defined with the first module that uses each one, not predicted now. |
| Conversational intake interview | Would need an AI service (no paid services). A form asks the same five questions. |
| One specialist bot per module | Conflicts with the minimal-headcount rule. One builder for everything. |
| Self-service account deletion button | Deleting a user in Supabase Auth already removes all their data (tested). A button needs a server function and a confirm flow; add before public launch. |
| Band members: more than one band per member, a band member inviting others, sharing anything but Songs I Already Know | Not asked for (Blake, 2026-11-03). One member belongs to one owner; the server refuses the rest. |
| Band members: reminders, goals, a practice deck, recordings | Not asked for: a member's app is Songs and Settings. His ratings schedule each song (shown as when it is next due), but nothing nudges him. The server refuses reminders and uploads for members. |
| Band members: wiping a removed member's own copy of HIS ratings from his device | His own data on his own device; he can export it. Only the owner's songs and tabs are deleted from his device on removal. A tab he already downloaded to his files can't be taken back. |
| Moving a signed-out device's practice into a new account | Local-only practice stays in its own local database. Export then Restore moves it. |
| Product UI | Built separately against `docs/API.md`; the harness is deliberately bare. |
| Graphics pass changing layout structure, behavior, timing or beat-tied animation | The graphics lead (ChatGPT) edits only look files in `harness/static/theme/` (CSS, design tokens, icons, fonts; see `docs/THEME.md`). Structure is fixed by `data-zg` hooks guarded by `test/hooks.test.ts`; behavior, timing and anything tied to the beat stay in code. |
| Metronome pattern/groove editor | UI work; the four presets cover the request. Patterns are already data (`hitsFor`), so an editor can be added without engine changes. |
| Timing error from the microphone | Needs the recorder module (mic access). Until then timing error comes from tapping along, which includes touch-screen delay. |
| Recorder, improv takes, creative prompts, gig memo (superseded Oct 31 2026, all built, see amendments) | Still deferred: they need the recorder, not the metronome. They will sync to the metronome clock service. |
| Removing `setup-keys.html` | Needed only for setup. On the pre-customer checklist in `docs/SETUP.md`; removal waits for Blake's yes. |
| Hard delete of a song | The log is append-only; Blake asked for archive. Archived songs are not served and can be restored with their history. |
| Song details (chords, keys, links) (tabs superseded 2026-11-02: one tab file per song) | Blake, 2026-10-31: a song card holds only a title. |
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
| Goals: the post-gig rundown voice memo (`gig-memo`) (superseded Oct 31 2026: Blake chose gig night, built) | The recorder can record it, but it belongs after the gig, when the goal has already expired. Needs a decision on when it shows (gig night? the next morning?). Stays reserved. |
| Goals: AI-written or personalised songwriting prompts | Would need an AI service (no paid services). Twenty fixed prompts rotate; a goal can set its own. |
| Goals: counting songs written, "ideas", or output | No arbitrary counts (spec). Blocks are timed and recorded; the takes are the record of the work. |
| Goals: editing a goal's blocks after saving | Check-ins adjust the daily minutes, as specified. For new blocks, archive the goal and make a new one (history kept). |
| Theory: lessons beyond flashcards (explanations, diagrams, audio demos) (explanations superseded 2026-11-02: each lesson has a written reading) | Flashcards first, as asked. The cards are data, so lessons can link to them later. |
| Theory: quoting or reproducing Benade or Winer | Copyright. Every card states facts in original words and cites the chapter; no passages, no figures. |
| Theory: a chapter for topics neither book covers (CAGED, modes, cassette types, a specific machine) | Marked as general knowledge instead of attaching an unrelated chapter. |
| Theory: practising one topic only for a session (superseded 2026-11-02: the curriculum replaces topics) | Topics switch on and off for scheduling; a one-topic practice mode was not asked for. |
| Gig memo: a reminder notification on gig night | Not asked for; the memo shows when the app is opened. Notifications stay one per practice window. |
| Shell: icons in the tab bar, transitions, swipe between tabs (icons superseded 2026-11-01: simple SVG icons in place; transitions and swipe still not done) | Visual work for the graphics pass; labels and structure are in place. |
| Shell: a separate screen per module setting (e.g. a quiet-hours picker with a clock) | Settings uses plain fields; the raw settings editor stays in the developer panel for everything else. |
| Shell: remembering the scroll position of each screen | Not asked for. Every screen opens at the top when you switch to it. |
| Tab bar: the centre Record button starting a recording at once | A tap on a tab bar is easy to make by accident, and it would raise the microphone prompt. It opens the Recorder with its Record button at the top: two taps to capture. |
| Tab bar: practising cards from the Cards screen | Theory cards are practised in today's lesson on Today (Practice until 2026-11-02) during pocket bursts (they are silent cards). The Cards badge counts what is due today; the Cards screen switches topics. A practise-now button there was not asked for. |
| Tab bar: a separate `nav-record` hook | `tab-record` already names the centre button; a second name for the same element adds nothing. |
| Theory (2026-11-02): skipping ahead to a later lesson | Blake asked for new material locked until graduation. There is no unlock-by-hand (unlike ear training's levels). |
| Theory (2026-11-02): folding the 17 general cards (guitar theory, cassette gear) into the course | Not book-based, so outside the rebuild. Kept as Extras, off by default, switchable on the Cards screen. Folding them in, or retiring them for good, is Blake's call. |
| Theory (2026-11-02): lesson readings with diagrams or audio | Text first. Copyright rules out reproducing the books' figures; original diagrams could come later. |
| Tabs (2026-11-02): more than one file per song, editing a text tab in the app, a full PDF viewer | One tab per song, as asked. PDFs show in a frame (iOS shows the first page) with "Open full size" for the browser's own viewer. |
| Single page (2026-11-02): ear training and recording inside today's lesson | They keep their own screens; a goal block's Record and an ear card's Practise hand off to them, as before. |
| Home (2026-11-03): closing the objectives popup by itself after a few seconds | Text that disappears on a timer is hard to read at your own pace (and an accessibility problem). The popup waits for Start; everything after Start is automatic. Easy to add if wanted. |
| Teach (2026-11-03): a due-count badge on Teach in the menu | The Cards badge already counts the theory cards due; two badges for the same cards would be noise. |
| Teach (2026-11-03): keeping theory cards out of Home's deck | Home's deck is the session as the scheduler builds it (theory cards are silent cards, served in pocket bursts). Changing the session builder is outside these items. |
| Swipe (2026-11-03): swiping from or to screens other than Home and Teach | Asked for Home and Teach only; the menu reaches the rest. |
| Layout: dark mode | The theme is light only now (Blake asked for lighter). A dark variant can come back as tokens under `prefers-color-scheme: dark`. |
| Layout: swipe gestures (swipe a sheet down, swipe between tabs) | Sheets close by Escape, backdrop tap, close button or leaving the screen. Swipe needs touch-gesture code; not asked for. |
