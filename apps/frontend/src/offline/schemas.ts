import type {
  PantryItem,
  PantryLocation,
  ShoppingList,
  ShoppingListEntry,
} from '@pantry-pal/shared';
import type { RxJsonSchema } from 'rxdb/plugins/core';

/*
 * The mirror's collections hold the API's wire shapes as they are, so a pulled
 * document is stored unchanged and a pushed one is exactly what the server
 * reads. RxDB adds its own fields (`_deleted`, `_rev`, `_meta`) beside these.
 *
 * A schema change needs `version` raised and a migration strategy, or RxDB
 * refuses to open the old database; since the server can always resend
 * everything, the simpler path is a new database name (`MIRROR_VERSION`).
 */

const ID = { type: 'string', maxLength: 36 } as const;
const TEXT = { type: 'string' } as const;
const NULLABLE_TEXT = { type: ['string', 'null'] } as const;
const INSTANT = { type: 'string' } as const;

export const itemSchema: RxJsonSchema<PantryItem> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: ID,
    householdId: ID,
    locationId: ID,
    productId: { type: ['string', 'null'] },
    name: TEXT,
    category: TEXT,
    isEdible: { type: 'boolean' },
    quantity: { type: 'integer' },
    unit: TEXT,
    sizeValue: { type: ['number', 'null'] },
    sizeUnit: NULLABLE_TEXT,
    expiresAt: NULLABLE_TEXT,
    openedAt: NULLABLE_TEXT,
    periodAfterOpeningDays: { type: ['integer', 'null'] },
    effectiveExpiresAt: NULLABLE_TEXT,
    notes: NULLABLE_TEXT,
    status: TEXT,
    defaultShoppingListId: { type: ['string', 'null'] },
    createdAt: INSTANT,
    updatedAt: INSTANT,
  },
  required: ['id', 'householdId', 'locationId', 'name', 'category', 'quantity', 'unit', 'status'],
};

export const locationSchema: RxJsonSchema<PantryLocation> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: ID,
    householdId: ID,
    name: TEXT,
    icon: NULLABLE_TEXT,
    sortOrder: { type: 'integer' },
    isFallback: { type: 'boolean' },
    createdAt: INSTANT,
    updatedAt: INSTANT,
  },
  required: ['id', 'householdId', 'name', 'sortOrder', 'isFallback'],
};

export const shoppingListSchema: RxJsonSchema<ShoppingList> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: ID,
    householdId: ID,
    name: TEXT,
    sortOrder: { type: 'integer' },
    archivedAt: NULLABLE_TEXT,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  },
  required: ['id', 'householdId', 'name', 'sortOrder'],
};

export const shoppingEntrySchema: RxJsonSchema<ShoppingListEntry> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: ID,
    householdId: ID,
    listId: ID,
    itemId: ID,
    quantity: { type: 'integer' },
    checkedAt: NULLABLE_TEXT,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  },
  required: ['id', 'householdId', 'listId', 'itemId', 'quantity'],
};
