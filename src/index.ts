/** Public engine API. The UI and modules import from here only. */
export * from './model.ts';
export { validateBody, validateEvent } from './validate.ts';
export type { Validation } from './validate.ts';
export { append, merge, replay, emptyLog, compareEvents, canonical, RejectedEvent } from './log.ts';
export type { Log, AppendContext, Rejection } from './log.ts';
export { project, cardsOfItem } from './project.ts';
export type { Library } from './project.ts';
export { memoryOf, retrievability, buildQueue, usesSteps, isExtraReview, scheduledReviews, LEECH_LAPSES, NO_STEP_MODULES } from './scheduler.ts';
export type { Memory, Phase, QueueOptions, DueCard, Queue } from './scheduler.ts';
export { practiceDay, dayBegins, daysBetween, addDays } from './day.ts';
export {
  goalFromIntake,
  planGoals,
  goalQueue,
  splitTime,
  apportion,
  isActive,
  focusGoal,
  changeGoal,
  GIG_DEFAULT_RETENTION,
  FINAL_WEEK_DAYS,
  CHECK_IN_DAYS,
  BASE_WEIGHT,
  PROTECTED_KINDS,
  gigMemos,
  GIG_MEMO_FROM,
} from './goals.ts';
export type { Intake, PlannedBlock, CheckIn, GoalPlan, GoalEdit } from './goals.ts';
export { timeOnDay } from './day.ts';
export { sessionFor, todayBlocks, dueToday, windowsFor, currentWindow, isQuiet, nudgesBetween, BURST_MINUTES, MODE_TAGS } from './session.ts';
export type { Mode, WindowSlot, Session, Segment, ReviewSegment, BlockSegment, Nudge } from './session.ts';
export { goalFromForm, blocksFromForm, tasksFromText, archiveGoal, checkInGoal, FORM_LIMITS } from './goal-form.ts';
export type { GoalForm } from './goal-form.ts';
export { seededRng, pick, pickInt, different } from './random.ts';
export type { Rng } from './random.ts';
export { EAR_GUITARS, EAR_SOURCES, BEATO_ALTERNATIVE, suggestionOf as earSuggestion, randomEar } from './modules/ear/randomizer.ts';
export type { EarSuggestion } from './modules/ear/randomizer.ts';
export { IMPROV_GUITARS, IMPROV_CHORDS, IMPROV_INSTRUCTION, improvSuggestion, randomImprov } from './modules/recorder/randomizer.ts';
export type { ImprovSuggestion } from './modules/recorder/randomizer.ts';
export { METRONOME_WORKOUTS, KEYS, metronomeSuggestion, randomMetronome } from './modules/metronome/randomizer.ts';
export type { MetronomeSuggestion, WorkoutId } from './modules/metronome/randomizer.ts';
export {
  REQUIRED_MINUTES,
  REQUIRED_AREAS,
  SONGS_PER_SESSION,
  NEW_SONGS_PER_SESSION,
  planPractice,
  newTimer,
  elapsedOf,
  remainingOf,
  isComplete,
  isRunning,
  startTimer,
  pauseTimer,
  clock,
  newRun,
  isFinished,
  currentStep,
  timerOf,
  startStep,
  pauseStep,
  pickFor,
  finishStep,
  skipStep,
  recordFor,
  parseRun,
} from './practice.ts';
export type { PracticePlan, PracticeRun, Step, TimedStep, SongStep, StepProgress, TimerState, RequiredArea, Tool, Pick as PracticePick } from './practice.ts';
export { DAILY_NEW_CARDS, nextReview, reviewCounts, isExtraNow } from './review.ts';
export type { ReviewMode, ReviewKind, ReviewFilter, ReviewPick, ReviewCounts } from './review.ts';
export { settingsFromOnboarding, changeSettings, toggleNotifications, toggleWindowNotify, toggleAlwaysRemindMorning, adoptDeviceTimeZone } from './settings.ts';
export type { Onboarding } from './settings.ts';
export { Replica, memoryStore } from './replica.ts';
export type { EventStore, StoredState, StoreChange, Remote, SyncReport, SharedLayer, ReplicaOptions } from './replica.ts';
export { supabaseRemote, planNudges, uploadNudges, NUDGE_HORIZON_DAYS } from './remote.ts';
export type { SupabaseLike } from './remote.ts';
export { createHost, runModule, ContractViolation, CONTRACT_VERSION, MAX_WRITES_PER_HOUR } from './contract.ts';
export type { ModuleHost, ModuleManifest } from './contract.ts';
export { TEST_DECK, seedTestDeck, deckEntries, prompt, chordSpelling, spell } from './modules/test-deck.ts';
export {
  SONGS,
  MAX_TITLE,
  MAX_PASTE,
  cleanTitle,
  songs,
  songByCard,
  addSong,
  pasteSongs,
  renameSong,
  archiveSong,
  restoreSong,
  rateSong,
  unratedSongs,
  rateBaseline,
  TAB_TYPES,
  MAX_TAB_BYTES,
  tabTypeOf,
  tabPath,
  attachTab,
  pendingTabs,
  markTabUploaded,
  uploadPendingTabs,
  tabFile,
} from './modules/songs.ts';
export type { Song, SongTab, TabType, TabFiles, TabStorage, PasteReport } from './modules/songs.ts';
export {
  MEMBER_WRITES,
  isSharedSongEvent,
  parseRole,
  parseBand,
  cleanNote,
  inviteFor,
  bandRole,
  bandOverview,
  createInvite,
  revokeInvite,
  acceptInvite,
  removeMember,
  deleteMemberData,
  inviteLink,
  inviteFromUrl,
  inviteWhen,
  INVITE_TOKEN,
  MAX_NOTE,
} from './band.ts';
export type { BandRole, Band, Invite, Member, RpcLike } from './band.ts';
