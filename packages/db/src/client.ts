import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: Pool;
  /** Drains the pool. Wire this to the backend's shutdown hooks. */
  close: () => Promise<void>;
}

/**
 * Builds a Drizzle client over a `pg` pool.
 *
 * The connection string is an argument and is never read from `process.env`:
 * this package stays framework- and environment-agnostic, so the backend's
 * `ConfigService` remains the one place configuration is resolved. That is also
 * what keeps the dependency direction one-way — `db` never imports from an app.
 */
export function createDatabase(
  connectionString: string,
  options: Omit<PoolConfig, 'connectionString'> = {},
): DatabaseHandle {
  const pool = new Pool({ connectionString, ...options });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
