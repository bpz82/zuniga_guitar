/**
 * Bare theory and physics flashcards for the test harness. No design.
 * Cards appear in the "Now" card like any other: Q/A cards use Show answer
 * and the four ratings; multiple-choice cards show four options. Every card
 * shows its source. The theory panel turns topics on and off.
 */
import { runModule } from '../src/index.ts';
import type { ModuleHost, Rating } from '../src/index.ts';
import { citation } from '../src/modules/theory/deck.ts';
import { answerMc, contentOf, optionsFor, rateQa, setTopic, topics } from '../src/modules/theory/practice.ts';
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';

const $ = <T extends HTMLElement = HTMLElement>(name: Hook) => hook<T>(name);

export function setupTheory(host: ModuleHost, say: (s: string) => void, afterChange: () => Promise<void>) {
  /** The last multiple-choice result, shown until the next answer. */
  let feedback = '';

  return {
    /** Draws a theory card in the Now card. Returns false if the card is not a theory card. */
    showCard(cardId: string, revealed: boolean, startedAt: () => number): boolean {
      const card = contentOf(host, cardId);
      $('mc-choices').replaceChildren();
      $('card-feedback').textContent = feedback;
      if (!card) {
        $('card-source').textContent = '';
        return false;
      }
      $('question').textContent = card.question;
      $('card-source').textContent = citation(card.source);
      $('card').dataset.card = cardId;
      if (card.type === 'qa') {
        $('answer').textContent = revealed ? card.answer : '';
        $('rate').hidden = !revealed;
        $('reveal').hidden = revealed;
        return true;
      }
      $('answer').textContent = '';
      $('rate').hidden = $('reveal').hidden = true;
      const seed = Number($('card').dataset.started ?? 1) || 1;
      $('mc-choices').replaceChildren(
        ...optionsFor(card, seed).map((option) => {
          const b = document.createElement('button');
          b.dataset.zg = 'mc-choice';
          b.textContent = option;
          b.onclick = async () => {
            const r = await runModule(host, () => answerMc(host, cardId, option, Date.now() - startedAt()));
            if (!r.ok) say(`Theory cards switched off: ${r.error}`);
            else if (!r.value.ok) say(`Theory: ${r.value.error}`);
            else feedback = `${r.value.value.correct ? '✓' : `✗ The answer: ${card.answer}.`} ${card.why}`;
            $('card').dataset.started = String(Date.now());
            await afterChange();
          };
          return b;
        }),
      );
      return true;
    },
    /** Rates a Q/A theory card. */
    async rate(cardId: string, rating: Rating, durationMs: number): Promise<void> {
      feedback = '';
      const r = await runModule(host, () => rateQa(host, cardId, rating, durationMs));
      if (!r.ok) say(`Theory cards switched off: ${r.error}`);
      else if (!r.value.ok) say(`Theory: ${r.value.error}`);
    },
    clearFeedback() {
      feedback = '';
    },
    renderTopics() {
      if (!host.enabled) {
        $('theory-topics').textContent = `Theory cards switched off: ${host.disabledReason}`;
        return;
      }
      $('theory-topics').replaceChildren(
        ...topics(host).map((tp) => {
          const label = document.createElement('label');
          label.dataset.zg = 'theory-topic';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = tp.on > 0;
          box.onchange = async () => {
            const r = await runModule(host, () => setTopic(host, tp.topic, box.checked));
            if (!r.ok) say(`Theory cards switched off: ${r.error}`);
            else if (!r.value.ok) say(`Theory: ${r.value.error}`);
            await afterChange();
          };
          label.append(box, ` ${tp.label} (${tp.on} of ${tp.total} cards on)`);
          return label;
        }),
      );
    },
  };
}
