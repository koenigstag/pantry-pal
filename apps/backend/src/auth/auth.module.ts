import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessGuard } from './access.guard';
import { IdentityService } from './identity.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  controllers: [MeController],
  providers: [IdentityService, MeService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [IdentityService],
})
export class AuthModule {}
