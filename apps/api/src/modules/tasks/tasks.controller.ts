import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { WorkerTaskStatus } from '@scp/db';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { SessionUser } from '../../common/session/session.types';
import { TasksService } from './tasks.service';
import type { WorkerTaskView, WorkerStatsView } from './tasks.view';
import {
  createTaskSchema,
  assignTaskSchema,
  revisionSchema,
  type CreateTaskDto,
  type AssignTaskDto,
  type RevisionDto,
} from './dto/tasks.dto';

/**
 * Tasks module (docs/02 §3, Phase 4). Production task board: assign, track, review.
 * Manager endpoints require OWNER/ADMIN/REVIEWER; assignees are REVIEWER users
 * (the /workers page is a production board, not a fourth user role).
 */
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  // ---------------------------------------------------------------------------
  // Manager endpoints
  // ---------------------------------------------------------------------------

  /** List all tasks with optional filters (status, workerId, accountId). */
  @Get()
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  list(
    @Query('status') status?: string,
    @Query('workerId') workerId?: string,
    @Query('accountId') accountId?: string,
  ): Promise<WorkerTaskView[]> {
    return this.tasks.list({
      status: status as WorkerTaskStatus | undefined,
      workerId,
      accountId,
    });
  }

  /** Manually create a task and assign to a reviewer/producer. */
  @Post()
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('task.create', 'WorkerTask')
  create(
    @Body(new ZodBody(createTaskSchema)) body: CreateTaskDto,
  ): Promise<WorkerTaskView> {
    return this.tasks.create(body);
  }

  /** Assign or reassign a task to a different assignee. */
  @Post(':id/assign')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('task.assign', 'WorkerTask')
  assign(
    @Param('id') id: string,
    @Body(new ZodBody(assignTaskSchema)) body: AssignTaskDto,
  ): Promise<WorkerTaskView> {
    return this.tasks.assign(id, body.workerId);
  }

  /** Request a revision on uploaded work. */
  @Post(':id/request-revision')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('task.revision', 'WorkerTask')
  requestRevision(
    @Param('id') id: string,
    @Body(new ZodBody(revisionSchema)) body: RevisionDto,
  ): Promise<WorkerTaskView> {
    return this.tasks.requestRevision(id, body.note);
  }

  /** Accept uploaded work — creates a ContentItem and marks the task DONE. */
  @Post(':id/accept')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('task.accept', 'WorkerTask')
  accept(@Param('id') id: string): Promise<WorkerTaskView> {
    return this.tasks.accept(id);
  }

  // ---------------------------------------------------------------------------
  // Assignee endpoints (defined BEFORE :id so NestJS doesn't treat literals as params)
  // ---------------------------------------------------------------------------

  /** Current user's assigned task list. */
  @Get('mine')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  mine(@CurrentUser() user: SessionUser): Promise<WorkerTaskView[]> {
    return this.tasks.listForWorker(user.id);
  }

  /** Current user's productivity stats. */
  @Get('stats')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  stats(@CurrentUser() user: SessionUser): Promise<WorkerStatsView> {
    return this.tasks.getStats(user.id);
  }

  /** Get task detail. Reviewers can only see their own assigned tasks. */
  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  async get(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<WorkerTaskView> {
    await this.tasks.assertWorkerAccess(id, user.id, user.role);
    return this.tasks.get(id);
  }

  /** Assignee starts an assigned task (ASSIGNED -> IN_PROGRESS). */
  @Post(':id/start')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('task.start', 'WorkerTask')
  start(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<WorkerTaskView> {
    return this.tasks.start(id, user.id);
  }

  /** Assignee marks task as uploaded. */
  @Post(':id/upload')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('task.upload', 'WorkerTask')
  upload(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<WorkerTaskView> {
    return this.tasks.markUploaded(id, user.id);
  }
}
