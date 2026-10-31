/**
 * Bare goals panel for the test harness: the intake form (a gig or a
 * deadline, plus its building blocks), the list of goals with check-ins and
 * archive. No design. Today's blocks appear in the "Now" section (main.ts).
 */
import { archiveGoal, checkInGoal, goalFromForm, planGoals, practiceDay, tasksFromText } from '../src/index.ts';
import type { EventBody, GoalForm, ModuleHost, Replica, Validation } from '../src/index.ts';
import { songs } from '../src/modules/songs.ts';
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';

const $ = <T extends HTMLElement = HTMLInputElement>(name: Hook) => hook<T>(name);
/** An empty number field means "leave this block out". */
const optional = (name: Hook): number | undefined => {
  const v = $(name).value.trim();
  return v === '' ? undefined : Number(v);
};

export function setupGoals(replica: Replica, songsHost: ModuleHost, record: (r: Validation<EventBody>) => Promise<void>, say: (s: string) => void) {
  /** The song checkboxes as last drawn (code keeps its own references; no DOM queries). */
  let songBoxes: HTMLInputElement[] = [];
  const readForm = (): Validation<GoalForm> => {
    const tasks = tasksFromText($<HTMLTextAreaElement>('goal-tasks').value);
    if (!tasks.ok) return tasks;
    const writeMinutes = optional('goal-write-minutes');
    const improvTakes = optional('goal-improv-takes');
    const rampTo = optional('goal-improv-ramp-to');
    const rampDays = optional('goal-improv-ramp-days');
    const writePrompt = $('goal-write-prompt').value.trim();
    const daily = optional('goal-minutes');
    const feel = optional('goal-feel');
    const recall = optional('goal-recall');
    const itemIds = songBoxes.filter((b) => b.checked).map((b) => b.value);
    return {
      ok: true,
      value: {
        kind: $<HTMLSelectElement>('goal-kind').value as GoalForm['kind'],
        what: $('goal-what').value,
        why: $('goal-why').value,
        deadline: $('goal-deadline').value,
        itemIds,
        tasks: tasks.value,
        ...(daily === undefined ? {} : { dailyMinutes: daily }),
        ...(feel === undefined ? {} : { feel }),
        ...(recall === undefined ? {} : { recall }),
        ...(writeMinutes === undefined ? {} : { songwriting: { minutes: writeMinutes, takes: optional('goal-write-takes') ?? 1, ...(writePrompt ? { prompt: writePrompt } : {}) } }),
        ...(improvTakes === undefined
          ? {}
          : {
              improv: {
                takes: improvTakes,
                minutes: optional('goal-improv-minutes') ?? 1,
                ...(rampTo === undefined ? {} : { rampTo }),
                ...(rampDays === undefined ? {} : { rampDays }),
              },
            }),
      },
    };
  };

  return {
    render() {
      const lib = replica.library;
      const now = Date.now();
      const today = practiceDay(now, lib.settings.dayStart);
      // Songs to pick for the goal (a gig's set), kept ticked across renders.
      const ticked = new Set(songBoxes.filter((b) => b.checked).map((b) => b.value));
      songBoxes = [];
      $('goal-songs').replaceChildren(
        ...(songsHost.enabled ? songs(songsHost).filter((s) => !s.archived) : []).map((s) => {
          const label = document.createElement('label');
          label.dataset.zg = 'goal-song';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.value = s.itemId;
          box.checked = ticked.has(s.itemId);
          songBoxes.push(box);
          label.append(box, ` ${s.title}`);
          return label;
        }),
      );
      const checkIns = new Map(planGoals(lib, now).checkIns.map((c) => [c.goalId, c.daysLeft]));
      const live = [...lib.goals.values()].filter((g) => !g.archived && g.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline));
      $('goals-list').replaceChildren(
        ...live.map((g) => {
          const li = document.createElement('li');
          li.dataset.zg = 'goal';
          li.dataset.goal = g.id;
          li.append(`${g.what} · ${g.kind} · by ${g.deadline} · ${g.dailyMinutes} min a day · ${g.blocks.map((b) => b.label).join(', ')} `);
          const days = checkIns.get(g.id);
          if (days !== undefined) {
            const input = document.createElement('input');
            input.type = 'number';
            input.dataset.zg = 'goal-checkin';
            input.value = String(g.dailyMinutes);
            const save = document.createElement('button');
            save.dataset.zg = 'goal-checkin-save';
            save.textContent = 'Keep this plan';
            save.onclick = () => void record(checkInGoal(replica.library, g.id, Number(input.value)));
            input.oninput = () => (save.textContent = Number(input.value) === g.dailyMinutes ? 'Keep this plan' : 'Save new daily minutes');
            li.append(`Check-in: ${days} days left. Minutes a day `, input, ' ', save, ' ');
          }
          const archive = document.createElement('button');
          archive.dataset.zg = 'goal-archive';
          archive.textContent = 'Archive';
          archive.onclick = () => void record(archiveGoal(replica.library, g.id));
          li.append(archive);
          return li;
        }),
      );
    },
    wire() {
      $('goal-save').onclick = async () => {
        const form = readForm();
        if (!form.ok) return say(`Goal: ${form.error}`);
        const r = goalFromForm(form.value, `goal-${crypto.randomUUID().slice(0, 18)}`, replica.library, Date.now());
        if (!r.ok) return say(`Goal: ${r.error}`);
        await record(r);
        say(`Goal saved: ${form.value.what.trim()}`);
      };
    },
  };
}
