import { BadRequestException, ConflictException, type HttpException } from '@nestjs/common';
import { findPostgresError, PG_ERROR } from '@pantry-pal/db';
import { COUNT_UNIT } from '@pantry-pal/shared';

/**
 * Messages for the constraints a client can realistically trip. Services check
 * most of these up front for a precise message; this is the safety net for
 * races and for anything they do not check.
 */
const CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  locations_household_name_idx: 'A location with this name already exists in this household',
  household_members_household_id_user_id_pk: 'That user is already a member of this household',
  units_pkey: 'A unit with this code already exists',
  items_location_household_fk: 'The location does not exist in this household',
  items_size_pair: 'sizeValue and sizeUnit must be given together',
  items_size_only_count: `sizeValue is only allowed when unit is "${COUNT_UNIT}"`,
  items_quantity_positive: 'quantity must not be negative',
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
 * request conflicts with the current state of another record.
 */
export function translateDatabaseError(error: unknown): HttpException | undefined {
  const pg = findPostgresError(error);
  if (pg === undefined) return undefined;

  const known = pg.constraint === undefined ? undefined : CONSTRAINT_MESSAGES[pg.constraint];

  switch (pg.code) {
    case PG_ERROR.UniqueViolation:
      return new ConflictException(known ?? 'A record with these values already exists');

    case PG_ERROR.ForeignKeyViolation:
      return new ConflictException(known ?? 'A related record is missing or still in use');

    case PG_ERROR.CheckViolation:
    case PG_ERROR.NotNullViolation:
    case PG_ERROR.StringDataRightTruncation:
    case PG_ERROR.NumericValueOutOfRange:
    case PG_ERROR.InvalidDatetimeFormat:
    case PG_ERROR.DatetimeFieldOverflow:
    case PG_ERROR.InvalidTextRepresentation:
      return new BadRequestException(known ?? 'A value is invalid for its field');

    default:
      return undefined;
  }
}
