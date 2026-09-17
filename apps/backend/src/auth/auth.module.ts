import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';

import { AccessGuard } from './access.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { JwtStrategy } from './jwt.strategy';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PasswordHasher } from './password-hasher';
import { SessionsService } from './sessions.service';
import { TokenSigner } from './token-signer';

@Module({
  imports: [
    PassportModule,
    // No default secret on purpose: `TokenSigner` names the right one on every
    // call, and a call that names none fails instead of borrowing one.
    JwtModule.register({}),
    // Applies only where `ThrottlerGuard` is used: the auth controller. In memory,
    // so the counts are per process and restart with it.
    ThrottlerModule.forRoot({ throttlers: [{ limit: 30, ttl: 60_000 }] }),
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    IdentityService,
    JwtStrategy,
    MeService,
    PasswordHasher,
    SessionsService,
    TokenSigner,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AuthService, IdentityService],
})
export class AuthModule {}
