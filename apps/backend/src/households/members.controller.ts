import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HOUSEHOLD_ROLE, type HouseholdMember } from '@pantry-pal/shared';
import { AddHouseholdMemberDto, UpdateHouseholdMemberDto } from '@pantry-pal/shared/dto';

import { CurrentMembership, type Membership } from '../common/request-context';
import { HouseholdAccessGuard, RequireHouseholdRole } from './household-access.guard';
import { MembersService } from './members.service';

@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentMembership() membership: Membership): Promise<HouseholdMember[]> {
    return this.members.list(membership);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireHouseholdRole(HOUSEHOLD_ROLE.Owner)
  add(
    @CurrentMembership() membership: Membership,
    @Body() dto: AddHouseholdMemberDto,
  ): Promise<HouseholdMember> {
    return this.members.add(membership, dto);
  }

  @Get(':userId')
  get(
    @CurrentMembership() membership: Membership,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<HouseholdMember> {
    return this.members.get(membership, userId);
  }

  @Patch(':userId')
  @RequireHouseholdRole(HOUSEHOLD_ROLE.Owner)
  updateRole(
    @CurrentMembership() membership: Membership,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateHouseholdMemberDto,
  ): Promise<HouseholdMember> {
    return this.members.updateRole(membership, userId, dto);
  }

  /** Owners remove anyone; a member may remove only themselves (leave). Checked in the service. */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.members.remove(membership, userId);
  }
}
