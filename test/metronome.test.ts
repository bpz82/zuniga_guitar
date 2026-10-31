import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  findOnset,
  fromFields,
  hitsFor,
  isMutedBar,
  rampBpm,
  tapTempo,
  tapTiming,
  TickPlanner,
  toFields,
  validateConfig,
} from '../src/modules/metronome/core.ts';
import type { MetronomeConfig, Tick } from '../src/modules/metronome/core.ts';
import { LookaheadScheduler } from '../src/modules/metronome/scheduler.ts';
import { ScheduledClock } from '../src/services/metronome-clock.ts';

const cfg = (over: Partial<MetronomeConfig> = {}): MetronomeConfig => ({ ...DEFAULT_CONFIG, countInBars: 0, ...over });
const take = (p: TickPlanner, n: number): Tick[] => Array.from({ length: n }, () => p.next()!).filter(Boolean);
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// ------------------------------------------------------------ settings ---

test('defaults are valid, moderate in volume, and silent in quiet hours', () => {
  const r = validateConfig(DEFAULT_CONFIG);
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.equal(DEFAULT_CONFIG.allowDuringQuietHours, false);
  assert.ok(DEFAULT_CONFIG.master <= 0.7);
});

test('settings validation refuses anything out of range or unknown', () => {
  const bad: [Partial<Record<string, unknown>>, RegExp][] = [
    [{ bpm: 29 }, /bpm/],
    [{ bpm: 301 }, /bpm/],
    [{ bpm: 120.5 }, /bpm/],
    [{ beatsPerBar: 0 }, /beatsPerBar/],
    [{ beatUnit: 3 }, /beatUnit/],
    [{ subdivision: 5 }, /subdivision/],
    [{ groove: 'disco' }, /groove/],
    [{ master: 1.5 }, /master/],
    [{ accentHz: 50 }, /accentHz/],
    [{ countInBars: 9 }, /countInBars/],
    [{ volumes: { ...DEFAULT_CONFIG.volumes, kick: 2 } }, /volumes\.kick/],
    [{ volumes: { ...DEFAULT_CONFIG.volumes, cowbell: 1 } }, /cowbell/],
    [{ surprise: true }, /unknown setting/],
    [{ workout: 'ladder', bpm: 120, targetBpm: 100 }, /climb/],
    [{ allowDuringQuietHours: 'yes' }, /allowDuringQuietHours/],
  ];
  for (const [over, why] of bad) {
    const r = validateConfig({ ...DEFAULT_CONFIG, ...over });
    assert.ok(!r.ok && why.test(r.error), `${JSON.stringify(over)} -> ${r.ok ? 'accepted' : r.error}`);
  }
  assert.equal(validateConfig(null).ok, false);
});

test('stored settings round-trip, fit in one item, and bad stored fields fall back to defaults', () => {
  const custom = cfg({ bpm: 133, groove: 'shuffle', sound: 'beep', accentHz: 1800, volumes: { ...DEFAULT_CONFIG.volumes, ride: 0.3 } });
  const fields = toFields(custom);
  assert.ok(Object.keys(fields).length <= 32);
  assert.deepEqual(fromFields(fields), custom);
  const broken = fromFields({ ...fields, bpm: 999, groove: 'polka', vol_kick: -1 });
  assert.equal(broken.bpm, DEFAULT_CONFIG.bpm);
  assert.equal(broken.groove, DEFAULT_CONFIG.groove);
  assert.equal(broken.volumes.kick, DEFAULT_CONFIG.volumes.kick);
  assert.equal(broken.accentHz, 1800, 'good fields kept');
  assert.deepEqual(fromFields(undefined), DEFAULT_CONFIG);
});

// -------------------------------------------------------------- timing ---

test('steady: quarter notes land exactly on the beat, with no drift after an hour', () => {
  const p = new TickPlanner(cfg({ bpm: 120 }));
  const ticks = take(p, 7201);
  assert.deepEqual(ticks.slice(0, 5).map((t) => t.time), [0, 0.5, 1, 1.5, 2]);
  close(ticks[7200]!.time, 3600, 1e-6);
  assert.equal(ticks[7200]!.bar, 1800);
});

test('30 and 300 BPM: one click every 2 s and every 0.2 s; 16ths at 300 BPM every 50 ms', () => {
  close(take(new TickPlanner(cfg({ bpm: 30 })), 2)[1]!.time, 2);
  close(take(new TickPlanner(cfg({ bpm: 300 })), 2)[1]!.time, 0.2);
  const sixteenths = take(new TickPlanner(cfg({ bpm: 300, subdivision: 4 })), 9);
  sixteenths.forEach((t, i) => close(t.time, i * 0.05));
  assert.deepEqual(sixteenths.slice(0, 5).map((t) => [t.beat, t.step]), [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0]]);
});

