/**
 * Fretboard and chords (module id "test-deck", kept: items in the log carry
 * it). Built 2026-10-30 as the test deck (module zero, the first user of the
 * module contract); rebuilt 2026-11-13 as a staged trainer from the
 * curriculum review:
 *   - Two directions on the neck: position to note ("String 5, fret 7: which
 *     note?") and note to position ("Find D on string 5").
 *   - Pattern cards: the open strings, fret 12 as the octave (one card
 *     instead of six fret-12 cards that repeated the open strings), the
 *     natural half steps, octave shapes, the same note one string over, the
 *     frets above 12.
 *   - Chords beyond triads: power, diminished, sus2, sus4, maj7, 7, m7; key
 *     signatures; the diatonic chords of the common guitar keys; barre shapes.
 *   - Staged: two tracks (the neck, and chords). A stage's cards are seeded
 *     only once every card of the stages before it in its track has been
 *     answered right at least once, so day one is a handful of cards, not
 *     hundreds. Cards already in the log stay, whatever their stage.
 * Content lives in code; the log holds each card's id and a few fields.
 * Retired (history kept, never reused): the six fret-12 cards and D♯ minor
 * (now E♭ minor, as charts write it).
 */
import type { ModuleHost, ModuleManifest } from '../contract.ts';
import type { Card, Item } from '../model.ts';

/** What the app calls this module (2026-11-13). */
export const FRETBOARD_DECK_NAME = 'Fretboard and chords';

export const TEST_DECK: ModuleManifest = Object.freeze({
  id: 'test-deck',
  contract: 1,
  templates: Object.freeze([
    Object.freeze({ template: 'fret-note', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'chord-spelling', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'find-note', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'fret-pattern', tags: Object.freeze(['pocket-silent'] as const) }),
    Object.freeze({ template: 'key-spelling', tags: Object.freeze(['pocket-silent'] as const) }),
  ]),
});
/** The same module under its app name. */
export const FRETBOARD_DECK = TEST_DECK;

const NOTE_NAMES = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
const isNatural = (pc: number) => !NOTE_NAMES[pc]!.includes('/');
/** Standard tuning, string 6 (low E) to string 1 (high E), as pitch classes. */
const OPEN_STRINGS: readonly [number, string, number][] = [
  [6, 'low E', 4],
  [5, 'A', 9],
  [4, 'D', 2],
  [3, 'G', 7],
  [2, 'B', 11],
  [1, 'high E', 4],
];
const stringName = (s: number) => OPEN_STRINGS.find(([n]) => n === s)![1];

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

export type ChordQuality = 'major' | 'minor' | 'power' | 'dim' | 'sus2' | 'sus4' | 'maj7' | '7' | 'm7';
/** [letter steps, semitones] above the root for each chord tone. */
const FORMULAS: Record<ChordQuality, [number, number][]> = {
  major: [[0, 0], [2, 4], [4, 7]],
  minor: [[0, 0], [2, 3], [4, 7]],
  power: [[0, 0], [4, 7]],
  dim: [[0, 0], [2, 3], [4, 6]],
  sus2: [[0, 0], [1, 2], [4, 7]],
  sus4: [[0, 0], [3, 5], [4, 7]],
  maj7: [[0, 0], [2, 4], [4, 7], [6, 11]],
  '7': [[0, 0], [2, 4], [4, 7], [6, 10]],
  m7: [[0, 0], [2, 3], [4, 7], [6, 10]],
};
/** How each chord is asked for. Major and minor keep their 2026-10-30 wording. */
const CHORD_NAME: Record<ChordQuality, (root: string) => string> = {
  major: (r) => `${r} major`,
  minor: (r) => `${r} minor`,
  power: (r) => `${r}5 (the power chord)`,
  dim: (r) => `${r} diminished`,
  sus2: (r) => `${r}sus2`,
  sus4: (r) => `${r}sus4`,
  maj7: (r) => `${r}maj7`,
  '7': (r) => `${r}7 (dominant 7)`,
  m7: (r) => `${r}m7`,
};
/** Roots as they are usually written on charts. */
const MAJOR_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const ROOTS: Record<ChordQuality, string[]> = {
  major: MAJOR_ROOTS,
  minor: MINOR_ROOTS,
  power: MAJOR_ROOTS,
  dim: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  sus2: MAJOR_ROOTS,
  sus4: MAJOR_ROOTS,
  maj7: MAJOR_ROOTS,
  '7': MAJOR_ROOTS,
  m7: MINOR_ROOTS,
};

export function chordSpelling(root: string, quality: ChordQuality): string {
  return FORMULAS[quality].map(([l, s]) => spell(root, l, s)).join(' ');
}

