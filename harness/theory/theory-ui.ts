/**
 * Theory and physics cards for the test harness: the curriculum (2026-11-02).
 * Cards appear in today's lesson like any other: Q/A cards use Show answer
 * and the four ratings; multiple-choice cards show four options. Sources are
 * kept in the card data and never shown (Blake, 2026-11-02). The current
 * lesson's reading opens today's lesson; the Cards screen lists every lesson
 * (graduated, current, locked) and the Extras switch.
 */
import { runModule } from '../../src/index.ts';
import type { DayStart, ModuleHost, Rating } from '../../src/index.ts';
import { answerMc, chapterFor, contentOf, currentLesson, extras, lessonStates, needsReading, optionsFor, rateQa, seedTheory, setExtras } from '../../src/modules/theory/practice.ts';
import type { LessonState } from '../../src/modules/theory/practice.ts';
import { LESSONS } from '../../src/modules/theory/curriculum.ts';
import { hook } from '../shared/hooks.ts';
import type { Hook } from '../shared/hooks.ts';
import type { Sheets } from '../shared/sheets.ts';

const $ = <T extends HTMLElement = HTMLElement>(name: Hook) => hook<T>(name);

const paragraphs = (texts: readonly string[]) =>
  texts.map((t) => {
    const p = document.createElement('p');
    p.textContent = t;
    return p;
  });

export const lessonHeading = (s: LessonState) => `Lesson ${s.lesson.n} · ${s.lesson.title}`;

/** One lesson on the Cards screen: its state, and its reading once unlocked. */
function lessonRow(s: LessonState): HTMLElement {
  const li = document.createElement('li');
  li.dataset.zg = 'theory-lesson';
  li.dataset.status = s.status;
  const label =
    s.status === 'graduated'
      ? `${lessonHeading(s)}: graduated ✓`
      : s.status === 'current'
        ? `${lessonHeading(s)}: learning, ${s.ready} of ${s.total} cards solid`
        : s.status === 'open'
          ? `${lessonHeading(s)}: open, you can learn ahead`
          : `${lessonHeading(s)}: locked`;
  if (s.status === 'locked') {
    li.textContent = label;
    return li;
  }
  // Unlocked lessons can be read again.
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.append(summary, ...paragraphs(s.lesson.reading));
  li.append(details);
  return li;
}

/**
 * Where a theory card is drawn (2026-11-03): Home's deck (the Now card, shared
 * with every module) or Teach's lesson deck. Each has its own hooks and its
 * own feedback line.
 */
export type Slot = 'home' | 'teach' | 'review';
const SLOTS: Readonly<Record<Slot, { card: Hook; question: Hook; answer: Hook; choices: Hook; feedback: Hook; reveal: Hook; rate: Hook; read: Hook }>> = {
  home: { card: 'card', question: 'question', answer: 'answer', choices: 'mc-choices', feedback: 'card-feedback', reveal: 'reveal', rate: 'rate', read: 'card-read' },
  teach: { card: 'teach-card', question: 'teach-question', answer: 'teach-answer', choices: 'teach-choices', feedback: 'teach-feedback', reveal: 'teach-reveal', rate: 'teach-rate', read: 'teach-read' },
  review: { card: 'review-card', question: 'review-question', answer: 'review-answer', choices: 'review-choices', feedback: 'review-feedback', reveal: 'review-reveal', rate: 'review-rate', read: 'review-read' },
};

export interface TheoryDeps {
  /** Whether rating this card now is extra (early) practice: kept in the log, never scheduled (2026-11-08). */
  readonly isExtra: (cardId: string) => boolean;
  readonly sheets: Sheets;
}

