import type { ShoppingListEntryRow, ShoppingListRow } from '@pantry-pal/db';
import type { ShoppingList, ShoppingListEntry } from '@pantry-pal/shared';

export function toShoppingList(row: ShoppingListRow): ShoppingList {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toShoppingListEntry(row: ShoppingListEntryRow): ShoppingListEntry {
  return {
    id: row.id,
    householdId: row.householdId,
    listId: row.listId,
    itemId: row.itemId,
    quantity: row.quantity,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
