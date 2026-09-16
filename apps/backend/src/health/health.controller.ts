import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/access.decorators';

/** Liveness only: it answers even when the database is down. */
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
