/**
 * Built-in test deck (module zero): theory flashcards for silent pocket mode.
 * Fretboard notes (6 strings x frets 0 to 12) and chord spellings (major and
 * minor triads). It proves the engine end to end and is the first user of
 * the module contract.
 */
import type { ModuleHost, ModuleManifest } from '../contract.ts';
import type { Card, Item } from '../model.ts';

export const TEST_DECK: ModuleManifest = Object.freeze({
  id: 'test-deck',
  contract: 0,
  templates: Object.freeze([
    Object.freeze({ template: 'fret-note', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'chord-spelling', tags: Object.freeze(['pocket-silent'] as const) }),
  ]),
});

const NOTE_NAMES = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
/** Standard tuning, string 6 (low E) to string 1 (high E), as pitch classes. */
const OPEN_STRINGS: readonly [number, string, number][] = [
  [6, 'low E', 4],
  [5, 'A', 9],
  [4, 'D', 2],
  [3, 'G', 7],
  [2, 'B', 11],
  [1, 'high E', 4],
];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL: Record<number, string> = { 0: '', 1: '#', 2: '##', 11: 'b', 10: 'bb' };

/** Spells a note a given number of letters and semitones above a root, e.g. F + (2, 3) = Ab. */
export function spell(root: string, letterSteps: number, semitones: number): string {
  const letter = LETTERS.indexOf(root[0]!);
  if (letter < 0) throw new Error(`bad root ${root}`);
  const shift = [...root.slice(1)].reduce((n, c) => n + (c === '#' ? 1 : c === 'b' ? -1 : 0), 0);
  const rootPc = (LETTER_PC[letter]! + shift + 12) % 12;
  const target = (letter + letterSteps) % 7;
  const diff = (((rootPc + semitones - LETTER_PC[target]!) % 12) + 12) % 12;
  return LETTERS[target]! + ACCIDENTAL[diff]!;
}

const TRIADS: Record<'major' | 'minor', [number, number][]> = {
  major: [[0, 0], [2, 4], [4, 7]],
  minor: [[0, 0], [2, 3], [4, 7]],
};
/** Roots as they are usually written for each quality. */
const ROOTS: Record<'major' | 'minor', string[]> = {
  major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  minor: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
};

export function chordSpelling(root: string, quality: 'major' | 'minor'): string {
  return TRIADS[quality].map(([l, s]) => spell(root, l, s)).join(' ');
}

interface DeckEntry {
  readonly itemId: string;
  readonly cardId: string;
  readonly template: string;
  readonly fields: Record<string, string | number>;
}

/** The full deck, built deterministically so every device seeds identical ids. */
export function deckEntries(): DeckEntry[] {
  const out: DeckEntry[] = [];
  for (const [string, name, open] of OPEN_STRINGS) {
    for (let fret = 0; fret <= 12; fret++) {
      out.push({
        itemId: `td-fret-${string}-${fret}`,
        cardId: `td-fret-${string}-${fret}-c`,
        template: 'fret-note',
        fields: { string, stringName: name, fret, answer: NOTE_NAMES[(open + fret) % 12]! },
      });
    }
  }
  for (const quality of ['major', 'minor'] as const) {
    for (const root of ROOTS[quality]) {
      const key = root.replace('#', 's').toLowerCase();
      out.push({
        itemId: `td-chord-${key}-${quality}`,
        cardId: `td-chord-${key}-${quality}-c`,
        template: 'chord-spelling',
        fields: { root, quality, answer: chordSpelling(root, quality) },
      });
    }
  }
  return out;
}

/** Adds whatever part of the deck is missing. Safe to run on every device, every launch. */
export async function seedTestDeck(host: ModuleHost): Promise<number> {
  const haveItems = new Set(host.items().map((i) => i.id));
  const haveCards = new Set(host.cards().map((c) => c.id));
  let added = 0;
  for (const e of deckEntries()) {
    if (!haveItems.has(e.itemId)) {
      await host.addItem(e.itemId, e.fields);
      added++;
    }
    if (!haveCards.has(e.cardId)) await host.addCard(e.cardId, e.itemId, e.template);
  }
  return added;
}

/** Question and answer text for a test-deck card. */
export function prompt(card: Card, item: Item): { question: string; answer: string } {
  const f = item.fields;
  if (card.template === 'fret-note') {
    return { question: `String ${f.string} (${f.stringName}), fret ${f.fret}: which note?`, answer: String(f.answer) };
  }
  return { question: `Spell ${f.root} ${f.quality}.`, answer: String(f.answer) };
}
