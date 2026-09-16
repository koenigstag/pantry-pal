import type { HouseholdMemberWithUserRow, HouseholdRow } from '@pantry-pal/db';
import type { Household, HouseholdMember, HouseholdRole, UserHousehold } from '@pantry-pal/shared';

export function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toUserHousehold(row: HouseholdRow, role: HouseholdRole): UserHousehold {
  return { ...toHousehold(row), role };
}

export function toHouseholdMember(row: HouseholdMemberWithUserRow): HouseholdMember {
  return {
    householdId: row.householdId,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
}
