import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ContentItemStatus } from '@scp/db';
import { ContentService } from './content.service';
import type { ContentItemView, ReviewItemView } from './content.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createContentSchema,
  rejectContentSchema,
  type CreateContentDto,
  type RejectContentDto,
} from './dto/content.dto';

/**
 * Content module (docs/03 Domain 4). Content items + the review queue. REVIEWER
 * can review/approve/reject; OWNER/ADMIN/WORKER can create.
 */
@ApiTags('content')
@Roles('OWNER', 'ADMIN', 'REVIEWER', 'WORKER')
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Post()
  @Roles('OWNER', 'ADMIN', 'WORKER')
  @Audit('content.create', 'ContentItem')
  create(@Body(new ZodBody(createContentSchema)) body: CreateContentDto): Promise<ContentItemView> {
    return this.content.create(body);
  }

  @Get()
  list(@Query('status') status?: string): Promise<ContentItemView[]> {
    return this.content.list(status as ContentItemStatus | undefined);
  }

  @Get('review')
  review(@Query('accountId') accountId?: string): Promise<ReviewItemView[]> {
    return this.content.listReview(accountId);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.get(id);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.approve', 'ContentItem')
  approve(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.approve(id);
  }

  @Post(':id/approve-script')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.approve_script', 'ContentItem')
  approveScript(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.approveScript(id);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.reject', 'ContentItem')
  reject(
    @Param('id') id: string,
    @Body(new ZodBody(rejectContentSchema)) body: RejectContentDto,
  ): Promise<ContentItemView> {
    return this.content.reject(id, body.reason);
  }
}
