/**
 * Zuniga Guitar engine: data model (checkpoint 1).
 *
 * One rule shapes everything here: the event log is the only source of truth.
 * Items, cards, goals and settings are written as "-set" events (latest wins);
 * practice is written as review / feel-session / task-done / played events.
 * Nothing is ever updated or deleted. Current state is derived by replaying
 * the log, so syncing two devices is a set union of events.
 */

/** Schema version stamped on every event. Bump only with a migration plan. */
export const SCHEMA_VERSION = 1;

/** FSRS's four ratings. */
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

/** Where a card can be practiced. A card may carry more than one tag. */
export type CardTag = 'guitar' | 'pocket-sound' | 'pocket-silent';
export const CARD_TAGS: readonly CardTag[] = ['guitar', 'pocket-sound', 'pocket-silent'];

/** Free-form, module-owned data. Flat and small on purpose. */
export type Details = Readonly<Record<string, string | number | boolean>>;

/** Something to learn (a fretboard note, a chord, a song). Generates cards. */
export interface Item {
  readonly id: string;
  /** Which module owns this item, e.g. "test-deck", later "songs". */
  readonly module: string;
  /** Module-defined content, e.g. { string: "A", fret: "5" }. */
  readonly fields: Details;
}

/** One practicable prompt generated from an item. Holds no scheduling state. */
export interface Card {
  readonly id: string;
  /** Sibling cards share an itemId (kept for burying, deferred to Songs). */
  readonly itemId: string;
  /** Module-defined card type, e.g. "name-the-note". */
  readonly template: string;
  readonly tags: readonly CardTag[];
  /** Retired cards stop being scheduled; their history is kept forever. */
  readonly retired: boolean;
}

/**
 * Goal building blocks. Every block shares the base fields, so the session
 * builder can place any block by time without knowing what it is. Deferred
 * kinds are reserved now so their modules slot in without reworking goals.
 */
export type ActiveBlockKind = 'recall' | 'feel-session' | 'timed-task';
/** Reserved: behavior ships with the recorder and metronome modules. */
export type DeferredBlockKind = 'tempo-ladder' | 'creative-prompt' | 'improv-takes' | 'gig-memo';
export type BlockKind = ActiveBlockKind | DeferredBlockKind;
export const ACTIVE_BLOCK_KINDS: readonly ActiveBlockKind[] = ['recall', 'feel-session', 'timed-task'];
export const DEFERRED_BLOCK_KINDS: readonly DeferredBlockKind[] = [
  'tempo-ladder',
  'creative-prompt',
  'improv-takes',
  'gig-memo',
];

export interface GoalBlock {
  readonly id: string;
  readonly kind: BlockKind;
  /** Human label, e.g. "10 min in Chord Chemistry". */
  readonly label: string;
  /** Daily minutes for this block. */
  readonly minutes: number;
  /** Kind-specific settings, owned by whichever module implements the kind. */
  readonly params?: Details;
}

export type GoalKind = 'general' | 'gig';

/** Created by the intake form. Goals never touch memory state. */
export interface Goal {
  readonly id: string;
  readonly kind: GoalKind;
  readonly what: string;
  readonly why: string;
  /** Local calendar date, "YYYY-MM-DD". The goal expires after this day. */
  readonly deadline: string;
  readonly itemIds: readonly string[];
  readonly dailyMinutes: number;
  /** Relative weight against other active goals. > 0. */
  readonly weight: number;
  /** Overrides desired retention for this goal's items. 0.7 to 0.99. */
  readonly targetRetention?: number;
  readonly blocks: readonly GoalBlock[];
  /** Archived goals are ignored by planning; kept in history. */
  readonly archived: boolean;
}

export type WindowId = 'morning' | 'before-work' | 'during-work' | 'after-work';
export const WINDOW_IDS: readonly WindowId[] = ['morning', 'before-work', 'during-work', 'after-work'];

export interface PracticeWindow {
  readonly id: WindowId;
  /** Local time "HH:MM". A session starts here; a notification may fire here. */
  readonly start: string;
  /** Per-window notification toggle. Absent means on. */
  readonly notify?: boolean;
}

/**
 * When a practice day begins. Everything day-based uses it: FSRS's day
 * counting, what is due "today", goal deadlines and expiry. Window times and
 * quiet hours use the same time zone. Set per user at onboarding.
 */