test('subdivisions: 8ths and triplets split the beat evenly', () => {
  take(new TickPlanner(cfg({ bpm: 60, subdivision: 2 })), 4).forEach((t, i) => close(t.time, i * 0.5));
  take(new TickPlanner(cfg({ bpm: 60, subdivision: 3 })), 6).forEach((t, i) => close(t.time, i / 3));
});

test('accent on 1: beat 1 is the loud click; other beats softer; subdivisions softest', () => {
  const [one, two] = [hitsFor(cfg(), 0, 0, false), hitsFor(cfg(), 1, 0, false)];
  assert.deepEqual(one, [{ voice: 'rim', gain: 1 }]);
  assert.ok(two[0]!.gain < one[0]!.gain);
  assert.ok(hitsFor(cfg({ subdivision: 2 }), 1, 1, false)[0]!.gain < two[0]!.gain);
});

test('synth beeps: accent pitch on 1, beat pitch elsewhere, both adjustable', () => {
  const c = cfg({ sound: 'beep', accentHz: 1760, beatHz: 880 });
  assert.deepEqual(hitsFor(c, 0, 0, false), [{ voice: 'beep', gain: 1, hz: 1760 }]);
  assert.equal(hitsFor(c, 2, 0, false)[0]!.hz, 880);
});

test('time signatures: 3/4 has three beats; 6/8 accents 1 and 4', () => {
  assert.deepEqual(take(new TickPlanner(cfg({ beatsPerBar: 3 })), 4).map((t) => [t.bar, t.beat]), [[0, 0], [0, 1], [0, 2], [1, 0]]);
  const six = cfg({ beatsPerBar: 6, beatUnit: 8 });
  const gains = [0, 1, 2, 3, 4, 5].map((b) => hitsFor(six, b, 0, false)[0]!.gain);
  assert.equal(gains[0], 1);
  assert.ok(gains[3]! > gains[1]! && gains[3]! < gains[0]!);
});

test('grooves: rock, half-time and shuffle put the kit in the right places', () => {
  const bar = (groove: MetronomeConfig['groove']) =>
    take(new TickPlanner(cfg({ groove })), groove === 'shuffle' ? 12 : 8).map((t) => t.hits.map((h) => h.voice).sort().join('+'));
  assert.deepEqual(bar('rock'), ['hihat+kick', 'hihat', 'hihat+snare', 'hihat', 'hihat+kick', 'hihat', 'hihat+snare', 'hihatOpen']);
  assert.deepEqual(bar('half-time'), ['hihat+kick', 'hihat', 'hihat', 'hihat', 'hihat+snare', 'hihat', 'hihat', 'hihat']);
  assert.deepEqual(bar('shuffle'), ['kick+ride', '', 'ride', 'ride+snare', '', 'ride', 'kick+ride', '', 'ride', 'ride+snare', '', 'ride']);
});

test('count-in: plain clicks at the start tempo, then the workout starts on bar 0', () => {
  const p = new TickPlanner(cfg({ bpm: 120, countInBars: 1, groove: 'rock' }));
  const ticks = take(p, 5);
  assert.deepEqual(ticks.slice(0, 4).map((t) => [t.bar, t.countIn, t.hits[0]!.voice]), [[-1, true, 'rim'], [-1, true, 'rim'], [-1, true, 'rim'], [-1, true, 'rim']]);
  assert.equal(ticks[4]!.bar, 0);
  close(ticks[4]!.time, 2);
  assert.equal(ticks[4]!.countIn, false);
});

// --------------------------------------------------------------- ramps ---

test('ramp math: steps every N bars, holds at the target, works down too', () => {
  assert.deepEqual([0, 3, 4, 7, 8, 40, 400].map((b) => rampBpm(80, 100, 5, 4, b)), [80, 80, 85, 85, 90, 100, 100]);
  assert.deepEqual([0, 1, 2, 9].map((b) => rampBpm(120, 100, 10, 1, b)), [120, 110, 100, 100]);
  assert.equal(rampBpm(80, 100, 5, 4, -1), 80, 'count-in stays at the start');
});

