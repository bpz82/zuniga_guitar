/**
 * Bottom sheets (2026-11-01): each is a native <dialog> opened as a modal,
 * so Escape, focus containment and the backdrop come from the browser. A tap
 * on the backdrop or the close button closes it; so does leaving the screen
 * (shell.ts calls closeAll on every navigation). Layout only: nothing inside
 * changes behaviour; the fields keep their hooks and the modules read them
 * as before, open or closed.
 */
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';
import { SHEETS } from './routes.ts';
import type { SheetName } from './routes.ts';

export interface Sheets {
  open(name: SheetName): void;
  close(name: SheetName): void;
  closeAll(): void;
  isOpen(name: SheetName): boolean;
}

export function setupSheets(): Sheets {
  const dialog = (name: SheetName) => hook<HTMLDialogElement>(`sheet-${name}` as Hook);
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
      for (const name of SHEETS) api.close(name);
    },
    isOpen: (name) => dialog(name).open,
  };
  for (const name of SHEETS) {
    const d = dialog(name);
    hook<HTMLButtonElement>(`open-${name}` as Hook).addEventListener('click', () => api.open(name));
    hook<HTMLButtonElement>(`close-${name}` as Hook).addEventListener('click', () => api.close(name));
    // A tap on the backdrop lands on the dialog itself (its content fills it edge to edge).
    d.addEventListener('click', (e) => {
      if (e.target === d) api.close(name);
    });
  }
  return api;
}
