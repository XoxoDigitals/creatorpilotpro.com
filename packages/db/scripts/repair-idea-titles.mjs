/**
 * One-time repair for Idea rows created before the AI-output fence fix, whose
 * `title` holds the model's raw (usually ```json-fenced, often truncated) reply.
 *
 * Safe: only touches rows whose title still looks like JSON, only fills fields
 * that are currently empty, and never deletes. Pass `--apply` to write; the
 * default is a dry run.
 *
 *   node --env-file=.env packages/db/scripts/repair-idea-titles.mjs [--apply]
 */
import { PrismaClient } from '@scp/db';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

function stripFence(raw) {
  const trimmed = (raw ?? '').trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*\r?\n([\s\S]*?)(?:\r?\n?```)?\s*$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

function scanString(body, field) {
  const match = body.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return match ? match[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim() : '';
}

function scanNumber(body, field) {
  const match = body.match(new RegExp(`"${field}"\\s*:\\s*(\\d+)`));
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
}

/** Recover as many fields as the (possibly truncated) blob still contains. */
function recover(raw) {
  const body = stripFence(raw);
  let obj = null;
  try {
    const parsed = JSON.parse(body);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first && typeof first === 'object') obj = first;
  } catch {
    /* truncated — fall back to field scans */
  }

  const pick = (field) =>
    typeof obj?.[field] === 'string' && obj[field].trim() ? obj[field].trim() : scanString(body, field);

  const viralRaw = obj?.viralScore ?? obj?.predictedScore ?? obj?.score;
  const viralScore =
    typeof viralRaw === 'number' && Number.isFinite(viralRaw)
      ? Math.max(0, Math.min(100, Math.round(viralRaw)))
      : (scanNumber(body, 'viralScore') ?? scanNumber(body, 'predictedScore'));

  const categoryRaw = (pick('category') || '').toUpperCase();
  const category = ['RELEVANT', 'SIMILAR', 'UNIQUE'].includes(categoryRaw) ? categoryRaw : null;

  return {
    title: pick('title'),
    angle: pick('angle'),
    hook: pick('hook'),
    rationale: pick('rationale'),
    category,
    viralScore,
  };
}

const rows = await prisma.idea.findMany({
  where: { deletedAt: null },
  select: {
    id: true,
    title: true,
    angle: true,
    hook: true,
    rationale: true,
    category: true,
    viralScore: true,
  },
});

const broken = rows.filter((r) => /^(```|[[{])/.test((r.title ?? '').trim()));
console.log(`${rows.length} idea(s) scanned, ${broken.length} with JSON-looking titles.`);

let repaired = 0;
for (const row of broken) {
  const fields = recover(row.title);
  if (!fields.title) {
    console.warn(`  ${row.id}: no title recoverable — leaving untouched`);
    continue;
  }

  // Only fill blanks; never overwrite data an operator may have edited.
  const data = { title: fields.title };
  if (!row.angle && fields.angle) data.angle = fields.angle;
  if (!row.hook && fields.hook) data.hook = fields.hook;
  if (!row.rationale && fields.rationale) data.rationale = fields.rationale;
  if (row.viralScore == null && fields.viralScore != null) data.viralScore = fields.viralScore;
  if (!row.category && fields.category) data.category = fields.category;

  console.log(`  ${row.id}: "${fields.title}"${data.viralScore != null ? ` (viralScore ${data.viralScore})` : ''}`);
  if (apply) await prisma.idea.update({ where: { id: row.id }, data });
  repaired += 1;
}

console.log(apply ? `Repaired ${repaired} idea(s).` : `Dry run — ${repaired} idea(s) would be repaired. Re-run with --apply.`);
await prisma.$disconnect();
