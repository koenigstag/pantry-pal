import type { ItemRow } from '@pantry-pal/db';
import type { PantryItem } from '@pantry-pal/shared';

export function toPantryItem(row: ItemRow): PantryItem {
  return {
    id: row.id,
    householdId: row.householdId,
    locationId: row.locationId,
    productId: row.productId,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    sizeValue: row.sizeValue,
    sizeUnit: row.sizeUnit,
    expiresAt: row.expiresAt,
    openedAt: row.openedAt,
    periodAfterOpeningDays: row.periodAfterOpeningDays,
    effectiveExpiresAt: row.effectiveExpiresAt,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
