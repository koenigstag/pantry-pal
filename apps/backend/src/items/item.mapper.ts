import type { ItemRow, ItemRowSubItem } from '@pantry-pal/db';
import type { PantryItem, SubItem } from '@pantry-pal/shared';

/** An item as the API serves it, with its units. */
export function toPantryItem(row: ItemRow): PantryItem {
  return { ...toItemFields(row), subItems: row.subItems.map(toSubItem) };
}

/**
 * An item without its units: the shape served before units existed, which
 * offline mirrors made then still hold (see the sync pull).
 */
export function toItemFields(row: ItemRow): Omit<PantryItem, 'subItems'> {
  return {
    id: row.id,
    householdId: row.householdId,
    locationId: row.locationId,
    productId: row.productId,
    name: row.name,
    category: row.category,
    isEdible: row.isEdible,
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
    defaultShoppingListId: row.defaultShoppingListId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSubItem(unit: ItemRowSubItem): SubItem {
  return {
    id: unit.id,
    expiresAt: unit.expiresAt,
    openedAt: unit.openedAt,
    periodAfterOpeningDays: unit.periodAfterOpeningDays,
    effectiveExpiresAt: unit.effectiveExpiresAt,
    fillPercent: unit.fillPercent,
    status: unit.status,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}
