/**
 * pg-boss queue names — the 9 pipelines from docs/02 §5 (Postgres-backed, no Redis).
 * Single source of truth shared by apps/api (producers) and apps/worker (consumers).
 */
export const QUEUE = {
  WATCHER: 'watcher',
  DOWNLOAD: 'download',
  MEDIA: 'media',
  AI: 'ai',
  TTS: 'tts',
  PUBLISH: 'publish',
  ANALYTICS: 'analytics',
  STORAGE: 'storage',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUE);

/** Default concurrency per queue (docs/02 §5). `cpu` = resolve at runtime to cores-2. */
export const QUEUE_CONCURRENCY: Record<QueueName, number | 'cpu'> = {
  watcher: 2,
  download: 2,
  media: 'cpu',
  ai: 4,
  tts: 2,
  publish: 3,
  analytics: 2,
  storage: 2,
  maintenance: 1,
};
