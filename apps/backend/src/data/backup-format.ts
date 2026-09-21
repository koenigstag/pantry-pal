/*
 * The Pantry Pal backup: the .xlsx the export writes and the `pantry-pal`
 * import reads back. The sheet names and the English headers are the format;
 * the order of columns is not, so a sheet edited by hand reads the same.
 *
 *   Pantry Pal       Format, Version, Household and Exported, a key in A and its value in B
 *   Storage spaces   ID, Name, Icon, Fallback — in the household's order
 *   Items            ID, Name, Storage space ID, Storage space, Category, Edible,
 *                    Unit, Size, Size unit, Quantity, Notes
 *   Units            ID, Item ID, Item, Expires, Opened, Days after opening, Fill %
 *
 * It holds what is on the shelves: the active items and their active units.
 * Categories and units are codes (`dairy`, `pcs`), as the API names them. The
 * item and storage space names beside the ids, and an item's Quantity, are for
 * people reading the file; the import follows the ids, and falls back on the
 * names only where an id is missing, so rows added by hand work too.
 */

export const BACKUP_FORMAT = 'pantry-pal-backup';
/** Goes up when the format changes in a way an older reader would misread. */
export const BACKUP_VERSION = 1;

export const BACKUP_SHEET = {
  About: 'Pantry Pal',
  Spaces: 'Storage spaces',
  Items: 'Items',
  Units: 'Units',
} as const;

export const ABOUT_KEY = {
  Format: 'Format',
  Version: 'Version',
  Household: 'Household',
  Exported: 'Exported',
} as const;

export const SPACE_COLUMN = {
  Id: 'ID',
  Name: 'Name',
  Icon: 'Icon',
  Fallback: 'Fallback',
} as const;

export const ITEM_COLUMN = {
  Id: 'ID',
  Name: 'Name',
  SpaceId: 'Storage space ID',
  Space: 'Storage space',
  Category: 'Category',
  Edible: 'Edible',
  Unit: 'Unit',
  Size: 'Size',
  SizeUnit: 'Size unit',
  Quantity: 'Quantity',
  Notes: 'Notes',
} as const;

export const UNIT_COLUMN = {
  Id: 'ID',
  ItemId: 'Item ID',
  Item: 'Item',
  Expires: 'Expires',
  Opened: 'Opened',
  DaysAfterOpening: 'Days after opening',
  Fill: 'Fill %',
} as const;
