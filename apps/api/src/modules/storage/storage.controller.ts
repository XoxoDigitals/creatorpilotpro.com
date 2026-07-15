import { BadRequestException, Controller, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { StorageService } from './storage.service';
import type { AssetView } from './asset.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Storage module (docs/02 §6, docs/06 §2). Manual media upload streamed into the
 * local hot tier. OWNER/ADMIN/WORKER may upload (workers produce content).
 */
@ApiTags('storage')
@Roles('OWNER', 'ADMIN', 'WORKER')
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('upload')
  @Audit('asset.upload', 'Asset')
  async upload(
    @Req() req: FastifyRequest,
    @Query('contentItemId') contentItemId?: string,
    @Query('kind') kind?: string,
  ): Promise<AssetView> {
    if (!contentItemId) throw new BadRequestException('contentItemId query param is required.');
    if (kind && kind !== 'ORIGINAL' && kind !== 'FINAL') {
      throw new BadRequestException('kind must be ORIGINAL or FINAL.');
    }
    if (!req.isMultipart()) throw new BadRequestException('Expected a multipart/form-data upload.');

    const data = await req.file();
    if (!data) throw new BadRequestException('No file part found in the upload.');

    return this.storage.saveUpload({
      contentItemId,
      kind: (kind as 'ORIGINAL' | 'FINAL') ?? 'FINAL',
      filename: data.filename,
      stream: data.file,
      isTruncated: () => data.file.truncated,
    });
  }
}