test('ramp playback: each bar plays at its tempo and bar lengths add up exactly', () => {
  const p = new TickPlanner(cfg({ workout: 'ramp', bpm: 60, targetBpm: 120, stepBpm: 30, everyBars: 1, beatsPerBar: 2, countInBars: 1 }));
  const ticks = take(p, 10);
  assert.deepEqual(ticks.map((t) => t.bpm), [60, 60, 60, 60, 90, 90, 120, 120, 120, 120]);
  // count-in 2 beats at 60 (2 s), bar 0 at 60 (2 s), bar 1 at 90 (1.333 s), then 120.
  close(ticks[2]!.time, 2);
  close(ticks[4]!.time, 4);
  close(ticks[6]!.time, 4 + 4 / 3);
  close(ticks[7]!.time, 4 + 4 / 3 + 0.5);
});

// ------------------------------------------------------------ gap click --

test('gap click: muted bars are silent but still counted; count-in is never muted', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((b) => isMutedBar(2, 2, b)), [false, false, true, true, false, false]);
  const p = new TickPlanner(cfg({ workout: 'gap', playBars: 1, muteBars: 1, beatsPerBar: 2, countInBars: 1 }));
  const ticks = take(p, 8);
  assert.deepEqual(ticks.map((t) => [t.bar, t.muted, t.hits.length > 0]), [
    [-1, false, true], [-1, false, true], [0, false, true], [0, false, true], [1, true, false], [1, true, false], [2, false, true], [2, false, true],
  ]);
});

// -------------------------------------------------------------- ladder ---

test('a ladder rep plays its bars after the count-in, then ends', () => {
  const p = new TickPlanner(cfg({ workout: 'ladder', bpm: 100, targetBpm: 140, repBars: 2, beatsPerBar: 4, countInBars: 1 }));
  const all: Tick[] = [];
  for (let t = p.next(); t; t = p.next()) all.push(t);
  assert.equal(all.length, 12);
  assert.equal(all.at(-1)!.bar, 1);
});

// --------------------------------------------------- live config change --

test('changing tempo while playing applies at the next click; groove changes wait for the bar', () => {
  const p = new TickPlanner(cfg({ bpm: 120 }));
  take(p, 2);
  p.setConfig(cfg({ bpm: 60 }));
  const [a, b] = take(p, 2);
  assert.equal(a!.bpm, 60);
  close(b!.time - a!.time, 1);
  const q = new TickPlanner(cfg({ bpm: 120 }));
  take(q, 1);
  q.setConfig(cfg({ bpm: 120, groove: 'rock' }));
  const rest = take(q, 4);
  assert.deepEqual(rest.map((t) => t.stepsPerBeat), [1, 1, 1, 2], 'rock (8th grid) starts on the next bar');
});

// ------------------------------------------------------------- tapping ---

test('tap tempo: median of recent taps, restarts after a pause, clamps to 30-300', () => {
  assert.equal(tapTempo([0, 500, 1000, 1500]), 120);
  assert.equal(tapTempo([0, 500, 1000, 1700, 2200]), 120, 'one sloppy tap does not throw it off');
  assert.equal(tapTempo([0, 1000, 5000, 5250, 5500]), 240, 'a long pause starts over');
  assert.equal(tapTempo([0, 50]), 300);
  assert.equal(tapTempo([0]), null);
});

test('tap timing: average distance and rushing/dragging, strays ignored', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5].map((time) => ({ time, bpm: 120 }));
  const t = tapTiming([0.02, 0.52, 1.03, 1.49, 2.02], beats)!;
  assert.equal(t.taps, 5);
  // offsets +20, +20, +30, -10, +20 ms
  assert.equal(t.meanAbsMs, 20);
  assert.equal(t.meanOffsetMs, 16);
  assert.equal(tapTiming([0.02, 0.52, 9, 1.02], beats), null, 'needs 4 matched taps');
});

test('onset finder skips encoder silence and keeps the attack', () => {
  const s = new Float32Array(2000);
  s[1000] = 0.5;
  assert.equal(findOnset(s), 1000 - 16);
  assert.equal(findOnset(new Float32Array(10)), 0);
  s[5] = 0.9;
  assert.equal(findOnset(s), 0);
});

// ------------------------------------------------------------ scheduler --

function fakeAudio(config: MetronomeConfig, options: { seconds: number; jitter?: boolean; stallAt?: number; stallFor?: number }) {
  let now = 0;
  const scheduled: { tick: Tick; when: number; at: number }[] = [];
  let ended = 0;
  const s = new LookaheadScheduler({ now: () => now, schedule: (tick, when) => scheduled.push({ tick, when, at: now }), onEnd: () => ended++ });
  s.start(config, 0.1);
  let rnd = 7;
  while (now < options.seconds) {
    rnd = (rnd * 1103515245 + 12345) % 2 ** 31;
    now += options.jitter ? 0.005 + (rnd % 55) / 1000 : 0.025;
    if (options.stallAt !== undefined && now >= options.stallAt && now < options.stallAt + options.stallFor!) continue;
    s.pump();
  }
  return { s, scheduled, ended: () => ended };
}

