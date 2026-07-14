import { TaskType } from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';

/**
 * Kokoro-82M self-hosted TTS micro-service (default TTS provider, $0, docs/05 §6).
 * TODO(ai-layer): POST script chunks to KOKORO_URL, concat WAVs, EBU R128 normalize.
 */
export class KokoroProvider implements AIProvider {
  readonly id = 'kokoro';
  readonly supports: TaskType[] = [TaskType.TTS];

  async generate(_req: AIRequest, _key: PooledKey): Promise<AIResult> {
    throw new Error('TODO(ai-layer): KokoroProvider.generate not implemented yet');
  }

  classifyError(_e: unknown): AIErrorClass {
    return 'TRANSIENT';
  }
}
