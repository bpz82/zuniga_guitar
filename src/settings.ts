/**
 * User settings: onboarding and edits. Every function returns a validated
 * settings-set event body for append(); nothing is written here. A
 * settings-set always carries the complete settings, so an edit never loses a
 * field it did not mention.
 */
import { validateBody } from './validate.ts';
import type { Validation } from './validate.ts';
import type { Library } from './project.ts';
import type { EventBody, PracticeWindow, SettingsInput, WindowId } from './model.ts';

/** What the onboarding interview asks a new user. Leave a window out to skip it. */
export interface Onboarding {
  /** IANA zone from the device, e.g. Intl.DateTimeFormat().resolvedOptions().timeZone. */
  readonly timeZone: string;
  /** Hour the practice day starts (default 4). Pick a time you are always asleep. */
  readonly dayStartHour?: number;
  /** "HH:MM" start of each session the user wants. */
  readonly morning?: string;
  readonly beforeWork?: string;
  readonly duringWork?: string;
  readonly afterWork?: string;
  /** Work (quiet) hours: silent cards only. */
  readonly workStart?: string;
  readonly workEnd?: string;
  readonly morningMinutes?: number;
  readonly desiredRetention?: number;
  /** Master notification switch. Default off; turning it on needs the user's permission prompt too. */
  readonly notifications?: boolean;
}

const ONBOARDING_WINDOWS: readonly [keyof Onboarding, WindowId][] = [
  ['morning', 'morning'],
  ['beforeWork', 'before-work'],
  ['duringWork', 'during-work'],
  ['afterWork', 'after-work'],
];

export function settingsFromOnboarding(answers: Onboarding): Validation<EventBody> {
  const windows: PracticeWindow[] = [];
  for (const [field, id] of ONBOARDING_WINDOWS) {
    const start = answers[field];
    if (typeof start === 'string') windows.push({ id, start });
  }
  const hasWork = answers.workStart !== undefined || answers.workEnd !== undefined;
  return validateBody({
    type: 'settings-set',
    settings: {
      desiredRetention: answers.desiredRetention ?? 0.9,
      windows,
      dayStart: { timeZone: answers.timeZone, hour: answers.dayStartHour ?? 4 },
      ...(hasWork ? { quietHours: { start: answers.workStart, end: answers.workEnd } } : {}),
      ...(answers.morningMinutes === undefined ? {} : { morningMinutes: answers.morningMinutes }),
      notifications: answers.notifications ?? false,
    },
  });
}

/** Edits any settings: the current settings with `changes` applied. */
export function changeSettings(library: Library, changes: Partial<SettingsInput>): Validation<EventBody> {
  return validateBody({ type: 'settings-set', settings: { ...library.settings, ...changes } });
}

/** The master notification switch. */
export function toggleNotifications(library: Library, on: boolean): Validation<EventBody> {
  return changeSettings(library, { notifications: on });
}

/** One window's notification toggle. Refuses a window the user does not have. */
export function toggleWindowNotify(library: Library, windowId: WindowId, on: boolean): Validation<EventBody> {
  if (!library.settings.windows.some((w) => w.id === windowId)) {
    return { ok: false, error: `event.settings.windows: no ${windowId} window` };
  }
  const windows = library.settings.windows.map((w) => (w.id === windowId ? { ...w, notify: on } : w));
  return changeSettings(library, { windows });
}
