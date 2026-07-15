import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hotTierPath } from '@scp/storage';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { toAssetView, type AssetView } from './asset.view';

type UploadKind = 'ORIGINAL' | 'FINAL';

/** Replace path-hostile characters so a client filename can't escape the tier root. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'upload.bin';
}

@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Stream an uploaded file into the local hot tier and register it as an Asset
   * (docs/02 §6). md5 + byte length are computed in a single pass over the stream.
   */
  async saveUpload(input: {
    contentItemId: string;
    kind: UploadKind;
    filename: string;
    stream: Readable;
    isTruncated: () => boolean;
  }): Promise<AssetView> {
    const content = await this.prisma.client.contentItem.findFirst({
      where: { id: input.contentItemId, deletedAt: null },
      select: { id: true },
    });
    if (!content) throw new NotFoundException('Content item not found.');

    const root = this.config.get<string>('storageRoot');
    if (!root) throw new BadRequestException('Storage root is not configured.');

    const dest = hotTierPath(root, input.contentItemId, input.kind, safeFilename(input.filename));
    await mkdir(dirname(dest), { recursive: true });

    const hash = createHash('md5');
    let bytes = 0;
    try {
      await pipeline(
        input.stream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            hash.update(chunk);
            bytes += chunk.length;
            yield chunk;
          }
        },
        createWriteStream(dest),
      );
    } catch (err) {
      await unlink(dest).catch(() => undefined);
      throw err;
    }

    // @fastify/multipart flags truncation when the fileSize limit is exceeded.
    if (input.isTruncated()) {
      await unlink(dest).catch(() => undefined);
      throw new PayloadTooLargeException('Upload exceeds the maximum file size.');
    }

    const asset = await this.prisma.client.asset.create({
      data: {
        contentItemId: input.contentItemId,
        kind: input.kind,
        localPath: dest,
        md5: hash.digest('hex'),
        bytes: BigInt(bytes),
        storageState: 'LOCAL',
      },
    });
    return toAssetView(asset);
  }
}
