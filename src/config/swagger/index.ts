import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import metadata from 'src/metadata';

export const SwaggerConfig = async (app: INestApplication) => {
  const apiKey = process.env.SWAGGER_API_KEY?.trim();
  if (process.env.NODE_ENV === 'production' && !apiKey) return;
  if (apiKey) {
    app.use(
      '/api',
      (
        req: { headers: Record<string, unknown> },
        res: { status: (code: number) => { json: (body: unknown) => void } },
        next: () => void,
      ) => {
        if (req.headers['x-api-key'] !== apiKey) {
          res.status(403).json({ message: 'Invalid API key' });
          return;
        }
        next();
      },
    );
  }
  const cfg = new DocumentBuilder()
    .setTitle('Brics Pay Backend API')
    .setDescription('The API description')
    .setVersion('0.0.1')
    .addBasicAuth({ type: 'http', in: 'header' }, 'Basic')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'Bearer',
    )
    .build();
  await SwaggerModule.loadPluginMetadata(metadata);
  const document = SwaggerModule.createDocument(app, cfg);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { defaultModelsExpandDepth: -1 },
  });
};
