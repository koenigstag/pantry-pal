import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * The checkpoint a pull continues from: the last document it handed out.
 *
 * `updatedAt` is the database's own value as text, to the microsecond. A JS
 * `Date` keeps milliseconds only, so a checkpoint built from one would sit just
 * before its own row, and rows sharing that millisecond could be repeated or
 * skipped.
 */
export interface SyncCheckpointRow {
  updatedAt: string;
  id: string;
}

/** One pull's slice of a collection. */
export interface SyncWindow {
  /** Where to continue; absent on a client's first pull, which starts at the beginning. */
  after?: SyncCheckpointRow;
  limit: number;
}

/** A row as `changedSince` returns it: with its exact `updated_at`, for the next checkpoint. */
export type WithSyncStamp<T> = T & { syncUpdatedAt: string };

/** `updated_at` as ISO-8601 text in UTC, microseconds included. */
export function syncStamp(updatedAt: PgColumn): SQL<string> {
  return sql<string>`to_char(${updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Rows after the checkpoint, ordered as every sync pull orders them: by when
 * they last changed, with the id breaking ties.
 *
 * The comparison is row-wise on purpose — `(updated_at, id) > (…, …)` — so two
 * rows saved in the same transaction, sharing a timestamp, are still walked
 * exactly once each. The casts spell out the parameter types, which Postgres
 * would otherwise have to infer inside the row comparison.
 */
export function syncWindowWhere(
  updatedAt: PgColumn,
  id: PgColumn,
  after: SyncCheckpointRow | undefined,
): SQL | undefined {
  if (after === undefined) return undefined;

  return sql`(${updatedAt}, ${id}) > (${after.updatedAt}::timestamptz, ${after.id}::uuid)`;
}
