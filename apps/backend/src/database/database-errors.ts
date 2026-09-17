import { BadRequestException, ConflictException, type HttpException } from '@nestjs/common';
import { findPostgresError, PG_ERROR } from '@pantry-pal/db';
import { COUNT_UNIT } from '@pantry-pal/shared';

/**
 * Messages for the constraints a client can realistically trip. Services check
 * most of these up front for a precise message; this is the safety net for
 * races and for anything they do not check.
 */
const CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  users_email_unique: 'An account with this email already exists',
  locations_household_name_idx: 'A location with this name already exists in this household',
  locations_household_fallback_idx: 'A household has only one fallback location',
  locations_fallback_not_deleted: "The household's fallback location cannot be deleted",
  household_members_household_id_user_id_pk: 'That user is already a member of this household',
  units_pkey: 'A unit with this code already exists',
  categories_pkey: 'A category with this code already exists',
  items_category_fk: 'The category does not exist, or is still used by items',
  products_default_category_fk: 'The category does not exist, or is still used by products',
  items_location_household_fk: 'The location does not exist in this household',
  items_size_pair: 'sizeValue and sizeUnit must be given together',
  items_unit_count_fk: `unit must be a count unit such as "${COUNT_UNIT}", and a count unit in use can be neither deleted nor given another kind`,
  items_quantity_positive: 'quantity must not be negative',
  items_default_shopping_list_household_fk:
    "The shopping list does not exist in this household, or is still some item's default",
  shopping_lists_household_name_idx:
    'A shopping list with this name already exists in this household',
  shopping_list_entries_list_household_fk: 'The shopping list does not exist in this household',
  shopping_list_entries_item_household_fk: 'The item does not exist in this household',
  shopping_list_entries_list_item_idx: 'The item is already on this shopping list',
  shopping_list_entries_quantity_positive: 'quantity must be at least 1',
};

/**
 * Maps a Postgres error to the HTTP exception a client should see, or
 * `undefined` for anything that is not a client's fault — those stay a 500.
 *
 * Used by both the HTTP and the WebSocket exception filters: global filters do
 * not apply to gateways in Nest, so each transport needs its own entry point.
 *
 * Foreign-key violations are all 409. The same constraint fires both for
 * "still referenced" (deleting something in use) and for "not present" (a
 * reference that vanished under a concurrent delete), and in both cases the
 * request conflicts with the current state of another record. A key declared
 * `ON DELETE RESTRICT` reports the former as its own SQLSTATE.
 */
export function translateDatabaseError(error: unknown): HttpException | undefined {
  const pg = findPostgresError(error);
  if (pg === undefined) return undefined;

  const known = pg.constraint === undefined ? undefined : CONSTRAINT_MESSAGES[pg.constraint];

  switch (pg.code) {
    case PG_ERROR.UniqueViolation:
      return new ConflictException(known ?? 'A record with these values already exists');

    case PG_ERROR.ForeignKeyViolation:
    case PG_ERROR.RestrictViolation:
      return new ConflictException(known ?? 'A related record is missing or still in use');

    case PG_ERROR.CheckViolation:
    case PG_ERROR.NotNullViolation:
    case PG_ERROR.StringDataRightTruncation:
    case PG_ERROR.NumericValueOutOfRange:
    case PG_ERROR.InvalidDatetimeFormat:
    case PG_ERROR.DatetimeFieldOverflow:
    case PG_ERROR.InvalidTextRepresentation:
      return new BadRequestException(known ?? 'A value is invalid for its field');

    // Rolled back whole, so nothing was written: the client can send it again.
    case PG_ERROR.DeadlockDetected:
      return new ConflictException('Another change to the same data got in the way. Try again.');

    default:
      return undefined;
  }
}