export function setupTheory(host: ModuleHost, say: (s: string) => void, afterChange: () => Promise<void>, dayStart: () => DayStart, deps: TheoryDeps) {
  /** The card whose chapter each deck's "Read in Chapter" button opens: set by a Hard or Don't know, until the next answer. */
  const toRead: Record<Slot, string> = { home: '', teach: '', review: '' };
  const chapterName = (cardId: string) => {
    const m = chapterFor(host, cardId);
    return m ? `Chapter ${m.chapter} · ${m.title}` : '';
  };
  const showRead = (where: Slot) => {
    const b = $<HTMLButtonElement>(SLOTS[where].read);
    b.hidden = toRead[where] === '';
    if (toRead[where]) b.textContent = `Read in Chapter: ${chapterName(toRead[where])}`;
  };
  /** The last multiple-choice result in each deck, shown until the next answer there. */
  const feedback: Record<Slot, string> = { home: '', teach: '', review: '' };
  /** Lesson whose reading is drawn (redrawn only when it changes, so an open/closed choice sticks). */
  let drawn = -1;

  /** After an answer: unlock the next lesson if this one just graduated. */
  const unlock = async () => {
    const before = currentLesson(host, dayStart())?.lesson.n ?? null;
    const r = await runModule(host, () => seedTheory(host, dayStart()));
    if (!r.ok) return say(`Theory cards switched off: ${r.error}`);
    const now = currentLesson(host, dayStart());
    if (r.value > 0 && now && now.lesson.n !== before) say(`Lesson ${before ?? ''} graduated. Unlocked ${lessonHeading(now)}.`);
  };

  return {
    /**
     * Draws a theory card in a deck (Home's Now card by default). Returns
     * false if the card is not a theory card (the deck is then cleared of
     * theory content and left to its caller).
     */
    showCard(cardId: string, revealed: boolean, startedAt: () => number, where: Slot = 'home'): boolean {
      const h = SLOTS[where];
      const card = contentOf(host, cardId);
      $(h.choices).replaceChildren();
      $(h.feedback).textContent = feedback[where];
      showRead(where);
      if (!card) return false;
      $(h.question).textContent = card.question;
      $(h.card).dataset.card = cardId;
      if (card.type === 'qa') {
        $(h.answer).textContent = revealed ? card.answer : '';
        $(h.rate).hidden = !revealed;
        $(h.reveal).hidden = revealed;
        return true;
      }
      $(h.answer).textContent = '';
      $(h.rate).hidden = $(h.reveal).hidden = true;
      const seed = Number($(h.card).dataset.started ?? 1) || 1;
      $(h.choices).replaceChildren(
        ...optionsFor(card, seed).map((option) => {
          const b = document.createElement('button');
          if (where === 'home') b.dataset.zg = 'mc-choice';
          else if (where === 'teach') b.dataset.zg = 'teach-choice';
          else b.dataset.zg = 'review-choice';
          b.textContent = option;
          b.onclick = async () => {
            const extra = deps.isExtra(cardId);
            const r = await runModule(host, () => answerMc(host, cardId, option, Date.now() - startedAt(), extra));
            if (!r.ok) say(`Theory cards switched off: ${r.error}`);
            else if (!r.value.ok) say(`Theory: ${r.value.error}`);
            else {
              feedback[where] = `${r.value.value.correct ? '✓' : `✗ The answer: ${card.answer}.`} ${card.why}`;
              toRead[where] = r.value.value.correct ? '' : cardId; // a wrong answer is a Don't know
            }
            $(h.card).dataset.started = String(Date.now());
            await unlock();
            await afterChange();
          };
          return b;
        }),
      );
      return true;
    },
    /** Rates a Q/A theory card (from either deck). */
    async rate(cardId: string, rating: Rating, durationMs: number, where: Slot = 'home'): Promise<void> {
      feedback[where] = '';
      toRead[where] = needsReading(rating) ? cardId : '';
      const extra = deps.isExtra(cardId);
      const r = await runModule(host, () => rateQa(host, cardId, rating, durationMs, extra));
      if (!r.ok) say(`Theory cards switched off: ${r.error}`);
      else if (!r.value.ok) say(`Theory: ${r.value.error}`);
      await unlock();
    },
    clearFeedback(where: Slot = 'home') {
      feedback[where] = '';
    },
    /** The current lesson, for today's breakdown (null when the course is done or the module is off). */
    current(): LessonState | null {
      return host.enabled ? currentLesson(host, dayStart()) : null;
    },
    /** Teach: the current curriculum lesson's reading. */
    renderReading() {
      const s = host.enabled ? currentLesson(host, dayStart()) : null;
      $('lesson-reading').hidden = s === null;
      if (!s || s.lesson.n === drawn) return;
      drawn = s.lesson.n;
      $('lesson-title').textContent = `${lessonHeading(s)} (${s.chapterTitle})`;
      $('lesson-text').replaceChildren(...paragraphs(s.lesson.reading));
      // A new lesson opens its reading; one already started stays as the user left it.
      ($('lesson-reading') as HTMLDetailsElement).open = s.started === 0;
    },
    /** The Cards screen: every lesson with its state, and the Extras switch. */
    renderLessons() {
      if (!host.enabled) {
        $('theory-lessons').textContent = `Theory cards switched off: ${host.disabledReason}`;
        return;
      }
      const rows: HTMLElement[] = [];
      for (const s of lessonStates(host, dayStart())) {
        // A heading row where each chapter starts.
        if (s.lesson.n === 1 || LESSONS[s.lesson.n - 2]!.chapter !== s.lesson.chapter) {
          const head = document.createElement('li');
          head.dataset.zg = 'theory-chapter';
          head.textContent = `Chapter ${s.lesson.chapter} · ${s.chapterTitle}`;
          rows.push(head);
        }
        rows.push(lessonRow(s));
      }
      $('theory-lessons').replaceChildren(...rows);
      const x = extras(host);
      const box = $<HTMLInputElement>('theory-extras');
      box.checked = x.on > 0;
      $('theory-extras-label').textContent = `Extras: deeper cards beside the lessons, not needed to move on (${x.on} of ${x.total} on)`;
    },
    /** "Read in Chapter" (2026-11-08): the chapter the card belongs to, in our own words, with the card's own lesson on top. */
    openChapter(cardId: string) {
      const m = chapterFor(host, cardId);
      if (!m) return say('That card is not from the course, so it has no chapter.');
      $('chapter-title').textContent = `Chapter ${m.chapter} · ${m.title}`;
      $('chapter-card').textContent = contentOf(host, cardId)?.question ?? '';
      const lessons = [...m.lessons].sort((a, b) => Number(b.relevant) - Number(a.relevant));
      $('chapter-lessons').replaceChildren(
        ...lessons.map((l) => {
          const d = document.createElement('details');
          d.dataset.zg = 'chapter-lesson';
          if (l.relevant) {
            d.open = true;
            d.dataset.relevant = '';
          }
          const sum = document.createElement('summary');
          sum.textContent = `Lesson ${l.n} · ${l.title}${l.relevant ? ' (this card)' : ''}`;
          d.append(sum, ...paragraphs(l.reading));
          return d;
        }),
      );
      deps.sheets.open('chapter');
    },
    wire() {
      for (const where of ['home', 'teach', 'review'] as const) $<HTMLButtonElement>(SLOTS[where].read).onclick = () => this.openChapter(toRead[where]);
      $<HTMLInputElement>('theory-extras').onchange = async () => {
        const r = await runModule(host, () => setExtras(host, $<HTMLInputElement>('theory-extras').checked));
        if (!r.ok) say(`Theory cards switched off: ${r.error}`);
        else if (!r.value.ok) say(`Theory: ${r.value.error}`);
        await afterChange();
      };
    },
  };
}
