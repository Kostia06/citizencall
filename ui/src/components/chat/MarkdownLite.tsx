import type { ReactNode } from 'react';

const CODE_BLOCK_RE = /```([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

function renderInlineCode(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_CODE_RE).map((part, i) =>
    i % 2 === 1 ? (
      <code key={`${keyPrefix}-c${i}`} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function renderPlainText(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(URL_RE).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <a
          key={`${keyPrefix}-u${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-bright underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {part}
        </a>,
      );
    } else {
      out.push(...renderInlineCode(part, `${keyPrefix}-t${i}`));
    }
  });
  return out;
}

function codeBlock(key: string, content: string): ReactNode {
  return (
    <pre
      key={key}
      className="my-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[12px] leading-snug text-white/80"
    >
      <code>{content.replace(/^\n/, '').replace(/\n$/, '')}</code>
    </pre>
  );
}

function renderCompleteBlocks(text: string): ReactNode[] {
  return text.split(CODE_BLOCK_RE).map((part, i) =>
    i % 2 === 1 ? codeBlock(`b${i}`, part) : <span key={`t${i}`}>{renderPlainText(part, `t${i}`)}</span>,
  );
}

/** Tiny hand-rolled renderer — the ONLY markdown this app supports: fenced
 * ```code blocks```, `inline code`, and bare URL linkification. Newlines are
 * already preserved by the caller's `whitespace-pre-wrap`. Builds React
 * nodes directly (never `dangerouslySetInnerHTML`), so it's XSS-safe by
 * construction — plain text renders as text, nothing is ever parsed as HTML.
 *
 * TypewriterText calls this on a growing prefix of the answer, so a fence
 * can legitimately be open-but-not-yet-closed mid-reveal — treat a trailing
 * unterminated ``` as an in-progress code block instead of leaking the raw
 * backticks as plain text for a few frames. */
export function renderMarkdownLite(text: string): ReactNode {
  const fenceCount = (text.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    const lastFence = text.lastIndexOf('```');
    return (
      <>
        {renderCompleteBlocks(text.slice(0, lastFence))}
        {codeBlock('b-open', text.slice(lastFence + 3))}
      </>
    );
  }
  return renderCompleteBlocks(text);
}
