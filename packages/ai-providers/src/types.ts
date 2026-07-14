import type { ZodType } from 'zod';
import type { TaskType } from '@scp/shared';

/** A key drawn from the rotation pool (docs/05 §4). Redacted in logs. */
export interface PooledKey {
  id: string;
  providerId: string;
  /** Decrypted only in worker/api memory (docs/03 cross-cutting). */
  secret: string;
  label?: string;
}

/** Input to a provider call: plain text, a file reference, or multimodal parts. */
export type AIInput =
  | { kind: 'text'; text: string }
  | { kind: 'fileRef'; uri: string; mimeType: string }
  | { kind: 'multimodal'; parts: Array<{ text?: string; uri?: string; mimeType?: string }> };

export interface AIUsage {
  tokensIn?: number;
  tokensOut?: number;
  ttsSeconds?: number;
}

export interface AIResult<T = unknown> {
  output: T;
  /** For TTS tasks, path/uri to the produced audio asset. */
  audioRef?: string;
  usage: AIUsage;
  model: string;
  cached?: boolean;
}

export interface AIRequest {
  task: TaskType;
  model: string;
  system: string;
  input: AIInput;
  schema?: ZodType;
  maxTokens?: number;
}

export type AIErrorClass =
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'INVALID_KEY'
  | 'CONTENT_BLOCKED'
  | 'TRANSIENT'
  | 'FATAL';

/**
 * Provider adapter interface (docs/05 §3).
 * Adding a provider = one implementation, zero feature-code changes.
 */
export interface AIProvider {
  id: string;
  supports: TaskType[];
  generate(req: AIRequest, key: PooledKey): Promise<AIResult>;
  classifyError(e: unknown): AIErrorClass;
}
