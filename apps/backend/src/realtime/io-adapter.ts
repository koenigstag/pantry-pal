import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Applies the configured CORS origins to the Socket.IO server.
 *
 * Socket.IO performs its own CORS handling and ignores `app.enableCors()`, so
 * without this the browser handshake is rejected in development.
 */
export class PantryIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  /* `any` mirrors IoAdapter's own return signature. */
  override createIOServer(port: number, options?: ServerOptions): any {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.corsOrigins,
        credentials: true,
      },
    } as ServerOptions);
  }
}
