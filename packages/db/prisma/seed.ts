/**
 * Seed script — creates the Owner user (docs/01 §8: 1 Owner = saboor@xoxodigitals.com).
 * Runnable later via `pnpm db:seed` (requires a reachable DATABASE_URL).
 * Password comes from env SEED_OWNER_PASSWORD and is bcrypt-hashed.
 */
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = 'saboor@xoxodigitals.com';
  const password = process.env.SEED_OWNER_PASSWORD;

  if (!password) {
    throw new Error('SEED_OWNER_PASSWORD is not set — refusing to seed a blank password.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const owner = await prisma.user.upsert({
    where: { email },
    update: { role: Role.OWNER, status: UserStatus.ACTIVE },
    create: {
      email,
      name: 'Owner',
      role: Role.OWNER,
      status: UserStatus.ACTIVE,
      passwordHash,
    },
  });

  console.log(`Seeded Owner user: ${owner.email} (${owner.id})`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
