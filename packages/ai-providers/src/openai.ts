import { TaskType } from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';

/**
 * OpenAI adapter (text + TTS). Fallback / specific voices.
 * TODO(ai-layer): implement real SDK calls.
 */
export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly supports: TaskType[] = [
    TaskType.NARRATION_REWRITE,
    TaskType.METADATA,
    TaskType.IDEA_GENERATION,
    TaskType.BRIEF_GENERATION,
    TaskType.DRAMA_BIBLE,
    TaskType.DRAMA_EPISODE,
    TaskType.TTS,
  ];

  async generate(_req: AIRequest, _key: PooledKey): Promise<AIResult> {
    throw new Error('TODO(ai-layer): OpenAIProvider.generate not implemented yet');
  }

  classifyError(_e: unknown): AIErrorClass {
    return 'TRANSIENT';
  }
}
