import { HOUSEHOLD_ROLE, type HouseholdRole } from '@pantry-pal/shared';
import { and, asc, count, eq, getTableColumns } from 'drizzle-orm';

import type { Database } from '../client';
import { householdMembers, users, type HouseholdMemberRow, type UserRow } from '../schema';

export type HouseholdMemberWithUserRow = HouseholdMemberRow &
  Pick<UserRow, 'email' | 'displayName'>;

export class HouseholdMembersRepository {
  constructor(private readonly db: Database) {}

  /** In joining order, so the founding owner comes first. */
  list(householdId: string): Promise<HouseholdMemberWithUserRow[]> {
    return this.selectWithUser()
      .where(eq(householdMembers.householdId, householdId))
      .orderBy(asc(householdMembers.joinedAt), asc(householdMembers.userId));
  }

  /** Every household membership of one user. */
  listForUser(userId: string): Promise<HouseholdMemberWithUserRow[]> {
    return this.selectWithUser()
      .where(eq(householdMembers.userId, userId))
      .orderBy(asc(householdMembers.joinedAt), asc(householdMembers.householdId));
  }

  async find(householdId: string, userId: string): Promise<HouseholdMemberWithUserRow | undefined> {
    const [row] = await this.selectWithUser()
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      )
      .limit(1);

    return row;
  }

  /** The membership check behind every household-scoped request: one primary-key lookup. */
  async findRole(householdId: string, userId: string): Promise<HouseholdRole | undefined> {
    const [row] = await this.db
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      )
      .limit(1);

    return row?.role;
  }

  async add(input: {
    householdId: string;
    userId: string;
    role: HouseholdRole;
  }): Promise<HouseholdMemberRow> {
    const [row] = await this.db.insert(householdMembers).values(input).returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  async updateRole(
    householdId: string,
    userId: string,
    role: HouseholdRole,
  ): Promise<HouseholdMemberRow | undefined> {
    const [row] = await this.db
      .update(householdMembers)
      .set({ role })
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      )
      .returning();

    return row;
  }

  async remove(householdId: string, userId: string): Promise<HouseholdMemberRow | undefined> {
    const [row] = await this.db
      .delete(householdMembers)
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      )
      .returning();

    return row;
  }

  /** Only meaningful under `HouseholdsRepository.lock()`; otherwise it is stale on arrival. */
  async countOwners(householdId: string): Promise<number> {
    const [row] = await this.db
      .select({ owners: count() })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.role, HOUSEHOLD_ROLE.Owner),
        ),
      );

    return row?.owners ?? 0;
  }

  private selectWithUser() {
    return this.db
      .select({
        ...getTableColumns(householdMembers),
        email: users.email,
        displayName: users.displayName,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .$dynamic();
  }
}
