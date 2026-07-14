import { TaskType } from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';

/**
 * Gemini adapter (AI Studio API — Files API for video upload + TTS models).
 * TODO(task#7+/AI layer): implement real @google/genai calls, structured JSON
 * output with one repair-retry, and Retry-After aware error classification.
 */
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

  async generate(_req: AIRequest, _key: PooledKey): Promise<AIResult> {
    throw new Error('TODO(ai-layer): GeminiProvider.generate not implemented yet');
  }

  classifyError(_e: unknown): AIErrorClass {
    // TODO(ai-layer): map 429/Retry-After, 403 quota, 400 invalid key, safety blocks.
    return 'TRANSIENT';
  }
}
