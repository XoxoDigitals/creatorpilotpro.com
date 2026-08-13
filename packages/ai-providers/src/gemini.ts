import { TaskType } from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';
import {
  isGeminiModelUnavailable,
  resolveGeminiModelChain,
} from './gemini-models.js';

/**
 * Gemini adapter (docs/05 §3) — Google AI Studio v1beta REST via fetch. Kept
 * SDK-free so the package stays small and the request shape is auditable inline.
 *
 * Structured output: when `req.schema` is provided we ask Gemini for JSON via
 * `generationConfig.responseMimeType='application/json'`, then zod-parse; on the
 * first parse failure we send a single repair-retry with the error attached, per
 * docs/05 §2. Errors are classified from HTTP status → the router's error matrix.
 *
 * Model fallback: when the requested model 404s / is "no longer available", we
 * walk `resolveGeminiModelChain` (cheap Flash-Lite → mid Flash → legacy) so
 * idea gen and other Gemini tasks keep working for new API keys without a
 * Settings change. Specialty models (TTS/image) do not inherit the text chain.
 *
 * Video/multimodal: text inputs go straight in; a `fileRef` input is passed as a
 * `fileData` part (caller uploaded via the Files API earlier and shares the URI).
 * TTS goes through the same generate() with a dedicated model; the audio blob is
 * base64-decoded, written to a caller-supplied temp path, and its URI returned as
 * `audioRef` (the merge step in the worker knows how to consume that).
 */

