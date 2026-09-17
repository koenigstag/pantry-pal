import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_BASE_PATH, API_PREFIX, API_VERSION, PANTRY_WS_NAMESPACE } from '@pantry-pal/shared';

import { AppModule } from './app.module';
import type { JwtSecretName } from './config/configuration';
import { PantryIoAdapter } from './realtime/io-adapter';

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

  // Behind a reverse proxy every request arrives from the proxy. The auth routes'
  // rate limits key on the client address, which Express then takes from
  // `X-Forwarded-For` — but only for the proxies this names.
  const trustProxy = config.get<boolean | number | string>('trustProxy');
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);

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
  logger.log(
    `Identity  JWT${config.get<boolean>('auth.devIdentity') === true ? ', plus dev sign-in' : ''}`,
  );
  const generatedSecrets = config.get<JwtSecretName[]>('auth.generatedSecrets', []);
  if (generatedSecrets.includes('JWT_ACCESS_SECRET')) {
    logger.warn(
      'JWT_ACCESS_SECRET is not set: access tokens are signed with a key generated for this ' +
        'process, so they stop verifying when it restarts and clients have to refresh.',
    );
  }
  if (generatedSecrets.includes('JWT_REFRESH_SECRET')) {
    logger.warn(
      'JWT_REFRESH_SECRET is not set: refresh tokens are signed with a key generated for this ' +
        'process, so every session ends when it restarts. Set it to stay signed in across restarts.',
    );
  }
  logger.log(
    `Proxies   ${trustProxy === undefined ? 'none trusted' : `trusted: ${String(trustProxy)}`}`,
  );
  logger.log(
    `Admin API ${config.get<string>('admin.apiKey') === undefined ? 'disabled' : 'enabled'}`,
  );
}

void bootstrap();
