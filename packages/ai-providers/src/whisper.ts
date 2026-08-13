import { TaskType } from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';

/**
 * faster-whisper self-hosted transcription (fallback after YouTube captions).
 * TODO(ai-layer): call local whisper service; return transcript text.
 */
export class WhisperProvider implements AIProvider {
  readonly id = 'whisper';
  readonly supports: TaskType[] = [TaskType.TRANSCRIBE];
  readonly requiresKey = false;

  async generate(_req: AIRequest, _key: PooledKey): Promise<AIResult> {
    throw new Error('TODO(ai-layer): WhisperProvider.generate not implemented yet');
  }

  classifyError(_e: unknown): AIErrorClass {
    return 'TRANSIENT';
  }
}
