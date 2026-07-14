import { PrismaClient } from '@prisma/client';

/**
 * Lazily-instantiated PrismaClient singleton.
 * Prisma only opens a connection on the first query, so importing this module
 * never touches the database at build/typecheck time. In dev we cache the client
 * on globalThis to survive HMR/reloads and avoid connection-pool exhaustion.
 */
const globalForPrisma = globalThis as unknown as { __scpPrisma?: PrismaClient };

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    client = globalForPrisma.__scpPrisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__scpPrisma = client;
    }
  }
  return client;
}

// Re-export the generated client namespace, models and enums (Role, UserStatus, ...).
export * from '@prisma/client';
