import { desc, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { itemEvents, type ItemEventRow, type NewItemEventRow } from '../schema';

export type RecordEventInput = Omit<NewItemEventRow, 'id' | 'createdAt'>;

/** Append-only history: the activity feed, waste statistics and undo all read it. */
export class ItemEventsRepository {
  constructor(private readonly db: Database) {}

  async record(input: RecordEventInput): Promise<ItemEventRow> {
    const [row] = await this.db.insert(itemEvents).values(input).returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  listRecent(householdId: string, limit = 50): Promise<ItemEventRow[]> {
    return this.db
      .select()
      .from(itemEvents)
      .where(eq(itemEvents.householdId, householdId))
      .orderBy(desc(itemEvents.createdAt))
      .limit(limit);
  }
}
