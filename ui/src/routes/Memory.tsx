// /memory — the per-user memory page (roadmap sub-project #3): everything
// the agent has remembered (source 'agent', badge "auto") alongside the
// user's own notes (badge "you"), as viewable/editable markdown. Same calm
// glass-section language as Settings; [[links]] in a memory jump to the
// linked memory, resolved cycle-safely on the worker.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import TopNav from '../components/TopNav';
import MemoryMarkdown from '../components/memory/MemoryMarkdown';
import MemoryEditor from '../components/memory/MemoryEditor';
import { ToastStack, useToasts } from '../components/Toast';
import { memoryApi } from '../api';
import type { UserMemory } from '../types';
import { useAuth } from '../auth/useAuth';
import { entranceStandard, entranceStandardReduced } from '../lib/motion';

type Mode = { kind: 'list' } | { kind: 'view'; id: string } | { kind: 'edit'; id: string } | { kind: 'new' };

function SectionCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-surface/60 p-6 backdrop-blur-xl">{children}</div>;
}

function SourceBadge({ source }: { source: UserMemory['source'] }) {
  return source === 'agent' ? (
    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-bright">auto</span>
  ) : (
    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/60">you</span>
  );
}

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function Memory() {
  const { authedFetch } = useAuth();
  const reduceMotion = !!useReducedMotion();
  const { toasts, push } = useToasts();

  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMemories(await memoryApi.list(authedFetch));
    } catch {
      setMemories([]);
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = mode.kind === 'view' || mode.kind === 'edit' ? memories.find((m) => m.id === mode.id) : undefined;

  // [[ref]] click: jump to the referenced memory by id or title (the same
  // lookup order the worker resolver uses).
  const jump = useCallback(
    (ref: string) => {
      const key = ref.trim().toLowerCase();
      const target = memories.find((m) => m.id === ref) ?? memories.find((m) => m.title.toLowerCase() === key);
      if (target) setMode({ kind: 'view', id: target.id });
      else push(`No memory named “${ref}”`);
    },
    [memories, push],
  );

  async function save(title: string, contentMd: string) {
    setSaving(true);
    try {
      if (mode.kind === 'edit') {
        await memoryApi.update(authedFetch, mode.id, { title, contentMd });
        push('Memory saved');
        setMode({ kind: 'view', id: mode.id });
      } else {
        const created = await memoryApi.create(authedFetch, { title, contentMd });
        push('Memory created');
        setMode({ kind: 'view', id: created.id });
      }
      await refresh();
    } catch {
      push('Could not save memory');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setConfirmDelete(null);
    try {
      await memoryApi.remove(authedFetch, id);
      push('Memory deleted');
      setMode({ kind: 'list' });
      await refresh();
    } catch {
      push('Could not delete memory');
    }
  }

  return (
    <div className="min-h-screen px-6 pb-24 pt-24">
      <TopNav />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? entranceStandardReduced : entranceStandard}
        className="mx-auto flex max-w-2xl flex-col gap-4"
      >
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[18px] font-semibold text-white">Memory</h1>
            <p className="mt-1 text-[12.5px] text-white/40">
              What Understudy remembers about you — written by the agent after runs, editable by you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMode({ kind: 'new' })}
            className="rounded-xl bg-accent px-4 py-1.5 text-[13px] font-medium text-paper transition hover:bg-accent-bright"
          >
            New memory
          </button>
        </div>

        {mode.kind === 'new' && (
          <SectionCard>
            <h2 className="mb-4 text-[15px] font-semibold text-white">New memory</h2>
            <MemoryEditor saving={saving} onSave={save} onCancel={() => setMode({ kind: 'list' })} />
          </SectionCard>
        )}

        {(mode.kind === 'view' || mode.kind === 'edit') && selected && (
          <SectionCard>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold text-white">{selected.title}</h2>
                <SourceBadge source={selected.source} />
              </div>
              <button type="button" onClick={() => setMode({ kind: 'list' })} className="text-[12.5px] text-white/50 hover:text-white/80">
                ← All memories
              </button>
            </div>
            {mode.kind === 'edit' ? (
              <MemoryEditor
                initialTitle={selected.title}
                initialContentMd={selected.contentMd}
                saving={saving}
                onSave={save}
                onCancel={() => setMode({ kind: 'view', id: selected.id })}
              />
            ) : (
              <>
                <MemoryMarkdown contentMd={selected.contentMd} onJump={jump} />
                <div className="mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4">
                  <button
                    type="button"
                    onClick={() => setMode({ kind: 'edit', id: selected.id })}
                    className="rounded-xl border border-white/10 px-4 py-1.5 text-[13px] text-white/80 transition hover:bg-white/5"
                  >
                    Edit
                  </button>
                  {confirmDelete === selected.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => remove(selected.id)}
                        className="rounded-xl bg-red-500/80 px-4 py-1.5 text-[13px] font-medium text-paper transition hover:bg-red-500"
                      >
                        Really delete
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="text-[12.5px] text-white/50 hover:text-white/80">
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(selected.id)}
                      className="rounded-xl border border-red-400/20 px-4 py-1.5 text-[13px] text-red-300/80 transition hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  )}
                  <span className="ml-auto text-[11.5px] text-white/30">updated {fmtDate(selected.updatedAt)}</span>
                </div>
              </>
            )}
          </SectionCard>
        )}

        {mode.kind === 'list' && (
          <SectionCard>
            {!loaded ? (
              <p className="text-[13px] text-white/40">Loading…</p>
            ) : memories.length === 0 ? (
              <p className="text-[13px] text-white/40">
                Nothing remembered yet. Run something like “remember that I prefer short answers” — or add a memory yourself.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {memories.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setMode({ kind: 'view', id: m.id })}
                      className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-white/[0.03]"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-white/85">{m.title}</span>
                      <SourceBadge source={m.source} />
                      <span className="shrink-0 text-[11.5px] tabular-nums text-white/30">{fmtDate(m.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </motion.div>
      <ToastStack toasts={toasts} />
    </div>
  );
}
