import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { PushDevice, PushStatus, PushTestResult } from '@pantry-pal/shared';
import { RegisterPushDeviceDto } from '@pantry-pal/shared/dto';

import { PUSH_TEST_REQUESTS } from '../auth/rate-limits';
import { CurrentSessionId, CurrentUser, type AuthenticatedUser } from '../common/request-context';
import { PushDevicesService } from './push-devices.service';

/**
 * Push notifications, for the caller's own devices. `GET /push` tells clients
 * whether this server has push at all; registering and testing answer 404
 * while it does not.
 */
@Controller('push')
export class PushController {
  constructor(private readonly devices: PushDevicesService) {}

  @Get()
  status(): PushStatus {
    return this.devices.status();
  }

  @Get('devices')
  list(@CurrentUser() user: AuthenticatedUser): Promise<PushDevice[]> {
    return this.devices.list(user);
  }

  /** This browser: registered, or its topics replaced. */
  @Put('devices')
  register(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSessionId() sessionId: string | undefined,
    @Body() dto: RegisterPushDeviceDto,
  ): Promise<PushDevice> {
    return this.devices.register(user, sessionId, dto);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.devices.remove(user, id);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle(PUSH_TEST_REQUESTS)
  test(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSessionId() sessionId: string | undefined,
  ): Promise<PushTestResult> {
    return this.devices.test(user, sessionId);
  }
}
