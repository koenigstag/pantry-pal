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
  Put,
  UseGuards,
} from '@nestjs/common';
import type {
  PantryItem,
  ShoppingList,
  ShoppingListEntriesChange,
  ShoppingListEntry,
  ShoppingLists,
} from '@pantry-pal/shared';
import {
  AddShoppingListEntriesDto,
  CreateShoppingListDto,
  PutAwayShoppingListEntriesDto,
  UpdateShoppingListDto,
  UpdateShoppingListEntryDto,
  UpsertShoppingListsDto,
} from '@pantry-pal/shared/dto';

import { CurrentMembership, type Membership } from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { ShoppingListsService } from './shopping-lists.service';

@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId/shopping-lists')
export class ShoppingListsController {
  constructor(private readonly shopping: ShoppingListsService) {}

  /** Every list in display order, every entry, and the items the entries name. */
  @Get()
  overview(@CurrentMembership() membership: Membership): Promise<ShoppingLists> {
    return this.shopping.overview(membership);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateShoppingListDto,
  ): Promise<ShoppingList> {
    return this.shopping.create(membership, dto);
  }

  /**
   * Saves the shopping lists editor in one transaction: additions, renames,
   * archiving, deletions and order. Returns every list in the new order; 409
   * when the set the client edited is out of date.
   */
  @Put()
  upsert(
    @CurrentMembership() membership: Membership,
    @Body() dto: UpsertShoppingListsDto,
  ): Promise<ShoppingList[]> {
    return this.shopping.upsert(membership, dto);
  }

  @Patch(':listId')
  rename(
    @CurrentMembership() membership: Membership,
    @Param('listId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShoppingListDto,
  ): Promise<ShoppingList> {
    return this.shopping.rename(membership, id, dto);
  }

  /** Its entries go with it, and items that went on it by default go nowhere. */
  @Delete(':listId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('listId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.shopping.remove(membership, id);
  }

  /** 200 rather than 201: items already on the list are left alone, so nothing may be created. */
  @Post(':listId/entries')
  @HttpCode(HttpStatus.OK)
  addEntries(
    @CurrentMembership() membership: Membership,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: AddShoppingListEntriesDto,
  ): Promise<ShoppingListEntriesChange> {
    return this.shopping.addEntries(membership, listId, dto);
  }

  @Patch(':listId/entries/:entryId')
  updateEntry(
    @CurrentMembership() membership: Membership,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Param('entryId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShoppingListEntryDto,
  ): Promise<ShoppingListEntry> {
    return this.shopping.updateEntry(membership, listId, id, dto);
  }

  @Delete(':listId/entries/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEntry(
    @CurrentMembership() membership: Membership,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Param('entryId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.shopping.removeEntry(membership, listId, id);
  }

  /** Restocks the ticked-off entries named and takes them off the list; 409 if the list changed. */
  @Post(':listId/put-away')
  @HttpCode(HttpStatus.OK)
  putAway(
    @CurrentMembership() membership: Membership,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: PutAwayShoppingListEntriesDto,
  ): Promise<PantryItem[]> {
    return this.shopping.putAway(membership, listId, dto);
  }
}
