import type { WorkerTask } from '@scp/db';

/** Public view of a worker task. */
export interface WorkerTaskView {
  id: string;
  briefId: string | null;
  episodeId: string | null;
  ideaId: string | null;
  workerId: string;
  workerName: string;
  accountId: string;
  title: string;
  status: WorkerTask['status'];
  assignedAt: string;
  uploadedAt: string | null;
  contentItemId: string | null;
  revisionNotes: string[];
  createdAt: string;
}

/** Aggregate productivity stats for a worker. */
export interface WorkerStatsView {
  totalAssigned: number;
  totalCompleted: number;
  averageTurnaroundHours: number | null;
  revisionRate: number;
}

export function toWorkerTaskView(
  t: WorkerTask & { worker: { name: string | null } },
): WorkerTaskView {
  return {
    id: t.id,
    briefId: t.briefId,
    episodeId: t.episodeId,
    ideaId: t.ideaId,
    workerId: t.workerId,
    workerName: t.worker.name ?? 'Unknown',
    accountId: t.accountId,
    title: t.title,
    status: t.status,
    assignedAt: t.assignedAt.toISOString(),
    uploadedAt: t.uploadedAt?.toISOString() ?? null,
    contentItemId: t.contentItemId,
    revisionNotes: t.revisionNotes,
    createdAt: t.createdAt.toISOString(),
  };
}