const BASE_URL = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiConfig {
  baseUrl?: string;
  /** Injected in tests so parsing/error-classification can run without a network. */
  fetchImpl?: typeof fetch;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';
  readonly supports: TaskType[] = [
    TaskType.VIDEO_ANALYSIS,
    TaskType.NARRATION_REWRITE,
    TaskType.METADATA,
    TaskType.IDEA_GENERATION,
    TaskType.BRIEF_GENERATION,
    TaskType.DRAMA_BIBLE,
    TaskType.DRAMA_EPISODE,
    TaskType.TTS,
  ];

  constructor(private readonly config: GeminiConfig = {}) {}

  async generate(req: AIRequest, key: PooledKey): Promise<AIResult> {
    const models = resolveGeminiModelChain(req.model);
    let lastUnavailable: unknown;

    for (let i = 0; i < models.length; i++) {
      const model = models[i]!;
      try {
        const result = await this.generateWithModel(req, key, model);
        console.info(
          `[gemini] succeeded with model ${model}` +
            (model !== req.model ? ` (requested ${req.model})` : ''),
        );
        return result;
      } catch (err) {
        const hasNext = i < models.length - 1;
        if (hasNext && isGeminiModelUnavailable(err)) {
          console.info(
            `[gemini] model ${model} unavailable (${err instanceof Error ? err.message : String(err)}); trying ${models[i + 1]}`,
          );
          lastUnavailable = err;
          continue;
        }
        throw err;
      }
    }

    throw lastUnavailable instanceof Error
      ? lastUnavailable
      : new Error(`Gemini: all models unavailable (tried ${models.join(', ')})`);
  }

  /** One model attempt: optional JSON schema + single repair-retry. */
  private async generateWithModel(
    req: AIRequest,
    key: PooledKey,
    model: string,
  ): Promise<AIResult> {
    const parts: Array<Record<string, unknown>> = [];
    if (req.input.kind === 'text') {
      parts.push({ text: req.input.text });
    } else if (req.input.kind === 'fileRef') {
      parts.push({ fileData: { fileUri: req.input.uri, mimeType: req.input.mimeType } });
    } else {
      for (const p of req.input.parts) {
        if (p.text) parts.push({ text: p.text });
        if (p.uri && p.mimeType) parts.push({ fileData: { fileUri: p.uri, mimeType: p.mimeType } });
        // `inline_data` for small files (≤ ~20 MB); Gemini decodes the base64
        // directly, so no Files-API pre-upload round-trip is needed.
        if (p.data && p.mimeType) parts.push({ inlineData: { data: p.data, mimeType: p.mimeType } });
      }
    }

    const wantJson = Boolean(req.schema);
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      systemInstruction: { role: 'system', parts: [{ text: req.system }] },
      generationConfig: {
        ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
        ...(wantJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const first = await this.callOnce(model, body, key);
    if (!wantJson) return first;

    // Structured JSON: parse; on failure send one repair-retry with the error attached.
    try {
      const parsed = req.schema!.parse(JSON.parse(String(first.output)));
      return { ...first, output: parsed };
    } catch (parseErr) {
      const repairBody = {
        ...body,
        contents: [
          ...(body.contents as Array<unknown>),
          { role: 'model', parts: [{ text: String(first.output) }] },
          {
            role: 'user',
            parts: [{
              text:
                `The previous response failed schema validation: ${(parseErr as Error).message}. ` +
                'Return ONLY valid JSON matching the required schema — no prose, no markdown fence.',
            }],
          },
        ],
      };
      const second = await this.callOnce(model, repairBody, key);
      const parsed = req.schema!.parse(JSON.parse(String(second.output)));
      return { ...second, output: parsed };
    }
  }

  /** One HTTP round-trip; returns raw text output + usage. */
  private async callOnce(model: string, body: unknown, key: PooledKey): Promise<AIResult> {
    const url = `${this.config.baseUrl ?? BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key.secret },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => '');
      }
      throw Object.assign(
        new Error(`Gemini ${res.status}: ${describeError(errBody)}`),
        {
          status: res.status,
          body: errBody,
          headers: Object.fromEntries(res.headers.entries()),
        },
      );
    }
    const data = (await res.json()) as GenerateContentResponse;

    if (data.promptFeedback?.blockReason) {
      throw Object.assign(new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`), {
        status: 400,
        code: 'CONTENT_BLOCKED',
      });
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw Object.assign(new Error('Gemini returned no candidates'), { status: 500 });
    }

    // Prefer inlineData (TTS audio bytes) when present; else concatenate text parts.
    const audioPart = candidate.content?.parts?.find((p) => p.inlineData?.data);
    if (audioPart?.inlineData?.data) {
      return {
        output: '',
        audioRef: `data:${audioPart.inlineData.mimeType ?? 'audio/wav'};base64,${audioPart.inlineData.data}`,
        model,
        usage: {
          ...(data.usageMetadata?.promptTokenCount ? { tokensIn: data.usageMetadata.promptTokenCount } : {}),
          ...(data.usageMetadata?.candidatesTokenCount ? { tokensOut: data.usageMetadata.candidatesTokenCount } : {}),
        },
      };
    }

    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return {
      output: text,
      model,
      usage: {
        ...(data.usageMetadata?.promptTokenCount ? { tokensIn: data.usageMetadata.promptTokenCount } : {}),
        ...(data.usageMetadata?.candidatesTokenCount ? { tokensOut: data.usageMetadata.candidatesTokenCount } : {}),
      },
    };
  }

  classifyError(e: unknown): AIErrorClass {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.code === 'CONTENT_BLOCKED') return 'CONTENT_BLOCKED';
    const status = err.status;
    const msg = err.message ?? '';
    if (status === 400 && /API key|invalid|API_KEY_INVALID/i.test(msg)) return 'INVALID_KEY';
    if (status === 401 || status === 403) {
      if (/quota|resource_exhausted|exceeded/i.test(msg)) return 'QUOTA_EXHAUSTED';
      return 'INVALID_KEY';
    }
    if (status === 429) return 'RATE_LIMITED';
    // Model 404 / "no longer available" is handled inside generate() via the
    // text-model chain; if it still escapes, treat as FATAL (do not burn
    // transient retries on a dead model id).
    if (isGeminiModelUnavailable(err)) return 'FATAL';
    // 503 "high demand" is Google's rate-shed signal — treat as TRANSIENT so the
    // router retries with backoff instead of rotating away from Gemini entirely.
    if (status === 503) return 'TRANSIENT';
    if (status !== undefined && status >= 500) return 'TRANSIENT';
    if (/network|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) return 'TRANSIENT';
    return 'FATAL';
  }
}

function describeError(body: unknown): string {
  if (!body) return '(no body)';
  if (typeof body === 'string') return body.slice(0, 300);
  const e = body as { error?: { message?: string; status?: string } };
  return e.error?.message ?? JSON.stringify(body).slice(0, 300);
}
