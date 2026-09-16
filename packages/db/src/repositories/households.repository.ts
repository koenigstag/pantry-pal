import type { HouseholdRole } from '@pantry-pal/shared';
import { asc, eq, getTableColumns } from 'drizzle-orm';

import type { Database } from '../client';
import { householdMembers, households, type HouseholdRow } from '../schema';

export type HouseholdWithRoleRow = HouseholdRow & { role: HouseholdRole };

export class HouseholdsRepository {
  constructor(private readonly db: Database) {}

  /** Every household the user belongs to, with their role in each, oldest first. */
  listForUser(userId: string): Promise<HouseholdWithRoleRow[]> {
    return this.db
      .select({ ...getTableColumns(households), role: householdMembers.role })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(eq(householdMembers.userId, userId))
      .orderBy(asc(households.createdAt), asc(households.id));
  }

  async findById(id: string): Promise<HouseholdRow | undefined> {
    const [row] = await this.db.select().from(households).where(eq(households.id, id)).limit(1);
    return row;
  }

  async create(input: { name: string; createdBy: string }): Promise<HouseholdRow> {
    const [row] = await this.db.insert(households).values(input).returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  async rename(id: string, name: string): Promise<HouseholdRow | undefined> {
    const [row] = await this.db
      .update(households)
      .set({ name })
      .where(eq(households.id, id))
      .returning();

    return row;
  }

  /** Hard delete: members, locations, products, items and their history all cascade. */
  async delete(id: string): Promise<HouseholdRow | undefined> {
    const [row] = await this.db.delete(households).where(eq(households.id, id)).returning();
    return row;
  }

  /**
   * Row-locks the household until the transaction ends; `false` if it does not exist.
   *
   * The mutex for changes that read before they write across several rows: "is
   * this the last owner?", "what is the next sort order?". Without it, two owners
   * demoting each other at once would each still see two owners.
   *
   * `FOR NO KEY UPDATE`, not `FOR UPDATE`: it serialises these callers without
   * blocking the `FOR KEY SHARE` lock every insert referencing the household
   * takes, so adding items is never held up.
   */
  async lock(id: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .for('no key update');

    return rows.length > 0;
  }
}
