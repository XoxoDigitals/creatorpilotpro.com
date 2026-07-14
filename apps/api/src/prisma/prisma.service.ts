import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient as a Nest injectable, with a global singleton so repeated Nest
 * app boots (tests/dev reloads) don't exhaust the connection pool.
 *
 * NOTE: we instantiate `@prisma/client` (CommonJS) directly rather than the
 * ESM `getPrisma()` from `@scp/db`, because Node's `require(ESM)` interop drops
 * that package's local export when it also `export *`s a CJS module. `@scp/db`
 * remains the source of shared Prisma *types* (imported as `import type`).
 */
const globalForPrisma = globalThis as unknown as { __scpApiPrisma?: PrismaClient };

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient =
    globalForPrisma.__scpApiPrisma ?? (globalForPrisma.__scpApiPrisma = new PrismaClient());

  async onModuleInit(): Promise<void> {
    // Fail fast at boot if the DB is unreachable.
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
