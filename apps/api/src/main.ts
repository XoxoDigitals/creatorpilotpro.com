import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }), // behind Caddy in prod → correct req.ip
  );
  const config = app.get(ConfigService);

  // Versioned REST prefix (docs/02 §4).
  app.setGlobalPrefix('api/v1');

  // Signed HttpOnly session cookies (docs/08 §2). SESSION_SECRET must be set.
  const sessionSecret = config.get<string>('sessionSecret');
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is not set — refusing to start without a cookie-signing key.');
  }
  await app.register(fastifyCookie, { secret: sessionSecret });

  app.enableCors({
    origin: config.get<string[]>('corsOrigins') ?? true,
    credentials: true,
  });

  // OpenAPI spec + Swagger UI at /api/docs (docs/02 §4).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SocialCreatorPilot API')
    .setDescription('REST API for SocialCreatorPilot (docs/02).')
    .setVersion(config.get<string>('version') ?? '0.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('port') ?? 4000;
  const host = config.get<string>('host') ?? '0.0.0.0';
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://${host}:${port} (docs: /api/docs)`);
}

void bootstrap();