test('lookahead scheduler: every tick exactly once, on its exact time, never too far ahead', () => {
  const { scheduled, s } = fakeAudio(cfg({ bpm: 120, subdivision: 2 }), { seconds: 10 });
  assert.deepEqual(scheduled.map((x) => x.tick.index), scheduled.map((_, i) => i));
  for (const x of scheduled) {
    close(x.when, 0.1 + x.tick.time);
    assert.ok(x.when - x.at <= 0.15 + 1e-9 && x.when >= x.at);
  }
  assert.equal(s.stats.dropped, 0);
});

test('timer jitter never moves the sound: the same times with an irregular timer', () => {
  const steady = fakeAudio(cfg({ bpm: 173, subdivision: 3 }), { seconds: 8 }).scheduled.map((x) => x.when);
  const jittery = fakeAudio(cfg({ bpm: 173, subdivision: 3 }), { seconds: 8, jitter: true }).scheduled.map((x) => x.when);
  const n = Math.min(steady.length, jittery.length) - 10;
  assert.deepEqual(jittery.slice(0, n), steady.slice(0, n));
});

test('a stalled timer skips the missed clicks instead of playing a burst, and stays on the grid', () => {
  const { scheduled, s } = fakeAudio(cfg({ bpm: 120 }), { seconds: 6, stallAt: 2, stallFor: 1 });
  assert.ok(s.stats.dropped >= 1);
  for (const x of scheduled) close(Math.round((x.when - 0.1) / 0.5) * 0.5, x.when - 0.1, 1e-6);
  const gaps = scheduled.slice(1).map((x, i) => x.when - scheduled[i]!.when);
  assert.ok(gaps.every((g) => g > 0.49), 'no two clicks crammed together');
});

test('a ladder rep ends on its own and reports bars and tempo; ramp stats track the tempo reached', () => {
  const ladder = fakeAudio(cfg({ workout: 'ladder', bpm: 120, targetBpm: 130, repBars: 2, countInBars: 1 }), { seconds: 10 });
  assert.equal(ladder.ended(), 1);
  assert.equal(ladder.s.playing, false);
  assert.equal(ladder.s.stats.bars, 2);
  const ramp = fakeAudio(cfg({ workout: 'ramp', bpm: 100, targetBpm: 140, stepBpm: 10, everyBars: 1, countInBars: 0 }), { seconds: 12 });
  assert.equal(ramp.s.stats.startTempo, 100);
  assert.equal(ramp.s.stats.tempo, 140);
});

// ---------------------------------------------------------------- clock ---

test('metronome clock: beat lookups, and a broken listener is cut off without stopping anyone else', () => {
  let now = 0;
  const clock = new ScheduledClock(() => now);
  const seen: number[] = [];
  clock.onBeat(() => {
    throw new Error('buggy module');
  });
  clock.onBeat((b) => seen.push(b.beat));
  let stopped = 0;
  clock.onStop(() => stopped++);
  for (let i = 0; i < 4; i++) clock.push({ time: i * 0.5, bar: 0, beat: i, beatsPerBar: 4, bpm: 120, countIn: false, muted: false });
  assert.deepEqual(seen, [0, 1, 2, 3]);
  assert.equal(clock.failures.length, 1);
  assert.equal(clock.beatAt(1.2)!.beat, 2);
  assert.equal(clock.nextBeat(1.2)!.beat, 3);
  assert.equal(clock.beatAt(-1), null);
  now = 5;
  assert.equal(clock.now(), 5);
  assert.ok(clock.running);
  clock.stop();
  assert.equal(stopped, 1);
  assert.equal(clock.running, false);
});

test('the scheduler drives the clock with every beat (not subdivisions)', () => {
  const beats: number[] = [];
  let now = 0;
  const s = new LookaheadScheduler({ now: () => now, schedule: () => {} });
  s.clock.onBeat((b) => beats.push(b.time));
  s.start(cfg({ bpm: 120, subdivision: 4 }), 0);
  for (; now < 2; now += 0.025) s.pump();
  assert.deepEqual(beats.slice(0, 4), [0, 0.5, 1, 1.5]);
  s.stop();
  assert.equal(s.clock.running, false);
});
