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
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PantryItem } from '@pantry-pal/shared';
import {
  AddSubItemsDto,
  CreatePantryItemDto,
  ListPantryItemsQueryDto,
  UpdatePantryItemDto,
  UpdateSubItemDto,
} from '@pantry-pal/shared/dto';

import { CurrentMembership, type Membership } from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { ItemsService } from './items.service';

@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId/items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  /** `?status=active|consumed|discarded|all` (default `active`), `?locationId=`. */
  @Get()
  list(
    @CurrentMembership() membership: Membership,
    @Query() query: ListPantryItemsQueryDto,
  ): Promise<PantryItem[]> {
    return this.items.list(membership, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreatePantryItemDto,
  ): Promise<PantryItem> {
    return this.items.create(membership, dto);
  }

  @Get(':itemId')
  get(
    @CurrentMembership() membership: Membership,
    @Param('itemId', ParseUUIDPipe) id: string,
  ): Promise<PantryItem> {
    return this.items.get(membership, id);
  }

  @Patch(':itemId')
  update(
    @CurrentMembership() membership: Membership,
    @Param('itemId', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePantryItemDto,
  ): Promise<PantryItem> {
    return this.items.update(membership, id, dto);
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('itemId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.items.remove(membership, id);
  }

  /** Puts units on the item's shelf, each in a state of its own. Answers with the item. */
  @Post(':itemId/sub-items')
  @HttpCode(HttpStatus.CREATED)
  addSubItems(
    @CurrentMembership() membership: Membership,
    @Param('itemId', ParseUUIDPipe) id: string,
    @Body() dto: AddSubItemsDto,
  ): Promise<PantryItem> {
    return this.items.changeSubItems(membership, id, { add: dto.subItems });
  }

  /** One unit's dates, how much is left, or its status: used up, thrown out. Answers with the item. */
  @Patch(':itemId/sub-items/:subItemId')
  updateSubItem(
    @CurrentMembership() membership: Membership,
    @Param('itemId', ParseUUIDPipe) id: string,
    @Param('subItemId', ParseUUIDPipe) subItemId: string,
    @Body() dto: UpdateSubItemDto,
  ): Promise<PantryItem> {
    return this.items.changeSubItems(membership, id, { update: [{ id: subItemId, patch: dto }] });
  }

  /** A unit added by mistake. The item keeps at least one unit (409). Answers with the item. */
  @Delete(':itemId/sub-items/:subItemId')
  removeSubItem(
    @CurrentMembership() membership: Membership,
    @Param('itemId', ParseUUIDPipe) id: string,
    @Param('subItemId', ParseUUIDPipe) subItemId: string,
  ): Promise<PantryItem> {
    return this.items.changeSubItems(membership, id, { remove: [subItemId] });
  }
}
