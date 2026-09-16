import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_BASE_PATH, API_PREFIX, API_VERSION, PANTRY_WS_NAMESPACE } from '@pantry-pal/shared';

import { AppModule } from './app.module';
import { PantryIoAdapter } from './pantry/io-adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  const port = config.get<number>('port', 3001);
  const host = config.get<string>('host', '0.0.0.0');
  const corsOrigins = config.get<string[]>('corsOrigins', []);

  // Express 5 (shipped with Nest 12) changed the default query parser from
  // 'extended' to 'simple', which silently stops parsing nested and repeated
  // params: `?tags[]=a&tags[]=b` arrives as a string rather than an array, and
  // `?filter[name]=x` does not become an object. Restoring qs-based parsing
  // keeps query DTOs behaving the way they did on Express 4.
  app.set('query parser', 'extended');

  app.setGlobalPrefix(`${API_PREFIX}/${API_VERSION}`);
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useWebSocketAdapter(new PantryIoAdapter(app, corsOrigins));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(port, host);

  const logger = new Logger('Bootstrap');
  logger.log(`HTTP      http://localhost:${port}${API_BASE_PATH}`);
  logger.log(`WebSocket ws://localhost:${port}${PANTRY_WS_NAMESPACE}`);
  logger.log(`CORS      ${corsOrigins.join(', ') || '(none configured)'}`);
}

void bootstrap();
