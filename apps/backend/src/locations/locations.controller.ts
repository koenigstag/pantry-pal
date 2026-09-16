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
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PantryLocation } from '@pantry-pal/shared';
import {
  CreateLocationDto,
  DeleteLocationQueryDto,
  ReorderLocationsDto,
  UpdateLocationDto,
} from '@pantry-pal/shared/dto';

import { CurrentMembership, type Membership } from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { LocationsService } from './locations.service';

@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId/locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  /** In display order. */
  @Get()
  list(@CurrentMembership() membership: Membership): Promise<PantryLocation[]> {
    return this.locations.list(membership);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateLocationDto,
  ): Promise<PantryLocation> {
    return this.locations.create(membership, dto);
  }

  /**
   * Replaces the order of all locations; returns them in the new order.
   * Declared before the `:locationId` routes so `order` is never read as an id.
   */
  @Put('order')
  reorder(
    @CurrentMembership() membership: Membership,
    @Body() dto: ReorderLocationsDto,
  ): Promise<PantryLocation[]> {
    return this.locations.reorder(membership, dto);
  }

  @Get(':locationId')
  get(
    @CurrentMembership() membership: Membership,
    @Param('locationId', ParseUUIDPipe) id: string,
  ): Promise<PantryLocation> {
    return this.locations.get(membership, id);
  }

  @Patch(':locationId')
  update(
    @CurrentMembership() membership: Membership,
    @Param('locationId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<PantryLocation> {
    return this.locations.update(membership, id, dto);
  }

  /** `?moveItemsTo=<locationId>` is required while the location holds active items. */
  @Delete(':locationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('locationId', ParseUUIDPipe) id: string,
    @Query() query: DeleteLocationQueryDto,
  ): Promise<void> {
    return this.locations.remove(membership, id, query.moveItemsTo);
  }
}
