import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerConfig } from './config/swagger';
import * as nodeCrypto from 'crypto';

const g: any = global as any;
if (!g.crypto) g.crypto = nodeCrypto as any;
else if (!g.crypto.randomUUID && (nodeCrypto as any).randomUUID)
  g.crypto.randomUUID = (nodeCrypto as any).randomUUID;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'verbose', 'debug'],
    rawBody: true,
  });

  app.enableVersioning({
    type: VersioningType.URI,
  });

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Idempotency-Key',
      'X-Webhook-Secret',
      'X-Api-Key',
    ],
  });

  await SwaggerConfig(app);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
        enableCircularCheck: true,
      },
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  await app.listen(process.env.PORT ?? 8000);
}
bootstrap();
