import { Badge, type BadgeTone } from './badge';
import type {
  IncidentSeverity,
  IncidentStatus,
  PostStatus,
  ReviewStatus,
  SourceStatus,
  TaskStatus,
} from '@/lib/domain-types';

const POST: Record<PostStatus, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  IN_REVIEW: { tone: 'amber', label: 'In review' },
  SCHEDULED: { tone: 'indigo', label: 'Scheduled' },
  PUBLISHED: { tone: 'green', label: 'Published' },
  FAILED: { tone: 'red', label: 'Failed' },
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  const { tone, label } = POST[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const REVIEW: Record<ReviewStatus, { tone: BadgeTone; label: string }> = {
  PENDING: { tone: 'amber', label: 'Pending' },
  APPROVED: { tone: 'green', label: 'Approved' },
  REJECTED: { tone: 'red', label: 'Rejected' },
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const { tone, label } = REVIEW[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const SOURCE: Record<SourceStatus, { tone: BadgeTone; label: string }> = {
  ACTIVE: { tone: 'green', label: 'Active' },
  ERROR: { tone: 'red', label: 'Error' },
  PAUSED: { tone: 'neutral', label: 'Paused' },
};

export function SourceStatusBadge({ status }: { status: SourceStatus }) {
  const { tone, label } = SOURCE[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const SEVERITY: Record<IncidentSeverity, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'amber',
  HIGH: 'red',
};

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return <Badge tone={SEVERITY[severity]}>{severity[0] + severity.slice(1).toLowerCase()}</Badge>;
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  if (status === 'OPEN') return <Badge tone="red">Open</Badge>;
  if (status === 'ACKED') return <Badge tone="amber">Retrying</Badge>;
  return <Badge tone="green">Resolved</Badge>;
}

const TASK: Record<TaskStatus, { tone: BadgeTone; label: string }> = {
  ASSIGNED: { tone: 'neutral', label: 'Assigned' },
  IN_PROGRESS: { tone: 'indigo', label: 'In progress' },
  UPLOADED: { tone: 'amber', label: 'Uploaded' },
  REVISION_REQUESTED: { tone: 'red', label: 'Revision' },
  DONE: { tone: 'green', label: 'Done' },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { tone, label } = TASK[status];
  return <Badge tone={tone}>{label}</Badge>;
}
