Blake's decisions on your first reply:

SCOPE: You build the ENGINE ONLY: logic, data, scheduling, goals, session builder, sync, and tests. No graphics, styling, or visual design. ChatGPT will do the visuals later, so expose a clean, documented API and state the UI can plug into, plus only a bare functional test harness. Later you'll likely build the individual modules too, one builder for everything. ZUNIGA GUITAR MANAGER is the manager, tester, and gate. Nothing goes live without its testing, and nothing gets deleted without Blake's yes.

1. Deletions APPROVED: monthly retraining, load balancing, stats screen (one line on Today at most), Cloudflare R2. One builder bot for all modules: APPROVED.
   REJECTED: cutting notifications. Blake wants reliable push notifications that work once the app is installed on his phone (iPhone, installed home-screen app) and laptop. Keep them in scope with the simplest reliable design (Web Push with VAPID, a Supabase cron or edge function). Recorder and metronome-dependent goal blocks (gig memo, recorded prompts, improv takes, tempo ladders): defer them to their modules, but design the goal block types so they slot in without rework.
2. Keep fuzz and learning/relearning steps. Defer sibling burying to the Songs module, but keep the item-to-cards link in the model.
3. Check-in: your proposal is APPROVED.
4. GitHub is now connected to this Claude account. Use it.

FSRS: before adopting ts-fsrs, show your sources. Tell us where it comes from (repo, maintainers, license, how it relates to the original FSRS research and open-spaced-repetition), what evidence shows the algorithm works (published benchmarks, Anki's adoption), how actively it's maintained, and why we should trust it over writing our own. Give links.

Isolation rule: modules may touch the engine ONLY through the module contract, never its data directly. A broken module must never be able to corrupt the event log.

Next: answer the FSRS trust question, confirm the updated scope, then do checkpoint 1 (data model plus tests) and stop for review. Keep the design check before every build.
