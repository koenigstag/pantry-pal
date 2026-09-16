import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

/**
 * Translates HTTP exceptions into WebSocket ones.
 *
 * `app.useGlobalPipes()` applies to every execution context, so the global
 * `ValidationPipe` validates socket payloads too — but it raises
 * `BadRequestException`, which the WebSocket exception handler does not
 * recognise and reports to the client as a bare "Internal server error".
 * Re-wrapping it preserves the validation details.
 */
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(new WsException(exception.getResponse()), host);
      return;
    }
    super.catch(exception, host);
  }
}
