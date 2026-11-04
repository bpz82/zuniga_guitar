/**
 * Bare recorder panel for the test harness. No design. Free recording, timed
 * improv runs (N takes, a window each, stopped by itself, saved separately),
 * and the takes list: play, rename, archive, restore. Audio is saved on this
 * device first; sync uploads it to the user's private folder.
 */
import { runModule } from '../../src/index.ts';
import type { ModuleHost } from '../../src/index.ts';
import type { BlobStore } from '../../src/modules/recorder/blobs.ts';
import { checkImprov, DEFAULT_IMPROV, MAX_TAKE_MS, MIN_TAKE_MS, pickFormat, runState, takeTitle } from '../../src/modules/recorder/core.ts';
import type { ImprovPrompt } from '../../src/modules/recorder/core.ts';
import type { TakeStorage } from '../../src/modules/recorder/storage.ts';
import { archiveTake, audioOf, renameTake, restoreTake, runTakes, saveTake, takes } from '../../src/modules/recorder/takes.ts';
import type { Take } from '../../src/modules/recorder/takes.ts';
import { hook } from '../shared/hooks.ts';
import type { Hook } from '../shared/hooks.ts';

const $ = <T extends HTMLElement = HTMLInputElement>(name: Hook) => hook<T>(name);
const clockText = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/** What a take recorded from a goal block carries, so the block can be ticked off. */
export interface BlockRun {
  readonly goalId: string;
  readonly blockId: string;
}

interface Live {
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly chunks: Blob[];
  readonly startedAt: number;
  readonly limitMs: number;
  readonly title: string;
  readonly run?: { readonly id: string; readonly prompt: ImprovPrompt; readonly index: number; readonly block?: BlockRun };
  timer: number;
}

