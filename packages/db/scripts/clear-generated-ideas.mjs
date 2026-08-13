/**
 * Destructively clear generated ideas and their production packages while
 * preserving accounts, references, settings, and real content.
 *
 * Run:
 *   node --env-file=.env packages/db/scripts/clear-generated-ideas.mjs
 */
import { PrismaClient } from '@scp/db';
import { rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const prisma = new PrismaClient();
const storageRoot = process.env.STORAGE_ROOT ? resolve(process.env.STORAGE_ROOT) : null;

const ideas = await prisma.idea.findMany({
  select: {
    id: true,
    brief: { select: { id: true, voiceoverLocalPath: true } },
    _count: { select: { contentItems: true, workerTasks: true } },
  },
});

const ideaIds = ideas.map((idea) => idea.id);
const briefIds = ideas.flatMap((idea) => (idea.brief ? [idea.brief.id] : []));
const linkedContent = ideas.reduce((sum, idea) => sum + idea._count.contentItems, 0);
const linkedWorkerTasks = ideas.reduce((sum, idea) => sum + idea._count.workerTasks, 0);
const briefWorkerTasks =
  briefIds.length === 0 ? 0 : await prisma.workerTask.count({ where: { briefId: { in: briefIds } } });

let queuedJobsDeleted = 0;
try {
  queuedJobsDeleted = await prisma.$executeRawUnsafe(`
    DELETE FROM pgboss.job
    WHERE data->>'kind' IN ('idea_generation', 'brief_generation', 'idea_tts')
      AND state IN ('created', 'retry', 'active')
  `);
} catch (error) {
  // A fresh DB may not have pg-boss installed yet. Do not block data cleanup.
  console.warn(`Queue cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
}

const deleted = await prisma.$transaction(async (tx) => {
  if (briefIds.length > 0) {
    await tx.workerTask.updateMany({
      where: { briefId: { in: briefIds } },
      data: { briefId: null },
    });
  }
  if (ideaIds.length > 0) {
    await tx.workerTask.updateMany({
      where: { ideaId: { in: ideaIds } },
      data: { ideaId: null },
    });
    await tx.contentItem.updateMany({
      where: { ideaId: { in: ideaIds } },
      data: { ideaId: null },
    });
  }
  const packages = await tx.productionBrief.deleteMany({
    where: briefIds.length > 0 ? { id: { in: briefIds } } : { id: { in: [] } },
  });
  const ideaRows = await tx.idea.deleteMany({
    where: ideaIds.length > 0 ? { id: { in: ideaIds } } : { id: { in: [] } },
  });
  return { packages: packages.count, ideas: ideaRows.count };
});

let voiceoverDirectoriesDeleted = 0;
if (storageRoot) {
  const ideasRoot = resolve(storageRoot, 'ideas');
  for (const idea of ideas) {
    const directory = resolve(ideasRoot, idea.id);
    const rel = relative(ideasRoot, directory);
    // Refuse any path that escapes STORAGE_ROOT/ideas.
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    await rm(directory, { recursive: true, force: true });
    voiceoverDirectoriesDeleted += 1;
  }
}

console.log(
  JSON.stringify(
    {
      ideasDeleted: deleted.ideas,
      productionBriefsDeleted: deleted.packages,
      contentItemsPreservedAndUnlinked: linkedContent,
      workerTasksPreservedAndUnlinked: linkedWorkerTasks + briefWorkerTasks,
      queuedIdeaJobsDeleted: queuedJobsDeleted,
      voiceoverDirectoriesDeleted,
      remainingIdeas: await prisma.idea.count(),
      remainingProductionBriefs: await prisma.productionBrief.count(),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
