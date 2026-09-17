import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  ValidateNested,
} from 'class-validator';

import {
  MAX_ITEM_QUANTITY,
  MAX_SHOPPING_LIST_BATCH,
  MAX_SHOPPING_LIST_NAME_LENGTH,
  MAX_SHOPPING_LISTS_PER_HOUSEHOLD,
} from '../constants';
import { IsOmittable, Trim } from './decorators';

/** Appended after the household's last list. Names are unique within a household, ignoring case. */
export class CreateShoppingListDto {
  @Trim()
  @IsString()
  @Length(1, MAX_SHOPPING_LIST_NAME_LENGTH)
  name!: string;
}

/** A list's name. Archiving goes through the editor's `UpsertShoppingListsDto`. */
export class UpdateShoppingListDto {
  @Trim()
  @IsString()
  @Length(1, MAX_SHOPPING_LIST_NAME_LENGTH)
  name!: string;
}

/** One row of the shopping lists editor. */
export class UpsertShoppingListDto {
  /** Present: that existing list. Omitted: a new one. `null` is rejected. */
  @IsOmittable()
  @IsUUID()
  id?: string;

  @Trim()
  @IsString()
  @Length(1, MAX_SHOPPING_LIST_NAME_LENGTH)
  name!: string;

  /** Archived lists are frozen and hidden until restored with `false`. */
  @IsBoolean()
  archived!: boolean;
}

/** Case-insensitive name for `ArrayUnique`; a malformed row is left to its own rules. */
function lowerCaseName(row: unknown): unknown {
  return typeof row === 'object' && row !== null && 'name' in row && typeof row.name === 'string'
    ? row.name.toLowerCase()
    : row;
}

/**
 * Everything the shopping lists editor changed, saved in one transaction:
 * additions, renames, archiving and restoring, deletions, and the order.
 *
 * `lists` is the new display order: existing lists by id, new ones without.
 * Together with `removed` it must name every list of the household, archived
 * ones included, exactly once — so a client that edited a stale set is refused
 * (409) rather than undoing another member's change. It may be empty when
 * every list is deleted.
 *
 * Names are unique ignoring case, archived lists included, checked over the
 * whole set so two lists can swap names in one save.
 */
export class UpsertShoppingListsDto {
  @IsArray()
  @ArrayMaxSize(MAX_SHOPPING_LISTS_PER_HOUSEHOLD)
  @ArrayUnique(lowerCaseName, { message: 'lists must not repeat a name, ignoring case' })
  @ValidateNested({ each: true })
  @Type(() => UpsertShoppingListDto)
  lists!: UpsertShoppingListDto[];

  /** Deleted with everything on them. Omitted: nothing is deleted. */
  @IsOmittable()
  @IsArray()
  @ArrayMaxSize(MAX_SHOPPING_LISTS_PER_HOUSEHOLD)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  removed?: string[];
}

/**
 * Puts items on a list. An item already on it is left as it is — its quantity,
 * and whether it is ticked off — so adding the same selection twice changes
 * nothing.
 */
export class AddShoppingListEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHOPPING_LIST_BATCH)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  itemIds!: string[];

  /** How many of each to buy, in each item's own unit. Omitted: one. */
  @IsOmittable()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(MAX_ITEM_QUANTITY)
  quantity?: number;
}

/** An absent field is left alone. */
export class UpdateShoppingListEntryDto {
  @IsOmittable()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(MAX_ITEM_QUANTITY)
  quantity?: number;

  /** Ticked off while shopping, or back to still to buy. */
  @IsOmittable()
  @IsBoolean()
  checked?: boolean;
}

/**
 * Brings ticked-off entries home: each item is restocked in storage and its
 * entry leaves the list. Every id must name an entry of the list that is still
 * ticked off; otherwise nothing happens and the answer is 409, since the client
 * acted on a list that has changed.
 */
export class PutAwayShoppingListEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHOPPING_LIST_BATCH)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  entryIds!: string[];
}
