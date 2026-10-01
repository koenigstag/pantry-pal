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
    ingredientId: row.ingredientId,
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

/**
 * The fields an offline mirror's items have: units since its version 2, an
 * ingredient since version 3. A mirror is served, and answered, in its own
 * shape, since its schema refuses a field it never had.
 */
export interface MirrorShape {
  withUnits: boolean;
  withIngredient: boolean;
}

/** An item as some offline mirror holds it: units and the ingredient both came later. */
export type MirroredItem = Omit<PantryItem, 'subItems' | 'ingredientId'> &
  Partial<Pick<PantryItem, 'subItems' | 'ingredientId'>>;

export function toMirroredItem(
  row: ItemRow,
  { withUnits, withIngredient }: MirrorShape,
): MirroredItem {
  const { ingredientId, ...item } = withUnits ? toPantryItem(row) : toItemFields(row);
  return withIngredient ? { ...item, ingredientId } : item;
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
