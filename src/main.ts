import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerConfig } from './config/swagger';
import * as nodeCrypto from 'crypto';

// Polyfill global crypto for Node < 20 where global.crypto may be undefined
const g: any = global as any;
if (!g.crypto) g.crypto = nodeCrypto as any;
else if (!g.crypto.randomUUID && (nodeCrypto as any).randomUUID) g.crypto.randomUUID = (nodeCrypto as any).randomUUID;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'verbose', 'debug'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.enableCors();

  SwaggerConfig(app);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(process.env.PORT ?? 8000);
}
bootstrap();
