import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  HttpStatusError,
  isRetryableStatus,
  isTransientFetchError,
  mockProvider,
  retryAfterMs,
  withRetry,
  type ModelCompletion,
  type ModelDelta,
  type ModelProvider,
  type RetryPolicy,
} from '@travelclaw/agent-core';
import type { ModelCatalogRecord, ModelRecord } from '@travelclaw/shared';
import { loadConfig } from '../config';
import {
  DESK_MODEL_ID,
  bestModelId,
  credentialsFor,
  isLegacyGeminiModel,
  modelCatalog,
  resolveProvider,
} from './model-catalog';
import {
  createOpenAiStreamParser,
  openAiRequestBody,
  parseOpenAiMessage,
  streamPayload,
} from './openai';
import { ModelCacheService } from './model-cache.service';
import { formatModelList, listProviderModels } from './model-list';

/** What the desk rendering says when the live model is unavailable. */
const DESK = { provider: 'mock', model: DESK_MODEL_ID } as const;

/** How long one attempt of a model call may run before the desk gives up on it. */
const MODEL_ATTEMPT_TIMEOUT_MS = 25_000;

/** The longest pause a model retry will take, and the longest wait it honors. */
const MODEL_RETRY_MAX_DELAY_MS = 1_200;

/**
 * The pace of a model call. A traveler is watching the answer being written, so
 * the budget is short enough to stay inside one turn and the pauses are short
 * enough to read as thinking rather than hanging. Three tries fit inside it
 * when the failures are fast (a rate limit, a 502); a slow upstream gets two,
 * because the deadline covers the attempts and the pauses alike.
 */
const MODEL_RETRY: Partial<RetryPolicy> = {
  attempts: 3,
  baseDelayMs: 400,
  maxDelayMs: MODEL_RETRY_MAX_DELAY_MS,
  deadlineMs: 45_000,
};

/**
 * Where a model call writes, and whether it has written anything yet. A retry
 * is allowed exactly while `forwarded` is false.
 */
interface StreamSink {
  forwarded: boolean;
  emit: (delta: ModelDelta) => void;
}

/**
 * A completion that arrived intact and said nothing. Worth another try — an
 * aggregator handing back an empty choice is usually a failed upstream — but
 * never at the cost of the budget, so the desk rendering is still the answer
 * when it keeps happening.
 */
class ModelEmptyError extends Error {
  constructor() {
    super('the model returned no text and no tool call');
    this.name = 'ModelEmptyError';
  }
}

/**
 * A stream that broke before it wrote a single word. Nothing has reached the
 * screen, so the call can be made again from the beginning.
 */
class ModelStreamError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ModelStreamError';
  }
}

/**
 * One attempt ran out of time. Its own class so a timeout is distinguishable
 * from Stop: the traveler's Stop is a decision and is never retried, while a
 * slow upstream is worth one more try inside the budget.
 */
class ModelAttemptTimeoutError extends Error {
  constructor(ms: number) {
    super(`no answer within ${ms}ms`);
    this.name = 'ModelAttemptTimeoutError';
  }
}

/**
 * One SSE frame can carry `event:` and `data:` lines; the payload is the last
 * `data:` line. Frames without one (keep-alives, comments) are ignored.
 */