export function setupRecorder(
  host: ModuleHost,
  blobs: () => BlobStore,
  cloud: () => { storage: TakeStorage; userId: string } | null,
  say: (s: string) => void,
  afterChange: () => Promise<void>,
  onRunDone: (run: { runId: string; block?: BlockRun; takes: number }) => Promise<void> = async () => undefined,
) {
  let live: Live | null = null;
  let run: { id: string; prompt: ImprovPrompt; block?: BlockRun } | null = null;
  let url: string | null = null;

  const status = (text: string) => ($('rec-status').textContent = text);

  const finish = async (l: Live) => {
    window.clearInterval(l.timer);
    for (const t of l.stream.getTracks()) t.stop();
    const durationMs = Math.min(Date.now() - l.startedAt, l.limitMs);
    const type = l.recorder.mimeType || l.chunks[0]?.type || 'audio/webm';
    const audio = new Blob(l.chunks, { type });
    $('rec-stop').hidden = true;
    if (durationMs < MIN_TAKE_MS) return status('Too short to keep (under a second).');
    const meta = {
      title: l.title,
      recordedAt: l.startedAt,
      durationMs,
      type,
      ...(l.run ? { prompt: l.run.prompt.prompt, runId: l.run.id, index: l.run.index, of: l.run.prompt.takes } : {}),
      ...(l.run?.block ? { goalId: l.run.block.goalId, blockId: l.run.block.blockId } : {}),
    };
    const r = await runModule(host, () => saveTake(host, blobs(), crypto.randomUUID(), meta, audio));
    if (!r.ok) return say(`Recorder switched off: ${r.error}`);
    if (!r.value.ok) return say(`Recorder: ${r.value.error}`);
    status(`Saved "${r.value.value.title}" (${clockText(durationMs)}) on this device${cloud() ? '; uploads on the next sync' : '; sign in to back it up'}.`);
    if (l.run && run && run.id === l.run.id) {
      const saved = runTakes(host, run.id).length;
      const state = runState(run.prompt, saved);
      if (state.done) {
        const done = run;
        run = null;
        $('improv-start').textContent = 'Start improv';
        status(`Improv finished: ${saved} takes saved separately.`);
        await onRunDone({ runId: done.id, takes: saved, ...(done.block ? { block: done.block } : {}) });
      } else {
        $('improv-start').textContent = `Start take ${state.next} of ${run.prompt.takes}`;
      }
    }
    await afterChange();
  };

  const start = async (title: string, limitMs: number, runInfo?: Live['run']) => {
    if (live) return say('Already recording.');
    const format = typeof MediaRecorder === 'undefined' ? null : pickFormat((t) => MediaRecorder.isTypeSupported(t));
    if (!format) return say('This browser cannot record audio.');
    let stream: MediaStream;
    try {
      // Music, not speech: no echo cancelling, noise suppression or auto gain.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      return say(`Microphone not available: ${(e as Error).message}`);
    }
    const recorder = new MediaRecorder(stream, { mimeType: format });
    const l: Live = { recorder, stream, chunks: [], startedAt: Date.now(), limitMs, title, ...(runInfo ? { run: runInfo } : {}), timer: 0 };
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) l.chunks.push(e.data);
    };
    recorder.onstop = () => {
      live = null;
      void finish(l);
    };
    recorder.start(1000);
    live = l;
    $('rec-stop').hidden = false;
    const tick = () => {
      const ms = Date.now() - l.startedAt;
      $('rec-timer').textContent = `${clockText(ms)} / ${clockText(limitMs)}`;
      if (ms >= limitMs && recorder.state === 'recording') recorder.stop(); // the window ran out
    };
    tick();
    l.timer = window.setInterval(tick, 250);
    status(`Recording: ${title}`);
  };

  /** Starts (or continues) a timed improv run. Optionally for a goal block. */
  const improv = async (prompt: ImprovPrompt, block?: BlockRun) => {
    const p = checkImprov(prompt);
    if (!p.ok) return say(`Improv: ${p.error}`);
    if (!run || run.prompt.prompt !== p.value.prompt || run.block?.blockId !== block?.blockId) {
      run = { id: `run-${crypto.randomUUID()}`, prompt: p.value, ...(block ? { block } : {}) };
    }
    const next = runState(run.prompt, runTakes(host, run.id).length).next ?? 1;
    await start(takeTitle(run.prompt.prompt, next, run.prompt.takes), run.prompt.minutes * 60_000, {
      id: run.id,
      prompt: run.prompt,
      index: next,
      ...(run.block ? { block: run.block } : {}),
    });
  };

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    const r = await runModule(host, fn);
    if (!r.ok) say(`Recorder switched off: ${r.error}`);
    else if (!r.value.ok) say(`Recorder: ${r.value.error}`);
    await afterChange();
  };

  const play = async (t: Take) => {
    const r = await audioOf(host, blobs(), t.takeId, cloud());
    if (!r.ok) return say(`Can't play: ${r.error}`);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(r.value);
    const player = $<HTMLAudioElement>('take-player');
    player.src = url;
    await player.play().catch(() => undefined);
  };

  const row = (t: Take) => {
    const li = document.createElement('li');
    li.dataset.zg = 'take';
    li.dataset.take = t.takeId;
    const where = t.uploaded ? 'backed up' : 'waiting to upload';
    li.append(`${t.title} · ${clockText(t.durationMs)} · ${new Date(t.recordedAt).toLocaleString()} · ${where} `);
    const button = (b: HTMLButtonElement, text: string, onclick: () => void) => {
      b.textContent = text;
      b.onclick = onclick;
      li.append(b, ' ');
    };
    const playB = document.createElement('button');
    playB.dataset.zg = 'take-play';
    button(playB, 'Play', () => void play(t));
    const renameB = document.createElement('button');
    renameB.dataset.zg = 'take-rename';
    button(renameB, 'Rename', () => {
      const title = window.prompt('New title', t.title);
      if (title !== null) void act(() => renameTake(host, t.takeId, title));
    });
    const toggle = document.createElement('button');
    if (t.archived) {
      toggle.dataset.zg = 'take-restore';
      button(toggle, 'Restore', () => void act(() => restoreTake(host, t.takeId)));
    } else {
      toggle.dataset.zg = 'take-archive';
      button(toggle, 'Archive', () => void act(() => archiveTake(host, t.takeId)));
    }
    return li;
  };

  return {
    improv,
    recording: () => live !== null,
    render() {
      if (!host.enabled) {
        status(`Recorder switched off: ${host.disabledReason}`);
        return;
      }
      const all = takes(host);
      $('takes-list').replaceChildren(...all.filter((t) => !t.archived).map(row));
      $('takes-archived').replaceChildren(...all.filter((t) => t.archived).map(row));
    },
    wire() {
      $('improv-prompt').value = DEFAULT_IMPROV.prompt;
      $('improv-takes').value = String(DEFAULT_IMPROV.takes);
      $('improv-minutes').value = String(DEFAULT_IMPROV.minutes);
      $('rec-start').onclick = () => {
        const title = $('rec-title').value.trim() || `Take ${new Date().toLocaleString()}`;
        void start(title, MAX_TAKE_MS);
      };
      $('rec-stop').onclick = () => {
        if (live?.recorder.state === 'recording') live.recorder.stop();
      };
      $('improv-start').onclick = () =>
        void improv({ prompt: $('improv-prompt').value, takes: Number($('improv-takes').value), minutes: Number($('improv-minutes').value) });
    },
  };
}
