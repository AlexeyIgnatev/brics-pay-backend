import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import metadata from 'src/metadata';
import { SwaggerAuthMiddleware } from './middeware';

export const SwaggerConfig = async (app: INestApplication) => {
  const cfg = new DocumentBuilder()
    .setTitle('Brics Pay Backend API')
    .setDescription('The API description')
    .setVersion('0.0.1')
    .addBasicAuth({ type: 'http', in: 'header' }, 'Basic')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' }, 'Bearer')
    .build();
  await SwaggerModule.loadPluginMetadata(metadata);
  const document = SwaggerModule.createDocument(app, cfg);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { defaultModelsExpandDepth: -1 },
  });
};
