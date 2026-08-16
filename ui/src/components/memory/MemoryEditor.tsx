// Edit/new form for a memory — title input + markdown textarea, with a hint
// for the [[link]] / @tool syntax. Purely controlled; persistence lives in
// the /memory route (memoryApi.create / update).
import { useState } from 'react';

interface Props {
  initialTitle?: string;
  initialContentMd?: string;
  saving: boolean;
  onSave(title: string, contentMd: string): void;
  onCancel(): void;
}

export default function MemoryEditor({ initialTitle = '', initialContentMd = '', saving, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [contentMd, setContentMd] = useState(initialContentMd);
  const valid = title.trim().length > 0 && contentMd.trim().length > 0;

  return (
    <div className="space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[13.5px] text-white placeholder-white/30 outline-none focus:border-accent/50"
      />
      <textarea
        value={contentMd}
        onChange={(e) => setContentMd(e.target.value)}
        placeholder="Markdown content…"
        rows={10}
        className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-white/85 placeholder-white/30 outline-none focus:border-accent/50"
      />
      <p className="text-[11.5px] text-white/35">
        Link other memories with <code className="rounded bg-white/[0.08] px-1">[[title]]</code> and tools with{' '}
        <code className="rounded bg-white/[0.08] px-1">@toolkit</code>. Links resolve cycle-safely.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid || saving}
          onClick={() => onSave(title.trim(), contentMd)}
          className="rounded-xl bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-bright disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-white/10 px-4 py-1.5 text-[13px] text-white/70 transition hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
