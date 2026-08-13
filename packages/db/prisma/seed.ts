/**
 * Seed script — creates the Owner user (docs/01 §8: 1 Owner = saboor@xoxodigitals.com).
 * Runnable later via `pnpm db:seed` (requires a reachable DATABASE_URL).
 * Password comes from env SEED_OWNER_PASSWORD and is bcrypt-hashed.
 */
import { PrismaClient, Role, UserStatus, AiProviderKind } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Default AI providers (docs/05 §2/§6). Keys are added later from the dashboard
 * (encrypted vault); kokoro is self-hosted and needs no key.
 */
const DEFAULT_PROVIDERS: Array<{
  name: string;
  kind: AiProviderKind;
  baseConfig: Record<string, unknown>;
}> = [
  {
    name: 'gemini',
    kind: AiProviderKind.MULTIMODAL,
    baseConfig: { baseUrl: 'https://generativelanguage.googleapis.com', needsKey: true },
  },
  {
    name: 'openai',
    kind: AiProviderKind.TEXT,
    baseConfig: { baseUrl: 'https://api.openai.com/v1', needsKey: true },
  },
  {
    name: 'kokoro',
    kind: AiProviderKind.TTS,
    baseConfig: { baseUrl: 'http://localhost:8880', needsKey: false },
  },
  {
    name: 'edge',
    kind: AiProviderKind.TTS,
    baseConfig: {
      needsKey: false,
      engine: 'edge-neural',
      defaultVoice: 'en-US-AriaNeural',
      binEnv: 'EDGE_TTS_BIN',
    },
  },
];

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

  for (const p of DEFAULT_PROVIDERS) {
    const provider = await prisma.aiProvider.upsert({
      where: { name: p.name },
      update: { kind: p.kind, baseConfig: p.baseConfig },
      create: { name: p.name, kind: p.kind, baseConfig: p.baseConfig },
    });
    console.log(`Seeded AI provider: ${provider.name} (${provider.kind})`);
  }
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
