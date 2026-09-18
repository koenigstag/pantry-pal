import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  SYNC_COLLECTION,
  SYNC_PUSH_COLLECTIONS,
  type SyncCollection,
  type SyncPullPayload,
  type SyncPushCollection,
  type SyncPushResult,
} from '@pantry-pal/shared';
import { SyncPullQueryDto, SyncPushDto } from '@pantry-pal/shared/dto';

import { CurrentMembership, type Membership } from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { SyncPushService } from './sync-push.service';
import { SyncService, type SyncedDocument } from './sync.service';

@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId/sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly syncPush: SyncPushService,
  ) {}

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

  /**
   * Local changes to items or shopping entries, applied through the domain
   * services. 200 whatever happened to each row: the answer lists the server's
   * version of every row it did not apply as sent, and why for the refused ones.
   */
  @Post(':collection/push')
  @HttpCode(HttpStatus.OK)
  push(
    @CurrentMembership() membership: Membership,
    @Param('collection', new ParseEnumPipe(SYNC_PUSH_COLLECTIONS)) collection: SyncPushCollection,
    @Body() dto: SyncPushDto,
  ): Promise<SyncPushResult<SyncedDocument>> {
    return this.syncPush.push(membership, collection, dto.rows);
  }
}
