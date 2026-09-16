import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateMeDto } from '@pantry-pal/shared/dto';

import { CurrentUser, type AuthenticatedUser } from '../common/request-context';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

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
}
