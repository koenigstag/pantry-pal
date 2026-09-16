/** The SQLSTATE codes a caller is likely to want to translate into a response. */
export const PG_ERROR = {
  UniqueViolation: '23505',
  ForeignKeyViolation: '23503',
  NotNullViolation: '23502',
  CheckViolation: '23514',
  StringDataRightTruncation: '22001',
  NumericValueOutOfRange: '22003',
  InvalidDatetimeFormat: '22007',
  DatetimeFieldOverflow: '22008',
  InvalidTextRepresentation: '22P02',
} as const;

export type PgErrorCode = (typeof PG_ERROR)[keyof typeof PG_ERROR];

export interface PostgresErrorInfo {
  /** SQLSTATE, e.g. `23505`. */
  code: string;
  message: string;
  /** Present for constraint violations: the name to map to a user-facing message. */
  constraint: string | undefined;
  table: string | undefined;
  column: string | undefined;
  detail: string | undefined;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Finds the Postgres error behind a failed query, if there is one.
 *
 * Drizzle wraps driver errors in `DrizzleQueryError` and keeps the original as
 * `cause`, so the SQLSTATE is at least one level down. This walks the cause
 * chain and recognises the driver error by shape rather than by importing
 * `pg`'s `DatabaseError` — callers need no driver dependency, and a second layer
 * of wrapping costs nothing.
 */
export function findPostgresError(error: unknown): PostgresErrorInfo | undefined {
  const seen = new Set<unknown>();
  let current = error;

  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);

    const candidate = current as Record<string, unknown>;
    if (
      typeof candidate['code'] === 'string' &&
      SQLSTATE.test(candidate['code']) &&
      typeof candidate['severity'] === 'string'
    ) {
      const text = (key: string): string | undefined =>
        typeof candidate[key] === 'string' ? candidate[key] : undefined;

      return {
        code: candidate['code'],
        message: text('message') ?? '',
        constraint: text('constraint'),
        table: text('table'),
        column: text('column'),
        detail: text('detail'),
      };
    }

    current = candidate['cause'];
  }

  return undefined;
}
