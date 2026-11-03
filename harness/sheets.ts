/**
 * Bottom sheets (2026-11-01): each is a native <dialog> opened as a modal,
 * so Escape, focus containment and the backdrop come from the browser. A tap
 * on the backdrop or the close button closes it; so does leaving the screen
 * (shell.ts calls closeAll on every navigation). Layout only: nothing inside
 * changes behaviour; the fields keep their hooks and the modules read them
 * as before, open or closed.
 *
 * App sheets (2026-11-02: sign-in, tab viewer) work the same way but have no
 * fixed open button: the code opens them.
 */
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';
import { APP_SHEETS, SHEETS } from './routes.ts';
import type { SheetName } from './routes.ts';

export interface Sheets {
  open(name: SheetName): void;
  close(name: SheetName): void;
  closeAll(): void;
  isOpen(name: SheetName): boolean;
  /** Runs when a sheet closes, however it was closed. */
  onClose(name: SheetName, fn: () => void): void;
  /** Whether any sheet is open. */
  anyOpen(): boolean;
}

export function setupSheets(): Sheets {
  const dialog = (name: SheetName) => hook<HTMLDialogElement>(`sheet-${name}` as Hook);
  const all: readonly SheetName[] = [...SHEETS, ...APP_SHEETS];
  const api: Sheets = {
    open(name) {
      const d = dialog(name);
      if (!d.open) d.showModal();
    },
    close(name) {
      const d = dialog(name);
      if (d.open) d.close();
    },
    closeAll() {
      for (const name of all) api.close(name);
    },
    isOpen: (name) => dialog(name).open,
    onClose(name, fn) {
      dialog(name).addEventListener('close', fn);
    },
    anyOpen: () => all.some((name) => dialog(name).open),
  };
  for (const name of SHEETS) hook<HTMLButtonElement>(`open-${name}` as Hook).addEventListener('click', () => api.open(name));
  for (const name of all) {
    const d = dialog(name);
    hook<HTMLButtonElement>(`close-${name}` as Hook).addEventListener('click', () => api.close(name));
    // A tap on the backdrop lands on the dialog itself (its content fills it edge to edge).
    d.addEventListener('click', (e) => {
      if (e.target === d) api.close(name);
    });
  }
  return api;
}
