import { Controller, Get, Param, ParseEnumPipe, Query, UseGuards } from '@nestjs/common';
import { SYNC_COLLECTION, type SyncCollection, type SyncPullPayload } from '@pantry-pal/shared';
import { SyncPullQueryDto } from '@pantry-pal/shared/dto';

import { CurrentMembership, type Membership } from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { SyncService, type SyncedDocument } from './sync.service';

@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * One page of a collection's changes after the checkpoint (`?updatedAt=&id=`,
   * both or neither), deleted rows included, at most `?limit=` of them. Pull
   * again from the returned checkpoint until a page comes back short.
   */
  @Get(':collection')
  pull(
    @CurrentMembership() membership: Membership,
    @Param('collection', new ParseEnumPipe(SYNC_COLLECTION)) collection: SyncCollection,
    @Query() query: SyncPullQueryDto,
  ): Promise<SyncPullPayload<SyncedDocument>> {
    return this.sync.pull(membership, collection, query);
  }
}
