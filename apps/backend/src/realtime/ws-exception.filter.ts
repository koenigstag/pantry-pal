import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

import { translateDatabaseError } from '../database/database-errors';

/**
 * Translates HTTP exceptions into WebSocket ones.
 *
 * `app.useGlobalPipes()` applies to every execution context, so the global
 * `ValidationPipe` validates socket payloads too — but it raises
 * `BadRequestException`, which the WebSocket exception handler does not
 * recognise and reports to the client as a bare "Internal server error".
 * Re-wrapping it preserves the validation details. The services throw the same
 * HTTP exceptions for both transports, so their messages survive the same way.
 *
 * Constraint violations are translated here too: Nest does not apply global
 * filters to gateways, so `DatabaseExceptionFilter` never sees socket errors.
 */
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const error = translateDatabaseError(exception) ?? exception;

    if (error instanceof HttpException) {
      super.catch(new WsException(error.getResponse()), host);
      return;
    }
    super.catch(error, host);
  }
}