export interface DayStart {
  /** IANA time zone, e.g. "America/New_York". */
  readonly timeZone: string;
  /** Local hour the day starts, 0 to 23. */
  readonly hour: number;
}

/** Neutral until onboarding records the user's own zone. */
export const DEFAULT_DAY_START: DayStart = Object.freeze({ timeZone: 'UTC', hour: 4 });

/** A daily stretch when sound is not allowed (work). "HH:MM" local; may wrap midnight. */
export interface QuietHours {
  readonly start: string;
  readonly end: string;
}

/** Settings as recorded in the log. Optional fields may be absent in older events. */
export interface SettingsInput {
  /** Default desired retention, 0.7 to 0.99. */
  readonly desiredRetention: number;
  readonly windows: readonly PracticeWindow[];
  readonly dayStart?: DayStart;
  /** Inside quiet hours only silent cards are served, whatever the window. */
  readonly quietHours?: QuietHours;
  /** Length of the morning guitar session. Spec: 1 hour minimum. 60 to 300. */
  readonly morningMinutes?: number;
  /** Master notification switch. Absent means off: users opt in. */
  readonly notifications?: boolean;
}

/** Settings as the engine uses them: every field resolved. */
export interface Settings extends SettingsInput {
  readonly dayStart: DayStart;
  readonly quietHours: QuietHours;
  readonly morningMinutes: number;
  readonly notifications: boolean;
}

/**
 * Generic defaults for a brand-new user, before onboarding. Nobody's real
 * schedule: onboarding (settingsFromOnboarding) records the user's own, and
 * every value can be changed at any time with a settings-set event.
 */
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  desiredRetention: 0.9,
  dayStart: DEFAULT_DAY_START,
  quietHours: Object.freeze({ start: '09:00', end: '17:00' }),
  morningMinutes: 60,
  notifications: false,
  windows: Object.freeze([
    Object.freeze({ id: 'morning', start: '07:00' }),
    Object.freeze({ id: 'before-work', start: '08:30' }),
    Object.freeze({ id: 'during-work', start: '12:30' }),
    Object.freeze({ id: 'after-work', start: '17:30' }),
  ]) as readonly PracticeWindow[],
});

// ---------------------------------------------------------------- events ---

/** Fields every event carries. Set by the engine, never by callers. */
export interface EventMeta {
  readonly v: typeof SCHEMA_VERSION;
  /** UUID. Identity for merge: same id means same event. */
  readonly id: string;
  /** Milliseconds since epoch, from the recording device's clock. */
  readonly at: number;
  /** Which device recorded it. */
  readonly device: string;
}

export interface ItemSet { readonly type: 'item-set'; readonly item: Item }
export interface CardSet { readonly type: 'card-set'; readonly card: Card }
export interface GoalSet { readonly type: 'goal-set'; readonly goal: Goal }
export interface SettingsSet { readonly type: 'settings-set'; readonly settings: SettingsInput }

/** One graded rep of one card. The only event FSRS reads. */
export interface Review {
  readonly type: 'review';
  readonly cardId: string;
  readonly rating: Rating;
  readonly durationMs: number;
  /** Module extras such as tempo or timing error. Stored, ignored by FSRS. */
  readonly details?: Details;
}

/** Guitar yoga: timed, ungraded, a feel note afterward. */
export interface FeelSession {
  readonly type: 'feel-session';
  readonly goalId?: string;
  readonly durationMs: number;
  readonly note: string;
}

/** A timed task from a goal, checked off. */
export interface TaskDone {
  readonly type: 'task-done';
  readonly goalId: string;
  readonly blockId: string;
  readonly durationMs: number;
}

/** One-tap "I played" for unstructured time. */
export interface Played {
  readonly type: 'played';
  readonly minutes: number;
}

/** What a caller hands to append(): an event without its metadata. */
export type EventBody = ItemSet | CardSet | GoalSet | SettingsSet | Review | FeelSession | TaskDone | Played;
export type EventType = EventBody['type'];
export const EVENT_TYPES: readonly EventType[] = [
  'item-set',
  'card-set',
  'goal-set',
  'settings-set',
  'review',
  'feel-session',
  'task-done',
  'played',
];

/** A stored event: body plus engine-assigned metadata. Always deep-frozen. */
export type EngineEvent = EventMeta & EventBody;
export type EventOf<T extends EventType> = EventMeta & Extract<EventBody, { type: T }>;