function lastDataLine(frame: string): string {
  const lines = frame.split('\n').filter((line) => line.startsWith('data:'));
  return lines.at(-1) ?? '';
}

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);
  readonly cache = new ModelCacheService();
  /**
   * One model-list lookup per base URL and key. A 404 is a configuration fact, not a
   * per-turn one, so a broken deployment pays for a single probe.
   */
  private readonly modelListCache = new Map<string, string>();

  constructor() {
    // A deployment still naming a Gemini 1.x/2.x model turns every live turn into a desk
    // rendering once its key stops serving that model. Say so at boot, once, rather than
    // only in the warning a failed turn leaves behind.
    const config = loadConfig();
    for (const id of new Set([config.modelName, ...config.modelNames])) {
      if (isLegacyGeminiModel(id)) {
        this.logger.warn(
          `Model ${id} is a legacy Gemini id: a key created after the Gemini 3 rollout answers HTTP 404 for it ("no longer available to new users"). Prefer gemini-3.8-flash or gemini-3.1-pro-preview; GET /v1beta/openai/models lists what a key can run.`,
        );
      }
    }
  }

  /** Every model on offer, the pace on each, and which one a turn runs on by default. */
  catalog(): ModelCatalogRecord {
    return modelCatalog(loadConfig());
  }

  /** What the health report calls the desk's model. */
  current(): { provider: string; model: string } {
    const { models, current } = this.catalog();
    const model = models.find((entry) => entry.id === current) ?? models[0];
    return { provider: model.provider, model: model.id };
  }

  /**
   * The model a turn runs on: the best available one this deployment has. Nobody chooses,
   * so there is no id to resolve and nothing to substitute — guests and signed-in accounts
   * are answered by the same model, and only the pace on it differs.
   * Can optionally request a 'fast' model for basic tasks or 'strong' model for complex reasoning/tools.
   */
  best(tierPreference?: 'fast' | 'strong'): ModelRecord {
    const config = loadConfig();
    const currentId = bestModelId(config, tierPreference);
    const { models } = this.catalog();
    return models.find((entry) => entry.id === currentId) ?? models[0];
  }

  providerFor(model: ModelRecord): ModelProvider {
    const config = loadConfig();
    if (model.offline || model.provider === 'mock') {
      return mockProvider(DESK_MODEL_ID);
    }

    // The catalog says which provider a model runs on; resolve it again here so a record
    // built by hand (or by an older catalog) cannot send an id to the wrong endpoint.
    const provider = resolveProvider(config, model.id);
    const { baseUrl, apiKey } = credentialsFor(config, provider);

    if (apiKey) {
      return {
        id: provider,
        model: model.id,
        // The live model may ask for tools. The mock cannot, so it keeps the router.
        usesTools: true,
        // And it can write the answer as it goes, so the traveler reads it live.
        streams: true,
        complete: (input) =>
          this.completeOpenAi(
            input,
            { ...config, modelBaseUrl: baseUrl, modelApiKey: apiKey },
            model.id,
            provider,
          ),
      };
    }
    return mockProvider(DESK_MODEL_ID);
  }

  /**
   * One answer, with the retries a live upstream deserves.
   *
   * The rule that shapes this method: **a failure is only retried while nothing
   * has reached the screen.** Once the model has started writing, the words on
   * the traveler's side are the answer — a second try would put the same
   * sentence there twice, so a stream that breaks mid-sentence is kept as a
   * partial answer with a line saying it stopped, exactly as before. A failure
   * before the first word (a 503, a rate limit, a socket that never opened) is
   * nobody's answer yet, and is worth trying again.
   */
  private async completeOpenAi(
    input: Parameters<ModelProvider['complete']>[0],
    config: ReturnType<typeof loadConfig>,
    modelName: string,
    providerName = 'openai',
  ) {
    const streaming = Boolean(input.onDelta);
    // What has been handed to the screen, across every attempt of this call.
    const sink: StreamSink = {
      forwarded: false,
      emit: (delta) => {
        if (delta.text || delta.reasoning) sink.forwarded = true;
        input.onDelta?.(delta);
      },
    };

    const outcome = await withRetry<ModelCompletion>(
      async ({ attempt, remainingMs }) => {
        const controller = new AbortController();
        const timeoutMs = Math.max(
          1_000,
          Math.min(MODEL_ATTEMPT_TIMEOUT_MS, remainingMs || MODEL_ATTEMPT_TIMEOUT_MS),
        );
        const timer = setTimeout(
          () => controller.abort(new ModelAttemptTimeoutError(timeoutMs)),
          timeoutMs,
        );
        try {
          const response = await fetch(`${config.modelBaseUrl}/chat/completions`, {
            method: 'POST',
            signal: input.signal
              ? AbortSignal.any([input.signal, controller.signal])
              : controller.signal,
            headers: {
              Authorization: `Bearer ${config.modelApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(
              openAiRequestBody({
                model: modelName,
                system: input.system,
                history: input.history,
                user: input.user,
                tools: input.tools,
                stream: streaming,
              }),
            ),
          });
          if (!response.ok) {
            const hint =
              providerName === 'google' && response.status === 404
                ? ' Gemini could not find the configured endpoint or model; use the OpenAI-compatible `/v1beta/openai` base URL and a current model id such as `gemini-3.8-flash`.'
                : '';
            // Do not log an upstream response body: providers can echo request
            // details there. The provider/model/status is enough for an operator to
            // diagnose a bad base URL or retired model without exposing a key.
            this.logger.warn(
              `Model ${providerName}/${modelName} HTTP ${response.status} on attempt ${attempt + 1}.${hint}`,
            );
            if (response.status === 404) {
              this.logger.warn(
                await this.modelListNotice(
                  providerName,
                  config.modelBaseUrl,
                  config.modelApiKey,
                ),
              );
            }
            if (isRetryableStatus(response.status)) {
              // Discard the body nobody will read: an unconsumed one keeps the
              // connection it rode in on.
              await response.body?.cancel().catch(() => {});
              throw new HttpStatusError(response.status, retryAfterMs(response));
            }
            return { text: input.fallback, ...DESK };
          }
          if (streaming) {
            return await this.readOpenAiStream(
              input,
              response.body,
              modelName,
              providerName,
              sink,
            );
          }
          const { text, toolCalls } = parseOpenAiMessage(await response.json());
          if (!text && !toolCalls.length) throw new ModelEmptyError();
          return {
            text,
            provider: providerName,
            model: modelName,
            ...(toolCalls.length ? { toolCalls } : {}),
          };
        } finally {
          clearTimeout(timer);
        }
      },
      {
        ...MODEL_RETRY,
        signal: input.signal,
        shouldRetry: (error, attempt) => {
          // A call the model itself answered — with nothing, or with a stream
          // that broke — is asked once more and no more. Three empty
          // completions cost three times the tokens to learn the same thing,
          // and a stream that breaks the same way twice is not a coincidence.
          if (error instanceof ModelEmptyError || error instanceof ModelStreamError) {
            return attempt === 1;
          }
          if (error instanceof ModelAttemptTimeoutError) return true;
          if (error instanceof HttpStatusError) {
            // A vendor that asks for longer than this desk will ever wait has
            // answered. Retrying sooner would be ignoring what it said.
            return (
              error.retryAfterMs === null || error.retryAfterMs <= MODEL_RETRY_MAX_DELAY_MS
            );
          }
          return isTransientFetchError(error);
        },
        delayFor: (error) =>
          error instanceof HttpStatusError ? error.retryAfterMs : undefined,
        onRetry: (info) =>
          this.logger.warn(
            `Model ${providerName}/${modelName} attempt ${info.attempt} failed (${describeError(info.error)}); trying again in ${info.delayMs}ms.`,
          ),
      },
    );

    if (outcome.ok) return outcome.value;
    // A stopped turn is not a broken model. Hand the abort back to the turn loop
    // so a cancelled answer is neither replaced by desk rendering nor saved as
    // if the model had finished.
    if (outcome.aborted) throw outcome.error;
    this.logger.warn(
      `Model ${providerName}/${modelName} call failed after ${outcome.attempts} attempt${outcome.attempts === 1 ? '' : 's'}; using desk rendering (${describeError(outcome.error)}).`,
    );
    return { text: input.fallback, ...DESK };
  }

  /**
   * Read an OpenAI-compatible SSE completion. Text and reasoning are handed to
   * `onDelta` the moment they arrive; tool-call fragments are accumulated and
   * returned with the text so the turn loop can run what the model asked for.
   *
   * A stream that dies mid-answer is not silently completed by the desk
   * rendering: the traveler keeps the words that actually arrived, with a line
   * saying the answer was cut off, because a half answer plus an honest note is
   * worth more than a plausible-looking substitution. An upstream that names its
   * own failure in an `error` frame is treated the same way — it closes cleanly,
   * so only reading that frame distinguishes it from a model that finished.
   *
   * The other half is what makes a retry safe: a stream that breaks *before* it
   * wrote anything throws instead of answering. Nothing reached the screen, so
   * the call can be made again from the beginning, and the traveler never sees
   * the same sentence written twice.
   */
  private async readOpenAiStream(
    input: Parameters<ModelProvider['complete']>[0],
    body: ReadableStream<Uint8Array> | null,
    modelName: string,
    providerName: string,
    sink: StreamSink,
  ): Promise<ModelCompletion> {
    if (!body) throw new ModelStreamError('the model answered with no stream to read');
    const parser = createOpenAiStreamParser();
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let failure: string | null = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Frames are separated by a blank line; the last partial frame stays buffered.
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const delta = parser.push(streamPayload(lastDataLine(frame)));
          if (delta.error) failure = delta.error;
          if (delta.text) {
            text += delta.text;
            sink.emit({ text: delta.text });
          }
          if (delta.reasoning) {
            sink.emit({ reasoning: delta.reasoning });
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
      const delta = parser.push(streamPayload(lastDataLine(buffer)));
      if (delta.error) failure = delta.error;
      if (delta.text) {
        text += delta.text;
        sink.emit({ text: delta.text });
      }
      if (delta.reasoning) sink.emit({ reasoning: delta.reasoning });
      const toolCalls = parser.toolCalls();
      // An upstream that named its own failure after opening the stream. The
      // words that did arrive are kept — with a line saying the answer stopped
      // there — because a provider error mid-sentence is not a finished answer,
      // and quietly returning the stub would read as one.
      if (failure && text.trim()) {
        this.logger.warn(
          `Model ${providerName}/${modelName} stream failed upstream (${failure}); keeping the partial answer`,
        );
        sink.emit({ text: `\n\n(That answer was cut off — ${failure}.)` });
        return { text, provider: providerName, model: modelName };
      }
      if (failure) {
        // Named its failure before writing anything: the call can be made again.
        // Thinking that already reached the screen is not taken back, so that
        // case ends here with the desk rendering instead.
        if (!text.trim() && !sink.forwarded) throw new ModelStreamError(failure);
        this.logger.warn(
          `Model ${providerName}/${modelName} stream failed upstream (${failure}); using desk rendering.`,
        );
        return { text: input.fallback, ...DESK };
      }
      // Nothing at all came back — a provider that accepted `stream` and then
      // said nothing is the same failure as an empty completion, and is worth
      // another try.
      if (!text && !toolCalls.length && !sink.forwarded) throw new ModelEmptyError();
      return {
        text,
        provider: providerName,
        model: modelName,
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    } catch (error) {
      // Stop, or a tab that went away: the answer is being cancelled on purpose,
      // so the partial text is not dressed up as a finished reply.
      if (input.signal?.aborted) throw error;
      // Nothing reached the screen, so nothing has to be kept: let the call be
      // made again inside its budget rather than answering for the model.
      if (!sink.forwarded) {
        throw new ModelStreamError(
          error instanceof Error ? error.message : 'stream failed',
        );
      }
      if (text.trim()) {
        this.logger.warn(
          `Model ${providerName}/${modelName} stream interrupted; keeping the partial answer`,
        );
        sink.emit({
          text: '\n\n(That answer was cut off — the model connection dropped.)',
        });
        return { text, provider: providerName, model: modelName };
      }
      this.logger.warn(
        `Model stream failed; using desk rendering (${error instanceof Error ? error.message : 'error'})`,
      );
      return { text: input.fallback, ...DESK };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  /**
   * What a 404 cannot say. `GET /models` succeeds exactly when the base URL is right, and
   * names the ids when the model is the stale part — the difference between "retired model"
   * and "wrong endpoint" without logging a provider error body.
   */
  private async modelListNotice(
    provider: string,
    baseUrl: string,
    apiKey: string,
  ): Promise<string> {
    const cacheKey = `${baseUrl}\u0000${createHash('sha256').update(apiKey).digest('hex')}`;
    const cached = this.modelListCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const ids = await listProviderModels({ baseUrl, apiKey });
    const notice = ids
      ? `${provider} lists these models for this key: ${formatModelList(ids)}`
      : `${provider} model list unavailable; check the base URL and key.`;
    this.modelListCache.set(cacheKey, notice);
    return notice;
  }
}

/** A one-line reason for a log. Never a response body: providers echo requests. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' ? error : 'error';
}
