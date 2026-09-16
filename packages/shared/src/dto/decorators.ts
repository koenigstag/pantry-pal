import { Transform } from 'class-transformer';
import { IsISO8601, Matches, ValidateIf } from 'class-validator';

/**
 * Skips validation only when the property is absent.
 *
 * `@IsOptional()` also waves `null` through, which is right for a nullable
 * column ("clear the notes") but wrong for a required one: `{ name: null }` in
 * a PATCH would pass validation and then fail the NOT NULL constraint as a 500.
 * With this, `null` still meets the rules that follow and is rejected by them.
 */
export function IsOmittable(): PropertyDecorator {
  return ValidateIf((_object, value) => value !== undefined);
}

/** Trims strings before validation, so `"  "` fails a minimum length of 1. */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

/** Trims and lowercases, matching how emails are stored. */
export function NormalizeEmail(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date, `YYYY-MM-DD`, that exists.
 *
 * The pattern rejects timestamps, which Postgres would quietly truncate to a
 * date in the server's time zone; `strict` rejects impossible days such as
 * `2026-02-30`.
 */
export function IsIsoDate(): PropertyDecorator {
  return (target, propertyKey) => {
    Matches(ISO_DATE, { message: `${String(propertyKey)} must be a date in YYYY-MM-DD format` })(
      target,
      propertyKey,
    );
    IsISO8601({ strict: true })(target, propertyKey);
  };
}
