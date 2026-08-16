import type { ReactNode } from 'react';

const CODE_BLOCK_RE = /```([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const ITALIC_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

// ---- inline pass: code spans → bold → italic → URLs, all as React nodes ----

function renderUrls(text: string, keyPrefix: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={`${keyPrefix}-u${i}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-bright underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function renderItalic(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(ITALIC_RE).forEach((part, i) => {
    if (i % 2 === 1) out.push(<em key={`${keyPrefix}-i${i}`}>{renderUrls(part, `${keyPrefix}-i${i}`)}</em>);
    else out.push(...renderUrls(part, `${keyPrefix}-p${i}`));
  });
  return out;
}

function renderBold(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(BOLD_RE).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-white">
          {renderItalic(part, `${keyPrefix}-b${i}`)}
        </strong>,
      );
    } else {
      out.push(...renderItalic(part, `${keyPrefix}-n${i}`));
    }
  });
  return out;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(INLINE_CODE_RE).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">
          {part}
        </code>,
      );
    } else {
      out.push(...renderBold(part, `${keyPrefix}-t${i}`));
    }
  });
  return out;
}

// ---- block pass: headings, bullet/numbered lists, paragraphs ----

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING_RE = /^\s*(#{1,4})\s+(.*)$/;

function renderRichText(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let block = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(
        <div
          key={`${keyPrefix}-h${block++}`}
          className={`mt-3 mb-1 first:mt-0 font-semibold text-white ${level <= 2 ? 'text-[15px]' : 'text-[13.5px]'}`}
        >
          {renderInline(heading[2]!, `${keyPrefix}-h${block}`)}
        </div>,
      );
      i++;
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i]!)) {
        items.push(BULLET_RE.exec(lines[i]!)![1]!);
        i++;
      }
      out.push(
        <ul key={`${keyPrefix}-ul${block++}`} className="my-1.5 space-y-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="min-w-0">{renderInline(item, `${keyPrefix}-ul${block}-${j}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (NUMBERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && NUMBERED_RE.test(lines[i]!)) {
        items.push(NUMBERED_RE.exec(lines[i]!)![2]!);
        i++;
      }
      out.push(
        <ol key={`${keyPrefix}-ol${block++}`} className="my-1.5 space-y-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2">
              <span className="w-5 shrink-0 text-right font-mono text-[0.85em] text-accent-bright/80">{j + 1}.</span>
              <span className="min-w-0">{renderInline(item, `${keyPrefix}-ol${block}-${j}`)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // plain line — keep the trailing newline so the caller's
    // whitespace-pre-wrap preserves paragraph breaks between plain lines.
    out.push(
      <span key={`${keyPrefix}-l${block++}`}>
        {renderInline(line, `${keyPrefix}-l${block}`)}
        {i < lines.length - 1 ? '\n' : ''}
      </span>,
    );
    i++;
  }
  return out;
}

function codeBlock(key: string, content: string): ReactNode {
  // ```json\n… — the language tag after the fence is part of the captured
  // content; rendered verbatim it showed as a stray "json" first line.
  const body = content.replace(/^[a-zA-Z0-9+#-]{1,16}\n/, '').replace(/^\n/, '').replace(/\n$/, '');
  return (
    <pre
      key={key}
      className="my-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[12px] leading-snug text-white/80"
    >
      <code>{body}</code>
    </pre>
  );
}

function renderCompleteBlocks(text: string): ReactNode[] {
  return text.split(CODE_BLOCK_RE).map((part, i) =>
    i % 2 === 1 ? codeBlock(`b${i}`, part) : <span key={`t${i}`}>{renderRichText(part, `t${i}`)}</span>,
  );
}

/** Hand-rolled markdown-lite renderer: fenced ```code blocks```, `inline
 * code`, **bold**, *italic*, # headings, -/1. lists, and bare-URL links.
 * Builds React nodes directly (never `dangerouslySetInnerHTML`), so it's
 * XSS-safe by construction — plain text renders as text, nothing is ever
 * parsed as HTML. Newlines between plain lines are preserved via the
 * caller's `whitespace-pre-wrap`; list/heading lines consume their own
 * newline into the block structure.
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
