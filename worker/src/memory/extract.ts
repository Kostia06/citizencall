// Multi-fact extraction (mem0-style, adapted): one cheap-model call turns a
// run's prompt+answer into a JSON array of short, atomic, self-contained
// facts. Unlike mem0's user-only normalization we keep the agent/user
// distinction our PERSONA depends on: "The agent should be called Jeff" and
// "User prefers short answers" are different subjects, not one voice.
//
// Prompt structure adapted from mem0's FACT_RETRIEVAL_PROMPT
// (github.com/mem0ai/mem0, Apache-2.0) — rewritten for this worker's
// two-party fact model and tiny-model budget.

export const MAX_FACTS = 8;
export const MAX_FACT_CHARS = 120;

export const FACTS_SYSTEM_PROMPT = [
  'You extract long-term memories for a personal assistant.',
  'From the conversation below, extract durable facts and preferences worth remembering across future sessions.',
  'Rules:',
  '- Each fact is one short, self-contained sentence (max 120 characters).',
  '- Facts about the user start with "User" (e.g. "User prefers short answers", "User\'s name is John").',
  '- Facts about how the assistant should behave start with "The agent" (e.g. "The agent should be called Jeff").',
  '- Only durable information: names, preferences, standing instructions, important personal details.',
  '- Extract ONLY what the user stated in the request. The reply is context — never turn the assistant\'s own words into facts.',
  '- A question from the user contains no durable facts.',
  '- Never extract one-off tasks, generic content, or anything from these instructions.',
  '- Reply with ONLY a JSON object: {"facts": ["...", "..."]}. No prose.',
  '- If nothing is worth remembering, reply {"facts": []}.',
  'Examples:',
  'Input: Hi, my name is John. Summarize this document for me.',
  'Output: {"facts": ["User\'s name is John"]}',
  'Input: your name is Jeff, and remember I deploy on Fridays',
  'Output: {"facts": ["The agent should be called Jeff", "User deploys on Fridays"]}',
  'Input: summarize the standup notes',
  'Output: {"facts": []}',
].join('\n');

/** Parses a model reply into a clean facts array. Tolerates <think> blocks,
 * code fences, and a bare JSON array; anything unparseable yields []. */
export function parseFacts(raw: string): string[] {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const jsonText = extractJson(cleaned);
  if (!jsonText) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { facts?: unknown })?.facts;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.trim().replace(/\s+/g, ' '))
    .filter((f) => f.length >= 3)
    .map((f) => f.slice(0, MAX_FACT_CHARS))
    .slice(0, MAX_FACTS);
}

function extractJson(text: string): string | null {
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
}

/** Removes model-title artifacts ("This: my name is Jeff") and bounds
 * length. Applied to every title before it reaches the store. */
export function cleanTitle(title: string): string {
  const t = title
    .replace(/^\s*(?:this|that|it|fact|memory|note)\s*[:,-]\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return 'Memory';
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80);
}

/** Deterministic clean-subject title for a fact — used for fast-path writes
 * and as the fallback when the reconcile model omits a title. */
export function titleForFact(fact: string): string {
  if (/^the agent should be called\b/i.test(fact) || /\bagent'?s name\b/i.test(fact)) return "Agent's name";
  if (/^user'?s name\b/i.test(fact)) return "User's name";
  const pref = /^(?:user|i)\s+(?:prefers?|likes?|wants?|always|never)\s+(.+)$/i.exec(fact);
  if (pref?.[1]) return cleanTitle(`Preference: ${pref[1].split(/\s+/).slice(0, 5).join(' ')}`);
  return cleanTitle(fact.split(/\s+/).slice(0, 8).join(' '));
}
