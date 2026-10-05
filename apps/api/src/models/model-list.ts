/**
 * Operator-facing model discovery for OpenAI-compatible providers.
 *
 * A `404` from chat completions cannot say whether the base URL or the model id is wrong,
 * and provider error bodies are never logged — they can echo request content. The documented
 * `GET {baseUrl}/models` list answers both questions, and it carries ids only. Nothing here
 * ever returns a credential or a provider message.
 */

/** Longest list a log line carries; the rest is counted, not printed. */
const MAX_LOGGED_MODELS = 12;

/** Ids that cannot answer a chat completion, so an operator is not pointed at one. */
const NON_CHAT_MODEL =
  /(?:^|[-.])(tts|image|images|live|audio|transcribe|embedding|embeddings|veo|lyria|imagen|robotics|omni)(?:$|[-.])/;

/** Same head every OpenAI-compatible provider serves; `null` means the list is unavailable. */
export async function listProviderModels(options: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<string[] | null> {
  const { baseUrl, apiKey, timeoutMs = 5_000, fetchImpl = fetch } = options;
  if (!apiKey) return null;

  let url: string;
  try {
    const parsed = new URL(`${baseUrl.replace(/\/+$/, '')}/models`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    url = parsed.toString();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body?.data ?? []).flatMap((entry) =>
      typeof entry?.id === 'string' && entry.id.trim() ? [entry.id.trim()] : [],
    );
    return ids.length ? ids : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ids are provider-controlled text: one line, bounded, before any of them reaches a log. */
function safeModelId(id: string): string {
  return id.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);
}

/**
 * One log-ready line. Chat-capable ids come first so an operator replacing a retired model
 * does not copy an image or speech model out of the full list; when every id looks non-chat
 * the unfiltered list is better than silence.
 */
export function formatModelList(ids: string[], max = MAX_LOGGED_MODELS): string {
  const clean = [...new Set(ids.map(safeModelId).filter(Boolean))];
  const chat = clean.filter((id) => !NON_CHAT_MODEL.test(id));
  const usable = (chat.length ? chat : clean).sort();
  const shown = usable.slice(0, Math.max(1, max));
  const hidden = usable.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')} (+${hidden} more)` : shown.join(', ');
}
