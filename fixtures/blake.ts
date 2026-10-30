/**
 * Blake's own settings (2026-10-30). Not engine defaults: this is the
 * settings-set event his account starts with, used as a seed and in tests.
 */
import type { EventBody, Settings } from '../src/index.ts';

export const BLAKE_SETTINGS: Settings = Object.freeze({
  desiredRetention: 0.9,
  dayStart: Object.freeze({ timeZone: 'America/New_York', hour: 3 }),
  quietHours: Object.freeze({ start: '10:30', end: '16:00' }),
  morningMinutes: 60,
  notifications: true,
  windows: Object.freeze([
    Object.freeze({ id: 'morning', start: '04:00' }),
    Object.freeze({ id: 'before-work', start: '09:45' }),
    Object.freeze({ id: 'during-work', start: '13:00' }),
    Object.freeze({ id: 'after-work', start: '16:30' }),
  ]),
}) as Settings;

export const BLAKE_SETTINGS_EVENT: EventBody = { type: 'settings-set', settings: BLAKE_SETTINGS };
