/**
 * Bare Songs I Already Know controls for the test harness: add a title,
 * paste a list, rename, archive and restore. No design. Practice happens in
 * the "Now" card (main.ts): the song is served, played, then rated.
 */
import { addSong, archiveSong, pasteSongs, renameSong, restoreSong, runModule, songs } from '../src/index.ts';
import type { ModuleHost, Song, Validation } from '../src/index.ts';
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';

const $ = <T extends HTMLElement = HTMLInputElement>(name: Hook) => hook<T>(name);
const newKey = () => crypto.randomUUID();

export function setupSongs(host: ModuleHost, say: (s: string) => void, afterChange: () => Promise<void>, onPasted: () => void = () => undefined) {
  /** Runs a songs action inside the crash boundary and reports the outcome. */
  const act = async <T>(fn: () => Promise<Validation<T>>, done: (value: T) => string) => {
    const r = await runModule(host, fn);
    if (!r.ok) say(`Songs switched off: ${r.error}`);
    else if (!r.value.ok) say(`Songs: ${r.value.error}`);
    else say(done(r.value.value));
    await afterChange();
  };

  const row = (song: Song) => {
    const li = document.createElement('li');
    li.dataset.zg = 'song';
    li.append(song.title, ' ');
    const rename = document.createElement('button');
    rename.dataset.zg = 'song-rename';
    rename.textContent = 'Rename';
    rename.onclick = () => {
      const title = window.prompt('New title', song.title);
      if (title !== null) void act(() => renameSong(host, song.itemId, title), (s) => `Renamed to "${s.title}"`);
    };
    const toggle = document.createElement('button');
    if (song.archived) {
      toggle.dataset.zg = 'song-restore';
      toggle.textContent = 'Restore';
      toggle.onclick = () => void act(() => restoreSong(host, song.itemId), (s) => `Restored "${s.title}"`);
    } else {
      toggle.dataset.zg = 'song-archive';
      toggle.textContent = 'Archive';
      toggle.onclick = () => void act(() => archiveSong(host, song.itemId), (s) => `Archived "${s.title}" (history kept; Restore brings it back)`);
    }
    li.append(rename, ' ', toggle);
    return li;
  };

  return {
    render() {
      if (!host.enabled) {
        $('songs-list').replaceChildren();
        $('songs-archived').replaceChildren();
        return;
      }
      const all = songs(host);
      $('songs-list').replaceChildren(...all.filter((s) => !s.archived).map(row));
      $('songs-archived').replaceChildren(...all.filter((s) => s.archived).map(row));
    },
    wire() {
      $('songs-add').onclick = () => {
        const input = $('songs-new');
        void act(() => addSong(host, newKey(), input.value), (s) => ((input.value = ''), `Added "${s.title}"`));
      };
      $('songs-paste-add').onclick = () => {
        const box = $<HTMLTextAreaElement>('songs-paste');
        void act(
          () => pasteSongs(host, box.value, newKey),
          (r) => ((box.value = ''), onPasted(), `Added ${r.added.length} songs${r.skipped.length ? `; skipped ${r.skipped.length} already listed` : ''}`),
        );
      };
    },
  };
}
