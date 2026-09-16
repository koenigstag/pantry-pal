import { asc, eq, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { appSettings, type AppSettingRow } from '../schema';

/**
 * Raw key -> jsonb access. Knows nothing about which keys exist or what shape
 * their values take: the backend's settings service owns that, and validates
 * in both directions.
 */
export class AppSettingsRepository {
  constructor(private readonly db: Database) {}

  list(): Promise<AppSettingRow[]> {
    return this.db.select().from(appSettings).orderBy(asc(appSettings.key));
  }

  async find(key: string): Promise<AppSettingRow | undefined> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return row;
  }

  async upsert(key: string, value: unknown): Promise<AppSettingRow> {
    const [row] = await this.db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: sql`excluded.value` },
      })
      .returning();

    if (row === undefined) throw new Error('Upsert returned no row');
    return row;
  }

  /** Back to the code default. */
  async delete(key: string): Promise<AppSettingRow | undefined> {
    const [row] = await this.db.delete(appSettings).where(eq(appSettings.key, key)).returning();
    return row;
  }
}