/** The major scale from a root, spelled with one letter per degree. */
export function majorScale(root: string): string[] {
  const steps = [0, 2, 4, 5, 7, 9, 11];
  return steps.map((semis, i) => spell(root, i, semis));
}
/** The key signature of a major key: "2 sharps: F# C#", "1 flat: Bb", "No sharps or flats". */
export function keySignature(root: string): string {
  const acc = majorScale(root).filter((n) => n.length > 1);
  if (acc.length === 0) return 'No sharps or flats';
  const sharps = acc[0]!.endsWith('#');
  // In circle order: sharps F C G D A E B, flats B E A D G C F.
  const order = sharps ? 'FCGDAEB' : 'BEADGCF';
  const sorted = [...acc].sort((a, b) => order.indexOf(a[0]!) - order.indexOf(b[0]!));
  return `${acc.length} ${sharps ? 'sharp' : 'flat'}${acc.length > 1 ? 's' : ''}: ${sorted.join(' ')}`;
}
/** The diatonic triads of a major key: "G Am Bm C D Em F#dim". */
export function diatonicChords(root: string): string {
  const suffix = ['', 'm', 'm', '', '', 'm', 'dim'];
  return majorScale(root).map((n, i) => n + suffix[i]).join(' ');
}

export type Track = 'neck' | 'chords';

interface DeckEntry {
  readonly itemId: string;
  readonly cardId: string;
  readonly template: string;
  readonly fields: Record<string, string | number>;
  readonly track: Track;
  /** 1, 2, 3...: the stage of its track the card is introduced in. */
  readonly stage: number;
  readonly question: string;
  readonly answer: string;
  /** A small text fretboard shown with the answer (neck cards). */
  readonly diagram?: string;
}

/** The track stages, for the app and the docs. */
export const STAGES: Readonly<Record<Track, readonly string[]>> = {
  neck: ['Open strings', 'Natural notes on strings 6 and 5', 'Sharps and flats on strings 6 and 5', 'Strings 4 and 3', 'Strings 2 and 1'],
  chords: ['Major and minor triads', 'Power chords and diminished triads', 'Suspended chords', 'Seventh chords', 'Keys and barre shapes'],
};

/** Ids retired in the 2026-11-13 rebuild: switched off with their history, never reused. */
export const RETIRED_DECK_CARDS: readonly string[] = Object.freeze([
  ...OPEN_STRINGS.map(([s]) => `td-fret-${s}-12-c`),
  'td-chord-ds-minor-c',
]);

/**
 * A small text fretboard (high E on top, as tab is written) marking one
 * position: five frets around it, the nut drawn as ‖ when fret 1 shows.
 */
export function fretDiagram(string: number, fret: number): string {
  const lo = fret <= 3 ? 1 : Math.min(fret - 2, 8);
  const frets = [lo, lo + 1, lo + 2, lo + 3, lo + 4];
  const head = '    ' + frets.map((f) => String(f).padStart(2).padEnd(4)).join('');
  const rows = [...OPEN_STRINGS].reverse().map(([s, name]) => {
    const label = (name === 'low E' ? 'E' : name === 'high E' ? 'e' : name).padEnd(2);
    const open = s === string && fret === 0 ? '●' : ' ';
    const cells = frets.map((f) => (s === string && f === fret ? '-●-|' : '---|')).join('');
    return `${label}${open}${lo === 1 ? '‖' : '|'}${cells}`;
  });
  return [head, ...rows].join('\n');
}

const fretEntry = (string: number, fret: number, stage: number): DeckEntry => {
  const open = OPEN_STRINGS.find(([s]) => s === string)![2];
  const answer = NOTE_NAMES[(open + fret) % 12]!;
  return {
    itemId: `td-fret-${string}-${fret}`,
    cardId: `td-fret-${string}-${fret}-c`,
    template: 'fret-note',
    fields: { string, stringName: stringName(string), fret, answer },
    track: 'neck',
    stage,
    question: `String ${string} (${stringName(string)}), ${fret === 0 ? 'open' : `fret ${fret}`}: which note?`,
    answer,
    diagram: fretDiagram(string, fret),
  };
};

const findEntry = (string: number, pc: number, stage: number): DeckEntry => {
  const open = OPEN_STRINGS.find(([s]) => s === string)![2];
  const fret = (pc - open + 12) % 12;
  const note = NOTE_NAMES[pc]!;
  const key = note.split('/')[0]!.replace('#', 's').toLowerCase();
  return {
    itemId: `td-find-${string}-${key}`,
    cardId: `td-find-${string}-${key}-c`,
    template: 'find-note',
    fields: { string, stringName: stringName(string), note, answer: fret },
    track: 'neck',
    stage,
    question: `Find ${note} on string ${string} (${stringName(string)}), below fret 12.`,
    answer: `Fret ${fret}`,
    diagram: fretDiagram(string, fret),
  };
};

