/** Public engine API. The UI and modules import from here only. */
export * from './model.ts';
export { validateBody, validateEvent } from './validate.ts';
export type { Validation } from './validate.ts';
export { append, merge, replay, emptyLog, compareEvents, canonical, RejectedEvent } from './log.ts';
export type { Log, AppendContext, Rejection } from './log.ts';
export { project, cardsOfItem } from './project.ts';
export type { Library } from './project.ts';
export { memoryOf, retrievability, buildQueue, usesSteps, LEECH_LAPSES, NO_STEP_MODULES } from './scheduler.ts';
export type { Memory, Phase, QueueOptions, DueCard, Queue } from './scheduler.ts';
export { practiceDay, dayBegins, daysBetween, addDays } from './day.ts';
export {
  goalFromIntake,
  planGoals,
  goalQueue,
  splitTime,
  apportion,
  isActive,
  GIG_DEFAULT_RETENTION,
  FINAL_WEEK_DAYS,
  CHECK_IN_DAYS,
  BASE_WEIGHT,
  PROTECTED_KINDS,
  gigMemos,
  GIG_MEMO_FROM,
} from './goals.ts';
export type { Intake, PlannedBlock, CheckIn, GoalPlan } from './goals.ts';
export { timeOnDay } from './day.ts';
export { sessionFor, windowsFor, currentWindow, isQuiet, nudgesBetween, BURST_MINUTES, MODE_TAGS } from './session.ts';
export type { Mode, WindowSlot, Session, Segment, ReviewSegment, BlockSegment, Nudge } from './session.ts';
export { goalFromForm, blocksFromForm, tasksFromText, archiveGoal, checkInGoal, FORM_LIMITS } from './goal-form.ts';
export type { GoalForm } from './goal-form.ts';
export { settingsFromOnboarding, changeSettings, toggleNotifications, toggleWindowNotify, toggleAlwaysRemindMorning } from './settings.ts';
export type { Onboarding } from './settings.ts';
export { Replica, memoryStore } from './replica.ts';
export type { EventStore, StoredState, StoreChange, Remote, SyncReport } from './replica.ts';
export { supabaseRemote, planNudges, uploadNudges, NUDGE_HORIZON_DAYS } from './remote.ts';
export type { SupabaseLike } from './remote.ts';
export { createHost, runModule, ContractViolation, CONTRACT_VERSION, MAX_WRITES_PER_HOUR } from './contract.ts';
export type { ModuleHost, ModuleManifest } from './contract.ts';
export { TEST_DECK, seedTestDeck, deckEntries, prompt, chordSpelling, spell } from './modules/test-deck.ts';
export { SONGS, MAX_TITLE, MAX_PASTE, cleanTitle, songs, songByCard, addSong, pasteSongs, renameSong, archiveSong, restoreSong, rateSong } from './modules/songs.ts';
export type { Song, PasteReport } from './modules/songs.ts';
