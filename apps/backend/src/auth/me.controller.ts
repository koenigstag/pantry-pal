import { Controller, Get } from '@nestjs/common';

import { CurrentUser, type AuthenticatedUser } from '../common/request-context';

@Controller('me')
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