const pattern = (slug: string, stage: number, question: string, answer: string): DeckEntry => ({
  itemId: `td-pat-${slug}`,
  cardId: `td-pat-${slug}-c`,
  template: 'fret-pattern',
  fields: { pattern: slug },
  track: 'neck',
  stage,
  question,
  answer,
});

const chordEntry = (root: string, quality: ChordQuality, stage: number): DeckEntry => {
  const key = root.replace('#', 's').toLowerCase();
  const answer = chordSpelling(root, quality);
  return {
    itemId: `td-chord-${key}-${quality}`,
    cardId: `td-chord-${key}-${quality}-c`,
    template: 'chord-spelling',
    fields: { root, quality, answer },
    track: 'chords',
    stage,
    question: `Spell ${CHORD_NAME[quality](root)}.`,
    answer,
  };
};

const keyEntry = (slug: string, question: string, answer: string, fields: Record<string, string | number>): DeckEntry => ({
  itemId: `td-key-${slug}`,
  cardId: `td-key-${slug}-c`,
  template: 'key-spelling',
  fields,
  track: 'chords',
  stage: 5,
  question,
  answer,
});

/** The whole deck in teaching order, built deterministically so every device has identical ids. */
export function deckEntries(): DeckEntry[] {
  const out: DeckEntry[] = [];
  // Neck, stage 1: the open strings, and fret 12 as their octave.
  for (const [s] of OPEN_STRINGS) out.push(fretEntry(s, 0, 1));
  out.push(
    pattern('open-order', 1, 'Name the open strings from 6 (low) to 1 (high).', 'E A D G B E'),
    pattern('fret-12', 1, 'What is the note at fret 12 of any string?', 'The open string\'s note, one octave up: the neck starts again from there.'),
  );
  // Stages 2 and 3: strings 6 and 5, natural notes first, then sharps and flats.
  for (const sharp of [false, true]) {
    const stage = sharp ? 3 : 2;
    for (const s of [6, 5]) {
      const open = OPEN_STRINGS.find(([n]) => n === s)![2];
      for (let fret = 1; fret <= 11; fret++) if (isNatural((open + fret) % 12) !== sharp) out.push(fretEntry(s, fret, stage));
    }
    for (const s of [6, 5]) {
      const open = OPEN_STRINGS.find(([n]) => n === s)![2];
      for (let fret = 1; fret <= 11; fret++) if (isNatural((open + fret) % 12) !== sharp) out.push(findEntry(s, (open + fret) % 12, stage));
    }
  }
  out.push(
    pattern('half-steps', 2, 'Which natural notes are only one fret apart?', 'E and F, and B and C. Every other pair of natural notes is two frets apart.'),
    pattern('naturals-6', 2, 'Where are the natural notes on string 6, below fret 12?', 'E open, F 1, G 3, A 5, B 7, C 8, D 10.'),
    pattern('enharmonic', 3, 'Why do the cards show sharps as C#/Db?', 'One fret, two names (enharmonic). Either is right on the neck; the key decides which is written in a chord or chart.'),
    pattern('octave-6-4', 3, 'A note on string 6 or 5: where is the same note an octave up?', 'Two strings higher and two frets up (string 6 fret 3 G, string 4 fret 5 G).'),
  );
  // Stages 4 and 5: the rest of the neck, both directions.
  for (const [stage, strings] of [[4, [4, 3]], [5, [2, 1]]] as const) {
    for (const s of strings) for (let fret = 1; fret <= 11; fret++) out.push(fretEntry(s, fret, stage));
    for (const s of strings) {
      const open = OPEN_STRINGS.find(([n]) => n === s)![2];
      for (let fret = 1; fret <= 11; fret++) out.push(findEntry(s, (open + fret) % 12, stage));
    }
  }
  out.push(
    pattern('string-over', 4, 'Where is the same note on the next string up (toward the high E)?', 'Five frets lower: fret 5 of one string equals the next open string, except from G to B, where it is fret 4.'),
    pattern('octave-4-2', 4, 'A note on string 4 or 3: where is the same note an octave up?', 'Two strings higher and three frets up, because the B string is tuned a semitone lower (string 4 fret 2 E, string 2 fret 5 E).'),
    pattern('high-low-e', 5, 'How do the low E and high E strings relate?', 'Same notes at the same frets, two octaves apart: learn one and you know the other.'),
    pattern('above-12', 5, 'How do you find notes above fret 12?', 'Subtract 12: fret 15 is the same note as fret 3, an octave higher.'),
  );
  // Chords, stage 1: the 24 triads of the 2026-10-30 deck (E♭ minor now, not D♯ minor).
  for (const q of ['major', 'minor'] as const) for (const r of ROOTS[q]) out.push(chordEntry(r, q, 1));
  for (const q of ['power', 'dim'] as const) for (const r of ROOTS[q]) out.push(chordEntry(r, q, 2));
  for (const q of ['sus2', 'sus4'] as const) for (const r of ROOTS[q]) out.push(chordEntry(r, q, 3));
  for (const q of ['maj7', '7', 'm7'] as const) for (const r of ROOTS[q]) out.push(chordEntry(r, q, 4));
  // Stage 5: key signatures, the diatonic chords of the common guitar keys, barre shapes on the neck.
  for (const r of MAJOR_ROOTS) {
    const key = r.replace('#', 's').toLowerCase();
    out.push(keyEntry(`${key}-signature`, `What is the key signature of ${r} major?`, keySignature(r), { root: r, kind: 'signature' }));
  }
  for (const r of ['C', 'G', 'D', 'A', 'E']) {
    out.push(keyEntry(`${r.toLowerCase()}-chords`, `Name the diatonic chords of ${r} major, I to vii.`, diatonicChords(r), { root: r, kind: 'diatonic' }));
  }
  const shapes: [string, string, string][] = [
    ['e-shape-5', 'An E-shape barre chord at fret 5: which chord?', 'A major (root on string 6, fret 5).'],
    ['e-shape-8', 'An E-shape barre chord at fret 8: which chord?', 'C major (root on string 6, fret 8).'],
    ['a-shape-3', 'An A-shape barre chord with its root at fret 3: which chord?', 'C major (root on string 5, fret 3).'],
    ['a-shape-7', 'An A-shape barre chord with its root at fret 7: which chord?', 'E major (root on string 5, fret 7).'],
    ['em-shape-7', 'An Em-shape barre chord at fret 7: which chord?', 'B minor (root on string 6, fret 7).'],
    ['am-shape-5', 'An Am-shape barre chord with its root at fret 5: which chord?', 'D minor (root on string 5, fret 5).'],
  ];
  for (const [slug, q, a] of shapes) out.push(keyEntry(slug, q, a, { kind: 'shape' }));
  return out;
}

