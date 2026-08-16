// User-supplied model providers ("bring your own key"): Anthropic, OpenAI,
// or any OpenAI-compatible endpoint. Returns the same result shape as
// featherless.ts so pipeline/execute.ts can consume either uniformly.
//
// Every failure is wrapped in UserProviderError with a bounded, key-free
// message — a user's broken endpoint must degrade to "this rung failed",
// never crash the run or leak the key into a trace/log.
import type { FeatherlessMessage, FeatherlessResult } from './featherless';

export type UserProviderKind = 'anthropic' | 'openai' | 'custom';

export interface UserProvider {
  id: string;
  userId: string;
  kind: UserProviderKind;
  /** Required for kind 'custom' (OpenAI-compatible base, e.g. https://host/v1); null otherwise. */
  baseUrl: string | null;
  model: string;
  apiKey: string;
  enabled: boolean;
  createdAt: number;
}

export class UserProviderError extends Error {
  readonly code = 'user_provider' as const;
}

// Stricter than Featherless' 120s: this rung runs AFTER the built-in ladder
// already failed, so a hung user endpoint must not stall the answer forever.
const CLIENT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_CHARS = 300;

export interface UserProviderRequest {
  messages: FeatherlessMessage[];
  maxTokens: number;
}

export async function callUserProvider(
  provider: UserProvider,
  req: UserProviderRequest
): Promise<FeatherlessResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const parsed =
      provider.kind === 'anthropic'
        ? await callAnthropic(provider, req, controller.signal)
        : await callOpenAiCompatible(provider, req, controller.signal);
    return { ...parsed, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof UserProviderError) throw err;
    // AbortError, DNS failure, TLS error, malformed JSON — all user-endpoint
    // problems, none of them ours to crash on.
    const reason = err instanceof Error ? err.message.slice(0, MAX_ERROR_BODY_CHARS) : String(err);
    throw new UserProviderError(`${provider.kind} call failed: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function raiseForStatus(kind: UserProviderKind, res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new UserProviderError(`${kind} ${res.status}: ${body.slice(0, MAX_ERROR_BODY_CHARS)}`);
}

// Anthropic's Messages API takes system text as a top-level field, not a
// message role — system turns are lifted out and the rest passed as turns.
async function callAnthropic(
  provider: UserProvider,
  req: UserProviderRequest,
  signal: AbortSignal
): Promise<Omit<FeatherlessResult, 'latencyMs'>> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      ...(system ? { system } : {}),
      messages: turns,
      max_tokens: req.maxTokens, // required by the Messages API
    }),
    signal,
  });
  await raiseForStatus('anthropic', res);
  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    content: (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
    promptTokens: body.usage?.input_tokens ?? 0,
    completionTokens: body.usage?.output_tokens ?? 0,
  };
}

async function callOpenAiCompatible(
  provider: UserProvider,
  req: UserProviderRequest,
  signal: AbortSignal
): Promise<Omit<FeatherlessResult, 'latencyMs'>> {
  const base =
    provider.kind === 'openai'
      ? 'https://api.openai.com/v1'
      : (provider.baseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new UserProviderError('custom provider has no base_url');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.model, messages: req.messages, max_tokens: req.maxTokens }),
    signal,
  });
  await raiseForStatus(provider.kind, res);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: body.choices?.[0]?.message?.content ?? '',
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
  };
}
