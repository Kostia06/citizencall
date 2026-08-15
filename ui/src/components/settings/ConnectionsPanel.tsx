import { Link } from 'react-router-dom';
import type { Connection } from '../../store/types';

const TOOLKITS: Array<{ id: 'github' | 'gmail'; label: string }> = [
  { id: 'github', label: 'GitHub' },
  { id: 'gmail', label: 'Gmail' },
];

/** Connections section — web UI design spec §6. Connect/disconnect each
 * toolkit; a per-toolkit inline "log in to connect" prompt appears when the
 * call 401s (auth-gated endpoint) instead of a hard error. */
export default function ConnectionsPanel({
  connections,
  onConnect,
  onDisconnect,
  pendingToolkit,
  loginRequiredFor,
}: {
  connections: Connection[];
  onConnect(toolkit: string): void;
  onDisconnect(toolkit: string): void;
  pendingToolkit: string | null;
  loginRequiredFor: string | null;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {TOOLKITS.map(({ id, label }) => {
        const connection = connections.find((c) => c.toolkit === id && c.status === 'active');
        const connected = !!connection;
        const isPending = pendingToolkit === id;
        return (
          <div key={id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-[13px] text-white/60">{label}</span>
              <span className={`text-[12px] ${connected ? 'text-accent-bright' : 'text-white/35'}`}>
                {connected ? 'Connected' : 'Not connected'}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => (connected ? onDisconnect(id) : onConnect(id))}
                className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-white/70 transition-colors hover:border-accent/40 hover:text-white disabled:opacity-40"
              >
                {isPending ? 'Working…' : connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
            {loginRequiredFor === id && (
              <p className="pl-[10.5rem] text-[12px] text-white/40">
                <Link to="/login" className="text-accent-bright transition-colors hover:text-accent">
                  Log in
                </Link>{' '}
                to connect {label}.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
