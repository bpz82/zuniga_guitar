/**
 * Horizontal swipe between Home and Teach (Blake, 2026-11-03), by touch and
 * by trackpad. The page dots (pager-today, pager-teach) are the visible,
 * accessible way to do the same thing; swiping is a shortcut.
 *
 * Touch: a quick, mostly horizontal stroke. Vertical scrolling is untouched
 * (base.css lets the browser pan vertically and pinch-zoom on the pages, so
 * the browser hands horizontal strokes to the app). Strokes that start on a
 * slider, a text box or inside a popup are ignored.
 *
 * Trackpad: two-finger horizontal scrolling arrives as wheel events with a
 * horizontal delta. Enough of it, mostly sideways, counts as one swipe; the
 * next swipe needs the fingers to stop first.
 */

/** A touch stroke counts as a swipe past this many pixels sideways... */
export const SWIPE_MIN_PX = 60;
/** ...when it is at least this much more sideways than up or down... */
export const SWIPE_SLOPE = 1.5;
/** ...and takes at most this long (a slow drag is not a swipe). */
export const SWIPE_MAX_MS = 800;
/** Horizontal trackpad scrolling that counts as one swipe, in pixels. */
export const WHEEL_SWIPE_PX = 120;
/** Wheel events further apart than this start a new gesture. */
export const WHEEL_GAP_MS = 250;

export type Swipe = 'left' | 'right';

/** A finished touch stroke: a swipe left (finger moved left), right, or none. */
export function swipeOf(dx: number, dy: number, ms: number): Swipe | null {
  if (![dx, dy, ms].every(Number.isFinite)) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < SWIPE_SLOPE * Math.abs(dy) || ms > SWIPE_MAX_MS) return null;
  return dx < 0 ? 'left' : 'right';
}

/**
 * Trackpad gestures from wheel events. Feed every event; it returns a swipe
 * once per gesture. Scrolling content to the right (deltaX > 0: fingers move
 * left, as when turning a page) is a swipe left.
 */
export class WheelSwipe {
  #sum = 0;
  #last = Number.NEGATIVE_INFINITY;
  #spent = false;

  feed(deltaX: number, deltaY: number, at: number): Swipe | null {
    if (![deltaX, deltaY, at].every(Number.isFinite)) return null;
    if (at - this.#last > WHEEL_GAP_MS) {
      this.#sum = 0;
      this.#spent = false;
    }
    this.#last = at;
    if (this.#spent || Math.abs(deltaX) <= Math.abs(deltaY)) return null;
    this.#sum += deltaX;
    if (Math.abs(this.#sum) < WHEEL_SWIPE_PX) return null;
    this.#spent = true;
    const swipe: Swipe = this.#sum > 0 ? 'left' : 'right';
    this.#sum = 0;
    return swipe;
  }
}

/** Where a stroke may not start: sliders, text boxes, tab files, popups. */
const IGNORE = 'input[type="range"], textarea, select, pre, iframe, dialog';

/**
 * Listens on `area` (touch) and the window (trackpad). `blocked()` says when
 * swiping is off (not on a page, a popup or the menu open); `onSwipe` gets
 * each swipe.
 */
export function setupSwipe(area: HTMLElement, blocked: () => boolean, onSwipe: (swipe: Swipe) => void): void {
  let start: { x: number; y: number; t: number; id: number } | null = null;
  area.addEventListener('pointerdown', (e) => {
    start = null;
    if (e.pointerType === 'mouse' || blocked()) return;
    if (e.target instanceof Element && e.target.closest(IGNORE)) return;
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  });
  area.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const swipe = swipeOf(e.clientX - start.x, e.clientY - start.y, e.timeStamp - start.t);
    start = null;
    if (swipe && !blocked()) onSwipe(swipe);
  });
  area.addEventListener('pointercancel', () => (start = null)); // the browser took the stroke (vertical scroll)

  const wheel = new WheelSwipe();
  window.addEventListener(
    'wheel',
    (e) => {
      if (blocked()) return;
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1; // lines or pages to pixels
      const swipe = wheel.feed(e.deltaX * scale, e.deltaY * scale, e.timeStamp);
      if (swipe) onSwipe(swipe);
    },
    { passive: true },
  );
}
