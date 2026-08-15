// Tiny dependency-free markdown renderer for memory content. Handles the
// subset memories actually use — headings, bullet lists, code fences,
// bold/italic/inline-code — plus the memory link syntax: [[title-or-id]]
// renders as a clickable jump (onJump) and @toolkit as a tool chip. Not a
// general markdown engine; anything unrecognized falls back to plain text.
import type { ReactNode } from 'react';

interface Props {
  contentMd: string;
  /** Called with the raw [[ref]] text when a memory link is clicked. */
  onJump(ref: string): void;
}

const INLINE_RE = /(\[\[[^[\]]+\]\])|((?:^|[^\w])@[a-z][a-z0-9_-]{1,63})|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/gi;

function renderInline(text: string, onJump: (ref: string) => void, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    const token = m[0];
    if (idx > last) nodes.push(text.slice(last, idx));
    const key = `${keyBase}-${i++}`;
    if (m[1]) {
      const ref = token.slice(2, -2).trim();
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => onJump(ref)}
          className="rounded bg-white/[0.06] px-1 text-accent underline decoration-accent/40 underline-offset-2 hover:bg-white/10"
        >
          {ref}
        </button>,
      );
    } else if (m[2]) {
      // token may carry the preceding non-word char — keep it as text.
      const at = token.indexOf('@');
      if (at > 0) nodes.push(token.slice(0, at));
      nodes.push(
        <span key={key} className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-white/70">
          {token.slice(at)}
        </span>,
      );
    } else if (m[3]) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (m[4]) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (m[5]) {
      nodes.push(
        <code key={key} className="rounded bg-white/[0.08] px-1 font-mono text-[12px]">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = idx + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function MemoryMarkdown({ contentMd, onJump }: Props) {
  const blocks: ReactNode[] = [];
  const lines = contentMd.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) code.push(lines[i++] ?? '');
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-[12px] leading-relaxed text-white/80">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const cls = level === 1 ? 'text-[15px] font-semibold' : level === 2 ? 'text-[13.5px] font-semibold' : 'text-[12.5px] font-semibold';
      blocks.push(
        <p key={key++} className={`${cls} text-white`}>
          {renderInline(heading[2] ?? '', onJump, `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-white/75">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item, onJump, `li${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // paragraph — swallow consecutive non-empty, non-special lines
    const para: string[] = [line];
    i++;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !/^(#{1,3}\s|```|\s*[-*]\s)/.test(lines[i] ?? '')) {
      para.push(lines[i] ?? '');
      i++;
    }
    blocks.push(
      <p key={key++} className="text-[13px] leading-relaxed text-white/75">
        {renderInline(para.join(' '), onJump, `p${key}`)}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
