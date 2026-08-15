import { FIXED_BUTTON_ACTIONS } from '../../store/types';
import type { UserPrefsButton } from '../../store/types';

const SLOT_LABELS: Record<string, string> = {
  github: 'GitHub orb',
  gmail: 'Gmail orb',
  policy: 'Policy orb',
  user: 'User orb',
};

/** Buttons section — the four bar orbs are a FIXED set (no add/remove/
 * reorder, per the design spec's locked decision); each gets an action
 * picker from the fixed action list plus an optional label. */
export default function ButtonEditor({
  buttons,
  onChange,
}: {
  buttons: UserPrefsButton[];
  onChange(next: UserPrefsButton[]): void;
}) {
  function update(id: string, patch: Partial<UserPrefsButton>) {
    onChange(buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  return (
    <div className="flex flex-col gap-2.5">
      {buttons.map((button) => (
        <div key={button.id} className="flex items-center gap-3">
          <span className="w-40 shrink-0 text-[13px] text-white/60">{SLOT_LABELS[button.id] ?? button.id}</span>
          <select
            value={button.action}
            onChange={(e) => update(button.id, { action: e.target.value })}
            className="w-48 rounded-lg border border-white/10 bg-surface-sunken px-3 py-1.5 text-[13px] text-white outline-none transition-colors focus:border-accent/60"
          >
            {FIXED_BUTTON_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={button.label ?? ''}
            onChange={(e) => update(button.id, { label: e.target.value })}
            placeholder="label (optional)"
            className="flex-1 rounded-lg border border-white/10 bg-surface-sunken px-3 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
          />
        </div>
      ))}
    </div>
  );
}
