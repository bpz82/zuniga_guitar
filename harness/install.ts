/**
 * "Put it on your phone" (Blake, 2026-11-03): right after a band member
 * first opens the app signed in, in a browser, a popup walks him through
 * adding it to his Home Screen. The steps depend on the device. Pure
 * functions only; the popup itself is drawn in main.ts.
 *
 * On iPhone the Home Screen app keeps its own storage, separate from
 * Safari's, so it starts signed out: the steps say to sign in again there.
 * His membership is on the server, so signing in with the same email is all
 * it takes. On Android the installed app shares Chrome's sign-in.
 */

export type Platform = 'ios' | 'android' | 'desktop';

/** Which kind of device this is, from the browser's user agent (iPads report themselves as Macs with touch). */
export function platformOf(userAgent: string, maxTouchPoints = 0): Platform {
  const ua = String(userAgent);
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** Whether to open the popup by itself: once per account on this device, for a band member, in a browser (not the Home Screen app). */
export function offerInstall(o: { member: boolean; standalone: boolean; offeredBefore: boolean }): boolean {
  return o.member && !o.standalone && !o.offeredBefore;
}

export interface InstallGuide {
  readonly intro: string;
  readonly steps: readonly string[];
}

/** The walk-through for a device. `appUrl` is the app's address (for opening it on a phone from a computer). */
export function installGuide(platform: Platform, appUrl: string): InstallGuide {
  if (platform === 'ios') {
    return {
      intro: 'It opens full screen like any app, and your band\'s songs and tabs work offline. Three steps:',
      steps: [
        'Tap the Share button (the square with an arrow pointing up) in Safari\'s toolbar.',
        'Scroll down, tap Add to Home Screen, then tap Add.',
        'Open Zuniga Guitar from your Home Screen and sign in again with the same email. The Home Screen app keeps its own sign-in, separate from Safari, so this is needed once.',
      ],
    };
  }
  if (platform === 'android') {
    return {
      intro: 'It opens full screen like any app, and your band\'s songs and tabs work offline. Three steps:',
      steps: [
        'Tap Chrome\'s menu (the three dots at the top right).',
        'Tap Install app (on some phones: Add to Home screen), then Install.',
        'Open Zuniga Guitar from your Home screen. You stay signed in.',
      ],
    };
  }
  return {
    intro: 'To have it on your phone too:',
    steps: [
      `On your phone, open ${appUrl}`,
      'Sign in with the same email (we email you a code).',
      'Add it to your Home Screen. iPhone: in Safari, tap Share, then Add to Home Screen. Android: in Chrome, tap the menu (three dots), then Install app.',
    ],
  };
}
