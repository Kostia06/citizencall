import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthError, ROUTINE_SCHEDULES, storeApi } from '../../api';
import type { AuthedFetch, Routine, RoutineSchedule } from '../../api';

const SCHEDULE_LABELS: Record<RoutineSchedule, string> = {
  none: 'Manual only',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
};

function Toggle({ on, onClick, label }: { on: boolean; onClick(): void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-ink/10'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper transition-transform duration-200 ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function ScheduleSelect({
  value,
  onChange,
  id,
}: {
  value: RoutineSchedule;
  onChange(next: RoutineSchedule): void;
  id: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as RoutineSchedule)}
      className="rounded-md border border-ink/10 bg-surface-sunken px-2 py-1 text-[12px] text-ink outline-none transition-colors focus:border-accent/60"
    >
      {ROUTINE_SCHEDULES.map((s) => (
        <option key={s} value={s}>
          {SCHEDULE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

/** One routine — view mode by default, switches to an inline edit form
 * (name/prompt/schedule) when `editing`, mirroring CustomMcpsPanel's McpRow. */
function RoutineRow({
  routine,
  onToggle,
  onSave,
  onDelete,
  busy,
}: {
  routine: Routine;
  onToggle(): void;
  onSave(patch: { name: string; prompt: string; schedule: RoutineSchedule }): void;
  onDelete(): void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(routine.name);
  const [prompt, setPrompt] = useState(routine.prompt);
  const [schedule, setSchedule] = useState<RoutineSchedule>(routine.schedule);

  function startEdit() {
    setName(routine.name);
    setPrompt(routine.prompt);
    setSchedule(routine.schedule);
    setEditing(true);
  }

  function submit() {
    if (!name.trim() || !prompt.trim()) return;
    onSave({ name: name.trim(), prompt: prompt.trim(), schedule });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-accent/30 bg-ink/[0.03] p-3.5">
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-ink/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Summarize overnight PR activity and open issues."
            className="resize-none rounded-md border border-ink/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
          />
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-ink/40">Schedule</span>
            <ScheduleSelect value={schedule} onChange={setSchedule} id={`schedule-${routine.id}`} />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!name.trim() || !prompt.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-black transition-colors hover:bg-accent-bright disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 text-[12.5px] text-ink/50 transition-colors hover:text-ink/80"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5">
      <Toggle on={routine.enabled} onClick={onToggle} label={`${routine.enabled ? 'Disable' : 'Enable'} ${routine.name}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink">{routine.name}</p>
        <p className="mt-0.5 line-clamp-2 text-[11.5px] text-ink/35">{routine.prompt}</p>
        <p className="mt-1 text-[10.5px] uppercase tracking-wide text-ink/25">{SCHEDULE_LABELS[routine.schedule]}</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={startEdit}
        aria-label={`Edit ${routine.name}`}
        className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-ink/50 transition-colors hover:text-ink disabled:opacity-40"
      >
        Edit
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        aria-label={`Delete ${routine.name}`}
        className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-ink/50 transition-colors hover:text-red-400 disabled:opacity-40"
      >
        Delete
      </button>
    </div>
  );
}

/** "Routines" Settings section — create/edit/delete a user's saved prompts
 * (name, prompt, optional schedule preset, enabled toggle). CRUD hits
 * `storeApi.{list,create,update,delete}Routine`; MOCK mode (or an
 * anonymous/unverified caller getting a 401) keeps edits in local state only,
 * flagged "unsaved" — same "log in to save" pattern as CustomMcpsPanel. A
 * routine bound to a bar button (`routine:<id>`, ButtonEditor's "Routines"
 * group) runs its prompt through the bar via Orbs' `onRunRoutine`. */
export default function RoutinesPanel({
  authedFetch,
  onRoutinesChange,
}: {
  authedFetch: AuthedFetch;
  /** Mirrors this panel's up-to-date list up to Settings, so ButtonEditor's
   * "Routines" picker group reflects create/edit/delete without owning its
   * own separate fetch (and separate loading/error states) for the same data. */
  onRoutinesChange?(routines: Routine[]): void;
}) {
  const [routines, setRoutinesState] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);

  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState<RoutineSchedule>('none');

  function setRoutines(next: Routine[] | ((list: Routine[]) => Routine[])) {
    setRoutinesState((prev) => {
      const resolved = typeof next === 'function' ? (next as (list: Routine[]) => Routine[])(prev) : next;
      onRoutinesChange?.(resolved);
      return resolved;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await storeApi.listRoutines(authedFetch);
        if (!cancelled) setRoutines(list);
      } catch {
        if (!cancelled) setRoutines([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch]);

  async function handleAdd() {
    if (!name.trim() || !prompt.trim()) return;
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Routine = { id: tempId, name: name.trim(), prompt: prompt.trim(), schedule, enabled: true };
    setRoutines((list) => [...list, optimistic]);
    setName('');
    setPrompt('');
    setSchedule('none');

    try {
      const saved = await storeApi.createRoutine(authedFetch, {
        name: optimistic.name,
        prompt: optimistic.prompt,
        schedule: optimistic.schedule,
        enabled: true,
      });
      setRoutines((list) => list.map((r) => (r.id === tempId ? saved : r)));
      setLoginRequired(false);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        setLoginRequired(true); // keep the optimistic row — session-only
      } else {
        setRoutines((list) => list.filter((r) => r.id !== tempId));
      }
    }
  }

  async function handleToggle(routine: Routine) {
    const next = !routine.enabled;
    setRoutines((list) => list.map((r) => (r.id === routine.id ? { ...r, enabled: next } : r)));
    if (routine.id.startsWith('temp-')) return;
    setBusyId(routine.id);
    try {
      await storeApi.updateRoutine(authedFetch, routine.id, { enabled: next });
      setLoginRequired(false);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) setLoginRequired(true);
      else setRoutines((list) => list.map((r) => (r.id === routine.id ? { ...r, enabled: routine.enabled } : r)));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveEdit(routine: Routine, patch: { name: string; prompt: string; schedule: RoutineSchedule }) {
    setRoutines((list) => list.map((r) => (r.id === routine.id ? { ...r, ...patch } : r)));
    if (routine.id.startsWith('temp-')) return;
    setBusyId(routine.id);
    try {
      await storeApi.updateRoutine(authedFetch, routine.id, patch);
      setLoginRequired(false);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) setLoginRequired(true);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(routine: Routine) {
    setRoutines((list) => list.filter((r) => r.id !== routine.id));
    if (routine.id.startsWith('temp-')) return;
    try {
      await storeApi.deleteRoutine(authedFetch, routine.id);
    } catch {
      // Best-effort — a stale row can only reappear on a real reload.
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {loading ? (
        <p className="text-[12.5px] text-ink/35">Loading…</p>
      ) : routines.length === 0 ? (
        <p className="text-[12.5px] text-ink/35">No routines yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              busy={busyId === routine.id}
              onToggle={() => handleToggle(routine)}
              onSave={(patch) => handleSaveEdit(routine, patch)}
              onDelete={() => handleDelete(routine)}
            />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3.5">
        <p className="mb-2 text-[12px] font-medium text-ink/60">Add a routine</p>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-ink/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Summarize overnight PR activity and open issues."
            className="resize-none rounded-md border border-ink/10 bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-accent/60"
          />
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-ink/40">Schedule</span>
            <ScheduleSelect value={schedule} onChange={setSchedule} id="new-routine-schedule" />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!name.trim() || !prompt.trim()}
            className="mt-1 self-start rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-black transition-colors hover:bg-accent-bright disabled:opacity-40"
          >
            Add routine
          </button>
        </div>
      </div>

      {loginRequired && (
        <p className="text-[12px] text-ink/40">
          Kept for this session —{' '}
          <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
            log in
          </Link>{' '}
          to save.
        </p>
      )}
    </div>
  );
}
