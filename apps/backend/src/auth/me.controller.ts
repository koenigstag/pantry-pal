import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ChangePasswordDto, UpdateMeDto } from '@pantry-pal/shared/dto';

import { CurrentSessionId, CurrentUser, type AuthenticatedUser } from '../common/request-context';
import { AuthService } from './auth.service';
import { MeService } from './me.service';
import { PASSWORD_CHANGE_ATTEMPTS } from './rate-limits';

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /** The caller's own settings: for now, the UI language. */
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
  ): Promise<AuthenticatedUser> {
    return this.me.update(user, dto);
  }

  /** Every other session of the account ends; this one stays signed in. */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle(PASSWORD_CHANGE_ATTEMPTS)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSessionId() sessionId: string | undefined,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(user, sessionId, dto);
  }
}