const ENTRIES = deckEntries();
const BY_ITEM = new Map(ENTRIES.map((e) => [e.itemId, e]));

/** Whether a card has been answered right (anything but Again) at least once. */
const rightOnce = (host: ModuleHost, cardId: string) => host.reviews(cardId).some((r) => r.rating !== 'again');

/**
 * The open stage of each track: stage 1, then each next stage once every
 * card of the stages before it is in the log and has been answered right at
 * least once.
 */
export function openStages(host: ModuleHost): Record<Track, number> {
  const have = new Set(host.cards().filter((c) => !c.retired).map((c) => c.id));
  const out = { neck: 1, chords: 1 } as Record<Track, number>;
  for (const track of ['neck', 'chords'] as const) {
    const last = STAGES[track].length;
    while (out[track] < last) {
      const cards = ENTRIES.filter((e) => e.track === track && e.stage <= out[track]);
      if (!cards.every((e) => have.has(e.cardId) && rightOnce(host, e.cardId))) break;
      out[track]++;
    }
  }
  return out;
}

/**
 * Adds the cards of every open stage that are missing, and switches off the
 * retired ones. Safe on every device, every launch, and after every answer.
 * Returns how many cards it added.
 */
export async function seedTestDeck(host: ModuleHost): Promise<number> {
  const cards = new Map(host.cards().map((c) => [c.id, c]));
  for (const id of RETIRED_DECK_CARDS) if (cards.get(id)?.retired === false) await host.retireCard(id);
  let added = 0;
  // Opening a stage can open the next only after answers, so one pass is enough.
  const open = openStages(host);
  const haveItems = new Set(host.items().map((i) => i.id));
  for (const e of ENTRIES) {
    if (e.stage > open[e.track]) continue;
    if (!haveItems.has(e.itemId)) await host.addItem(e.itemId, e.fields);
    if (!cards.has(e.cardId)) {
      await host.addCard(e.cardId, e.itemId, e.template);
      added++;
    }
  }
  return added;
}

/** Question and answer text for a card, from the code (so corrections reach every device); the item's own fields for anything older. */
export function prompt(card: Card, item: Item): { question: string; answer: string; diagram?: string } {
  const e = BY_ITEM.get(item.id);
  if (e) return { question: e.question, answer: e.answer, ...(e.diagram ? { diagram: e.diagram } : {}) };
  const f = item.fields;
  if (card.template === 'fret-note') return { question: `String ${f.string} (${f.stringName}), fret ${f.fret}: which note?`, answer: String(f.answer) };
  return { question: `Spell ${f.root} ${f.quality}.`, answer: String(f.answer) };
}
