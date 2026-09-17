import { asc, count } from 'drizzle-orm';

import type { Database } from '../client';
import {
  defaultLocations,
  defaultLocationTranslations,
  type DefaultLocationRow,
  type DefaultLocationTranslationRow,
  type NewDefaultLocationRow,
  type NewDefaultLocationTranslationRow,
} from '../schema';

export class DefaultLocationsRepository {
  constructor(private readonly db: Database) {}

  /** A new household's order. Equal positions fall back to the code, so the order is stable. */
  list(): Promise<DefaultLocationRow[]> {
    return this.db
      .select()
      .from(defaultLocations)
      .orderBy(asc(defaultLocations.sortOrder), asc(defaultLocations.code));
  }

  listTranslations(): Promise<DefaultLocationTranslationRow[]> {
    return this.db
      .select()
      .from(defaultLocationTranslations)
      .orderBy(asc(defaultLocationTranslations.code), asc(defaultLocationTranslations.locale));
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(defaultLocations);
    return row?.total ?? 0;
  }

  /**
   * Swaps the whole list: deletes every default, its translations cascading,
   * then inserts the new ones. Call it inside a transaction, or a failed insert
   * leaves no defaults at all.
   */
  async replaceAll(
    locations: readonly NewDefaultLocationRow[],
    translations: readonly NewDefaultLocationTranslationRow[],
  ): Promise<void> {
    await this.db.delete(defaultLocations);
    if (locations.length > 0) await this.db.insert(defaultLocations).values([...locations]);
    if (translations.length > 0) {
      await this.db.insert(defaultLocationTranslations).values([...translations]);
    }
  }
}
