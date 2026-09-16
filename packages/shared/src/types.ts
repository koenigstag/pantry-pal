import type { PANTRY_CATEGORIES, PANTRY_UNITS } from './constants';

export type PantryCategory = (typeof PANTRY_CATEGORIES)[number];
export type PantryUnit = (typeof PANTRY_UNITS)[number];

/**
 * The canonical pantry item as it travels over the wire.
 *
 * Dates are ISO-8601 strings rather than `Date`: JSON has no date type, so a
 * `Date` here would be a lie on the frontend after `JSON.parse`.
 */
export interface PantryItem {
  id: string;
  name: string;
  quantity: number;
  unit: PantryUnit;
  category: PantryCategory;
  /** ISO-8601 date, or `null` for non-perishables. */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExpiryStatus = 'fresh' | 'expiring-soon' | 'expired' | 'unknown';

export interface PantrySnapshotPayload {
  items: PantryItem[];
  serverTime: string;
}

export interface PantryItemPayload {
  item: PantryItem;
}

export interface PantryItemDeletedPayload {
  id: string;
}
