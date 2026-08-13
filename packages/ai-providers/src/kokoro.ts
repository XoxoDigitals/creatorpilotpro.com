import { TaskType } from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';

/**
 * Self-hosted TTS provider (docs/05 §6). Two synthesis modes, tried in order:
 *
 *  1. **HTTP mode** — when `KOKORO_URL` or `OPENTTS_URL` is set, speaks to that
 *     server's OpenAI-compatible `POST /v1/audio/speech` endpoint (Kokoro-FastAPI
 *     or OpenTTS both expose this shape).
 *  2. **In-process mode** — otherwise, runs the Kokoro-82M ONNX model directly
 *     via the `kokoro-js` package (no Docker, no external service). The model
 *     (~330 MB q8) is downloaded on first use to the HuggingFace transformers
 *     cache; subsequent calls are pure local inference on the CPU.
 *
 * The in-process mode is opt-out via `KOKORO_INPROC=0` for setups that want the
 * router to skip Kokoro entirely and go straight to Gemini TTS.
 */

// ── Lazy singleton for the in-process model (loaded on first use) ─────────────

interface KokoroInProcModel {
  generate(
    text: string,
    opts?: { voice?: string; speed?: number },
  ): Promise<{ audio: Float32Array; sampling_rate: number }>;
}

let modelPromise: Promise<KokoroInProcModel> | null = null;

async function getInProcModel(): Promise<KokoroInProcModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      // Import is dynamic so the (heavy) onnxruntime-node dep only loads when
      // in-process TTS is actually exercised — API-only deployments never pay
      // this cost.
      const { KokoroTTS } = (await import('kokoro-js')) as {
        KokoroTTS: {
          from_pretrained(
            id: string,
            opts?: { dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'; device?: 'wasm' | 'cpu' | null },
          ): Promise<KokoroInProcModel>;
        };
      };
      // q8 keeps the model at ~90 MB with negligible quality loss vs. fp32.
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
      });
    })().catch((err) => {
      // Reset so a later call can retry after the operator fixes network/disk.
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

/** Encode a Float32 PCM buffer to a 16-bit PCM WAV file (mono). */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataLength = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLength);
  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8);
  // fmt chunk (PCM)
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  return buf;
}

export class KokoroProvider implements AIProvider {
  readonly id = 'kokoro';
  readonly supports: TaskType[] = [TaskType.TTS];
  readonly requiresKey = false;

  private resolveBaseUrl(): string | null {
    const url = process.env.KOKORO_URL ?? process.env.OPENTTS_URL ?? null;
    return url ? url.replace(/\/$/, '') : null;
  }

  async generate(req: AIRequest, _key: PooledKey): Promise<AIResult> {
    if (req.input.kind !== 'text') {
      throw Object.assign(new Error('KokoroProvider only accepts text input'), { status: 400 });
    }

    // Parse voice config from the system prompt (see apps/worker/src/tts-process.ts).
    let voiceId = 'af_heart';
    let speed = 1.0;
    try {
      const cfg = JSON.parse(req.system) as { voiceId?: string; speed?: number };
      if (typeof cfg.voiceId === 'string' && cfg.voiceId !== 'default') voiceId = cfg.voiceId;
      if (typeof cfg.speed === 'number') speed = cfg.speed;
    } catch {
      // Non-JSON system prompt → keep defaults.
    }

    const baseUrl = this.resolveBaseUrl();

    // ── In-process mode ────────────────────────────────────────────────────
    if (!baseUrl && process.env.KOKORO_INPROC !== '0') {
      try {
        const model = await getInProcModel();
        const audio = await model.generate(req.input.text, { voice: voiceId, speed });
        const wav = encodeWav(audio.audio, audio.sampling_rate);
        return {
          output: '',
          audioRef: `data:audio/wav;base64,${wav.toString('base64')}`,
          model: req.model || 'kokoro',
          usage: { ttsSeconds: audio.audio.length / audio.sampling_rate },
        };
      } catch (err) {
        // Wrap so classifyError can send this down the TRANSIENT path — router
        // will retry then rotate to Gemini rather than hard-failing the item.
        throw Object.assign(
          new Error(
            `Kokoro in-process synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
          { code: 'KOKORO_INPROC_FAILED', cause: err },
        );
      }
    }

    if (!baseUrl) {
      throw Object.assign(
        new Error('Kokoro/OpenTTS not configured — set KOKORO_URL/OPENTTS_URL or unset KOKORO_INPROC to enable in-process TTS'),
        { code: 'KOKORO_NOT_CONFIGURED', status: 401 },
      );
    }

    // HTTP mode — voiceId/speed already parsed above.
    const url = `${baseUrl}/v1/audio/speech`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model || 'kokoro',
        input: req.input.text,
        voice: voiceId,
        speed,
        response_format: 'wav',
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw Object.assign(new Error(`Kokoro ${res.status}: ${errBody.slice(0, 300)}`), {
        status: res.status,
      });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      output: '',
      audioRef: `data:audio/wav;base64,${buf.toString('base64')}`,
      model: req.model || 'kokoro',
      usage: { ttsSeconds: 0 },
    };
  }

  classifyError(e: unknown): AIErrorClass {
    const err = e as { status?: number; code?: string; message?: string };
    // No server configured → treat as INVALID_KEY so the router rotates providers
    // instead of retrying the same non-existent endpoint.
    if (err.code === 'KOKORO_NOT_CONFIGURED') return 'INVALID_KEY';
    // In-proc failure (model download blocked, ONNX runtime missing) → rotate.
    if (err.code === 'KOKORO_INPROC_FAILED') return 'TRANSIENT';
    if (err.status === 429) return 'RATE_LIMITED';
    if (err.status === 401 || err.status === 403) return 'INVALID_KEY';
    if (err.status !== undefined && err.status >= 500) return 'TRANSIENT';
    if (/network|ETIMEDOUT|ECONNRESET|fetch failed|ECONNREFUSED/i.test(err.message ?? ''))
      return 'TRANSIENT';
    return 'FATAL';
  }
}
