import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthSession } from '@pantry-pal/shared';
import { DevSignInDto, RefreshTokenDto, SignInDto, SignUpDto } from '@pantry-pal/shared/dto';

import { Public } from './access.decorators';
import { AuthService } from './auth.service';
import { CREDENTIAL_ATTEMPTS } from './rate-limits';
import { SessionsService } from './sessions.service';

/**
 * `/api/v1/auth`: public, since these routes are how a caller gets a token.
 *
 * Rate-limited per client address. Behind a reverse proxy that address comes
 * from `X-Forwarded-For` only when `TRUST_PROXY` says so; otherwise every visitor
 * shares the proxy's budget.
 */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(CREDENTIAL_ATTEMPTS)
  signUp(
    @Body() dto: SignUpDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AuthSession> {
    return this.auth.signUp(dto, userAgent);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_ATTEMPTS)
  signIn(
    @Body() dto: SignInDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AuthSession> {
    return this.auth.signIn(dto, userAgent);
  }

  /** Answered with a new pair: the refresh token sent here is spent. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthSession> {
    return this.sessions.refresh(dto.refreshToken);
  }

  /** Needs no access token, so a client whose token expired can still sign out. */
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  signOut(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.sessions.end(dto.refreshToken);
  }

  /** 404 unless `DEV_AUTH=true`. */
  @Post('dev-sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_ATTEMPTS)
  devSignIn(
    @Body() dto: DevSignInDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AuthSession> {
    return this.auth.devSignIn(dto, userAgent);
  }
}
