import type { LocationRow } from '@pantry-pal/db';
import type { PantryLocation } from '@pantry-pal/shared';

export function toPantryLocation(row: LocationRow): PantryLocation {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
