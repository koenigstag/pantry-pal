import { Body, Controller, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ResetPasswordDto } from '@pantry-pal/shared/dto';

import { AdminOnly } from '../auth/access.decorators';
import { AuthService } from '../auth/auth.service';

/**
 * `/api/v1/admin/users`, authenticated with the `x-admin-api-key` header. Users
 * are addressed by email, the identifier an administrator is given; it may be
 * sent as typed or percent-encoded.
 */
@AdminOnly()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly auth: AuthService) {}

  /** Sets the password and ends every session of the user. Sends no email. */
  @Put(':email/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Param('email') email: string, @Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(email, dto.password);
  }
}
