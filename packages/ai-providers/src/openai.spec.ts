import { describe, expect, it, vi } from 'vitest';
import { TaskType } from '@scp/shared';
import { OpenAIProvider, synthesizeWithOpenAiTts } from './openai.js';

const WAV_HEADER = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WAVEfmt '),
  Buffer.alloc(32),
]);

describe('OpenAI TTS', () => {
  it('posts gpt-4o-mini-tts with emotion instructions', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        voice: string;
        instructions: string;
        response_format: string;
      };
      expect(body.model).toBe('gpt-4o-mini-tts');
      expect(body.voice).toBe('coral');
      expect(body.response_format).toBe('wav');
      expect(body.instructions.toLowerCase()).toContain('cheer');
      return new Response(WAV_HEADER, { status: 200, headers: { 'content-type': 'audio/wav' } });
    }) as unknown as typeof fetch;

    const result = await synthesizeWithOpenAiTts({
      apiKey: 'sk-test',
      text: 'Twinkle little star.',
      voice: 'coral',
      emotion: 'cheerful',
      kidsRhyme: true,
      fetchImpl,
    });
    expect(result.buffer.length).toBeGreaterThan(40);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('maps 401 to INVALID_KEY', async () => {
    const provider = new OpenAIProvider({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })) as typeof fetch,
    });
    await expect(
      provider.generate(
        {
          task: TaskType.TTS,
          model: 'gpt-4o-mini-tts',
          system: JSON.stringify({ voiceId: 'coral', emotion: 'playful' }),
          input: { kind: 'text', text: 'hello' },
        },
        { id: 'k1', providerId: 'openai', secret: 'sk-bad' },
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(provider.classifyError({ status: 401 })).toBe('INVALID_KEY');
  });
});
