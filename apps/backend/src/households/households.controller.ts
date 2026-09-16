import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HOUSEHOLD_ROLE, type UserHousehold } from '@pantry-pal/shared';
import { CreateHouseholdDto, UpdateHouseholdDto } from '@pantry-pal/shared/dto';

import {
  CurrentMembership,
  CurrentUser,
  type AuthenticatedUser,
  type Membership,
} from '../common/request-context';
import { HouseholdAccessGuard, RequireHouseholdRole } from './household-access.guard';
import { HouseholdsService } from './households.service';

/**
 * `/api/v1/households`. DTOs are imported as values: Nest's `ValidationPipe`
 * reads the runtime class from the parameter's decorator metadata.
 */
@Controller('households')
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  /** The caller's households, each with the caller's role in it. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<UserHousehold[]> {
    return this.households.listForUser(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHouseholdDto,
  ): Promise<UserHousehold> {
    return this.households.create(user, dto);
  }

  @Get(':householdId')
  @UseGuards(HouseholdAccessGuard)
  get(@CurrentMembership() membership: Membership): Promise<UserHousehold> {
    return this.households.get(membership);
  }

  @Patch(':householdId')
  @UseGuards(HouseholdAccessGuard)
  @RequireHouseholdRole(HOUSEHOLD_ROLE.Owner)
  rename(
    @CurrentMembership() membership: Membership,
    @Body() dto: UpdateHouseholdDto,
  ): Promise<UserHousehold> {
    return this.households.rename(membership, dto);
  }

  @Delete(':householdId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(HouseholdAccessGuard)
  @RequireHouseholdRole(HOUSEHOLD_ROLE.Owner)
  remove(@CurrentMembership() membership: Membership): Promise<void> {
    return this.households.remove(membership);
  }
}
