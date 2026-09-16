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
  CreatePantryItemDto,
  ListPantryItemsQueryDto,
  UpdatePantryItemDto,
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
}
