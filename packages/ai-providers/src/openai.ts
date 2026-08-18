import { readFile } from 'node:fs/promises';
import {
  formatOpenAiTtsInstructions,
  OPENAI_TTS_MODEL,
  parseTtsEmotion,
  resolveOpenAiTtsVoice,
  TaskType,
  type TtsEmotion,
} from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';

const BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';

interface OpenAiConfig {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function parseVoiceCfg(system: string): {
  voiceId: string;
  emotion: TtsEmotion;
  kidsRhyme: boolean;
  language?: string;
} {
  try {
    const cfg = JSON.parse(system) as {
      voiceId?: string;
      emotion?: string;
      kidsRhyme?: boolean;
      language?: string;
    };
    return {
      voiceId: resolveOpenAiTtsVoice(cfg.voiceId),
      emotion: parseTtsEmotion(cfg.emotion),
      kidsRhyme: cfg.kidsRhyme === true,
      ...(typeof cfg.language === 'string' && cfg.language.trim()
        ? { language: cfg.language.trim() }
        : {}),
    };
  } catch {
    return { voiceId: resolveOpenAiTtsVoice(null), emotion: 'default', kidsRhyme: false };
  }
}

function classifyHttp(status: number): AIErrorClass {
  if (status === 401 || status === 403) return 'INVALID_KEY';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 402) return 'QUOTA_EXHAUSTED';
  if (status === 400) return 'FATAL';
  return 'TRANSIENT';
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message || `OpenAI ${res.status}`;
  } catch {
    return `OpenAI ${res.status}`;
  }
}

export async function synthesizeWithOpenAiTts(opts: {
  apiKey: string;
  text: string;
  voice?: string | null;
  emotion?: TtsEmotion;
  kidsRhyme?: boolean;
  language?: string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ buffer: Buffer; mimeType: string; model: string }> {
  const text = opts.text.trim();
  if (!text) throw Object.assign(new Error('Empty text for OpenAI TTS'), { status: 400 });
  const url = `${(opts.baseUrl ?? BASE_URL).replace(/\/$/, '')}/audio/speech`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: resolveOpenAiTtsVoice(opts.voice),
      input: text.slice(0, 4096),
      instructions: formatOpenAiTtsInstructions(opts.emotion ?? 'default', {
        kidsRhyme: opts.kidsRhyme === true,
        language: opts.language,
      }),
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw Object.assign(new Error(message), { status: res.status, code: classifyHttp(res.status) });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 44) {
    throw Object.assign(new Error('OpenAI TTS returned empty audio'), { status: 502 });
  }
  return { buffer: buf, mimeType: 'audio/wav', model: OPENAI_TTS_MODEL };
}

export interface OpenAiTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export async function transcribeWithOpenAi(opts: {
  apiKey: string;
  filePath: string;
  filename?: string;
  mimeType?: string;
  language?: string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; segments: OpenAiTranscriptSegment[]; model: string }> {
  const bytes = await readFile(opts.filePath);
  const mime = opts.mimeType || 'audio/wav';
  const filename = opts.filename || 'voiceover.wav';
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (opts.language?.trim()) form.append('language', opts.language.trim());

  const url = `${(opts.baseUrl ?? BASE_URL).replace(/\/$/, '')}/audio/transcriptions`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw Object.assign(new Error(message), { status: res.status, code: classifyHttp(res.status) });
  }
  const data = (await res.json()) as {
    text?: string;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };
  const segments = (data.segments ?? [])
    .map((row) => ({
      startMs: Math.max(0, Math.round((row.start ?? 0) * 1000)),
      endMs: Math.max(0, Math.round((row.end ?? 0) * 1000)),
      text: (row.text ?? '').trim(),
    }))
    .filter((row) => row.text && row.endMs > row.startMs);
  const text = (data.text ?? segments.map((s) => s.text).join(' ')).trim();
  return { text, segments, model: 'whisper-1' };
}

/**
 * OpenAI adapter: gpt-4o-mini-tts (with emotion instructions) and Whisper transcription.
 * Text tasks remain unimplemented — Gemini is the writing engine.
 */
export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly supports: TaskType[] = [TaskType.TTS, TaskType.TRANSCRIBE];

  constructor(private readonly config: OpenAiConfig = {}) {}

  async generate(req: AIRequest, key: PooledKey): Promise<AIResult> {
    if (req.task === TaskType.TTS) {
      if (req.input.kind !== 'text') {
        throw Object.assign(new Error('OpenAI TTS only accepts text input'), { status: 400 });
      }
      const cfg = parseVoiceCfg(req.system);
      const synth = await synthesizeWithOpenAiTts({
        apiKey: key.secret,
        text: req.input.text,
        voice: cfg.voiceId,
        emotion: cfg.emotion,
        kidsRhyme: cfg.kidsRhyme,
        language: cfg.language,
        baseUrl: this.config.baseUrl ?? BASE_URL,
        fetchImpl: this.config.fetchImpl,
      });
      return {
        output: '',
        audioRef: `data:${synth.mimeType};base64,${synth.buffer.toString('base64')}`,
        usage: {},
        model: synth.model,
      };
    }

    if (req.task === TaskType.TRANSCRIBE) {
      const filePath =
        req.input.kind === 'fileRef'
          ? req.input.uri
          : req.input.kind === 'multimodal'
            ? req.input.parts.find((p) => p.uri)?.uri
            : undefined;
      if (!filePath) {
        throw Object.assign(new Error('OpenAI transcribe needs a local audio file path'), {
          status: 400,
        });
      }
      const mime =
        req.input.kind === 'fileRef'
          ? req.input.mimeType
          : req.input.kind === 'multimodal'
            ? req.input.parts.find((p) => p.uri)?.mimeType
            : undefined;
      const result = await transcribeWithOpenAi({
        apiKey: key.secret,
        filePath,
        mimeType: mime,
        baseUrl: this.config.baseUrl ?? BASE_URL,
        fetchImpl: this.config.fetchImpl,
      });
      return {
        output: { text: result.text, segments: result.segments },
        timings: result.segments.map((s) => ({
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
        })),
        usage: {},
        model: result.model,
      };
    }

    throw new Error(`OpenAIProvider does not implement ${req.task}`);
  }

  classifyError(e: unknown): AIErrorClass {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code?: unknown }).code;
      if (
        code === 'INVALID_KEY' ||
        code === 'RATE_LIMITED' ||
        code === 'QUOTA_EXHAUSTED' ||
        code === 'FATAL' ||
        code === 'TRANSIENT'
      ) {
        return code;
      }
    }
    const status = e && typeof e === 'object' ? (e as { status?: number }).status : undefined;
    if (typeof status === 'number') return classifyHttp(status);
    return 'TRANSIENT';
  }
}
