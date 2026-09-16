import { Catch, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import { translateDatabaseError } from './database-errors';

/**
 * Turns constraint violations into 4xx responses instead of 500s; everything
 * else passes through to Nest's default handling unchanged.
 *
 * Registered as `APP_FILTER`, so it applies to HTTP only — Nest does not run
 * global filters for gateways. `WsExceptionFilter` does the same translation
 * for sockets.
 */
@Catch()
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(translateDatabaseError(exception) ?? exception, host);
  }
}
