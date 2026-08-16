import { useEffect, useMemo, useState } from 'react';
import { renderMarkdownLite } from './MarkdownLite';

const MS_PER_WORD = 30; // ~25-35ms/word — fast enough to feel live, slow enough to read

/** Reveals `text` word-by-word to fake a client-side "streaming" feel — the
 * worker actually sends the whole answer in one `answer` event; this is
 * purely presentational (SPEC.md never changes). `instant` (reduced motion,
 * restored turns) skips straight to the full text with no caret. */
export default function TypewriterText({ text, instant = false }: { text: string; instant?: boolean }) {
  // Tokenize into alternating word/whitespace runs so newlines and spacing
  // reveal exactly as typed, not just the words.
  const tokens = useMemo(() => text.match(/\S+|\s+/g) ?? [], [text]);
  const wordTokenIndices = useMemo(
    () => tokens.reduce<number[]>((acc, tok, i) => (/\S/.test(tok) ? [...acc, i] : acc), []),
    [tokens],
  );
  const [revealedWords, setRevealedWords] = useState(instant ? wordTokenIndices.length : 0);

  useEffect(() => {
    if (instant) {
      setRevealedWords(wordTokenIndices.length);
      return;
    }
    setRevealedWords(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setRevealedWords(i);
      if (i >= wordTokenIndices.length) window.clearInterval(id);
    }, MS_PER_WORD);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, instant]);

  const done = revealedWords >= wordTokenIndices.length;
  const shownText = revealedWords <= 0 ? '' : tokens.slice(0, wordTokenIndices[revealedWords - 1] + 1).join('');

  return (
    <>
      {renderMarkdownLite(shownText)}
      {!instant && !done && (
        <span
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle"
          aria-hidden
        />
      )}
    </>
  );
}
