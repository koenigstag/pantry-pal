import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';
import { HouseholdAccessGuard } from './household-access.guard';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MembershipService } from './membership.service';

/**
 * Exports `MembershipService` so that any module whose controllers use
 * `@UseGuards(HouseholdAccessGuard)` can resolve the guard's dependency by
 * importing this module.
 */
@Module({
  imports: [SettingsModule],
  controllers: [HouseholdsController, MembersController],
  providers: [HouseholdsService, MembersService, MembershipService, HouseholdAccessGuard],
  exports: [HouseholdsService, MembershipService, HouseholdAccessGuard],
})
export class HouseholdsModule {}
