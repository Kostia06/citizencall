// Multi-turn conversation threading. Runs used to be fully stateless; the
// client now sends its prior turns with POST /api/run (vercel/ai-chatbot
// pattern: load prior messages → model) and this module turns them into a
// budgeted CONVERSATION block (LibreChat BaseClient-style walk). Kept out of
// run.ts so the pipeline diff stays a handful of insertions.
import { z } from 'zod';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const MAX_HISTORY_TURNS = 12;
export const MAX_TURN_CHARS = 2000;
/** ~1500 chars ≈ a few hundred tokens — enough for several short turns
 * without letting a chatty session crowd out the actual task. */
export const CONVERSATION_CHAR_BUDGET = 1500;

// Boundary schema for POST /api/run's optional `history`. Truncates instead
// of rejecting — an over-eager client still gets a run: keep the 12 NEWEST
// turns, cap each text at 2000 chars.
export const historySchema = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string().transform((t) => t.slice(0, MAX_TURN_CHARS)),
    })
  )
  .transform((turns) => turns.slice(-MAX_HISTORY_TURNS));

/** LibreChat-style budget walk (BaseClient#getMessagesWithinTokenLimit,
 * chars for tokens): newest → oldest, adding WHOLE turns until the budget is
 * spent, then drop the rest — never truncate mid-turn. The newest non-empty
 * turn is always included even if it alone overshoots the budget: one long
 * assistant answer must not silently delete the entire conversation. */
export function buildConversationBlock(
  history: ConversationTurn[] | undefined,
  budget: number = CONVERSATION_CHAR_BUDGET
): string {
  if (!history || history.length === 0) return '';
  const lines: string[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const text = history[i]!.text.trim();
    if (!text) continue;
    const line = `${history[i]!.role === 'user' ? 'User' : 'Assistant'}: ${text.slice(0, MAX_TURN_CHARS)}`;
    if (lines.length > 0 && used + line.length > budget) break;
    lines.push(line);
    used += line.length + 1; // +1 — the joining newline
  }
  if (lines.length === 0) return '';
  lines.reverse();
  return `Conversation so far (earlier turns of this session, oldest first):\n${lines.join('\n')}`;
}

/** One-line planner disambiguator: the most recent user turn, whitespace-
 * collapsed and capped. Lets "and what about yesterday?" plan sensibly
 * without threading the whole transcript into decompose. */
export function lastUserTurnHint(history: ConversationTurn[] | undefined): string {
  if (!history) return '';
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (turn.role === 'user' && turn.text.trim()) {
      return turn.text.trim().replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  return '';
}
