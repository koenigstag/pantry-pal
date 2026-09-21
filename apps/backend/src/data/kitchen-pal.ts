import {
  COUNT_UNIT,
  DEFAULT_CATEGORY,
  FALLBACK_LOCATION_NAME,
  IMPORT_ERROR,
  IMPORT_SKIP_REASON,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_NOTES_LENGTH,
  MAX_ITEM_QUANTITY,
  MAX_LOCATION_NAME_LENGTH,
  MAX_SIZE_VALUE,
  type ImportSkipReason,
} from '@pantry-pal/shared';
import type { Workbook } from 'exceljs';

import {
  clip,
  nameKey,
  singleLine,
  type ImportPlan,
  type PlannedItem,
  type PlannedSpace,
  type PlannedUnit,
} from './import-plan';
import { CellValueError, ImportFileError, SheetTable, type TableRow } from './workbook';

/*
 * The inventory KitchenPal exports ("kitchen_inventory_<id>_<date>.xlsx"): one
 * sheet, one row per thing on a shelf, under English headers.
 *
 *   Product            the name
 *   Pieces             how many
 *   Quantity_metric    how much is LEFT, all pieces together, in Unit_metric
 *   Unit_metric        g, kg, ml or L
 *   Percentage_Left    how full the open piece is, as text: "50%"
 *   Expiry_date        a date cell, shown dd/mm/yyyy
 *   Shelf              the storage space, by name
 *   Category           KitchenPal's own list
 *   Brand, Store, Price, Barcode, Notes    kept in the item's notes
 *   Photo              an IMAGE() formula or "No photo"; items have no photo yet
 *
 * A real export shows what Quantity_metric means: a whisky at 20% holds 150 ml,
 * so the bottle was 750 ml, and 3 pieces at 100% hold 900 g, 300 g each. The
 * size recorded is therefore one full piece's.
 */

const COLUMN = {
  product: 'Product',
  pieces: 'Pieces',
  amount: 'Quantity_metric',
  amountUnit: 'Unit_metric',
  percentLeft: 'Percentage_Left',
  expires: 'Expiry_date',
  shelf: 'Shelf',
  category: 'Category',
  notes: 'Notes',
} as const;

/** Kept in the notes, a line each, labelled with the file's own header. */
const NOTE_COLUMNS = ['Brand', 'Store', 'Price', 'Barcode'] as const;

/**
 * KitchenPal's categories, lowercased, and the category each becomes. The rest
 * — Food Cupboard, Sweets, Non Food Items, Products Not Associated — land in the
 * default category.
 */
const CATEGORIES = new Map<string, string>([
  ['fruits', 'produce'],
  ['vegetables', 'produce'],
  ['dairy', 'dairy'],
  ['cheese', 'dairy'],
  ['meats', 'meat'],
  ['fish', 'fish'],
  ['seafood', 'fish'],
  ['bakery', 'grains'],
  ['canned foods', 'canned'],
  ['frozen foods', 'frozen'],
  ['condiments', 'spices'],
  ['beverages', 'beverages'],
]);
const NON_FOOD_CATEGORY = 'non food items';

/**
 * KitchenPal's own shelves, lowercased, which say what an uncategorised thing
 * is: every pill in an export is on Medicines under "Products Not Associated".
 */
const MEDICINE_SHELF = 'medicines';
const MEDICINE_CATEGORY = 'medicine';
const NON_FOOD_SHELVES: ReadonlySet<string> = new Set(['bathroom', MEDICINE_SHELF]);

/** Metric units by what one is in grams or millilitres. */
const METRIC_UNITS = new Map<string, { base: 'g' | 'ml'; factor: number }>([
  ['mg', { base: 'g', factor: 0.001 }],
  ['g', { base: 'g', factor: 1 }],
  ['kg', { base: 'g', factor: 1000 }],
  ['ml', { base: 'ml', factor: 1 }],
  ['cl', { base: 'ml', factor: 10 }],
  ['dl', { base: 'ml', factor: 100 }],
  ['l', { base: 'ml', factor: 1000 }],
]);
/** A size of 1000 g or more reads better in the larger unit: 1.5 kg, not 1500 g. */
const LARGER_UNIT = { g: 'kg', ml: 'l' } as const;
const FULL = 100;

/** A shelf the row does not name: the household's fallback takes it. */
const NO_SHELF: PlannedSpace = {
  key: '',
  id: null,
  name: FALLBACK_LOCATION_NAME,
  icon: null,
  isFallback: true,
};

export function readKitchenPal(workbook: Workbook): ImportPlan {
  const sheet = workbook.worksheets[0];
  const table = sheet === undefined ? undefined : new SheetTable(sheet);
  if (table === undefined || !table.has(COLUMN.product) || !table.has(COLUMN.pieces)) {
    throw new ImportFileError(
      IMPORT_ERROR.WrongFormat,
      'This is not a KitchenPal export: its first sheet has no Product and Pieces columns.',
    );
  }

  const spaces = new Map<string, PlannedSpace>();
  const plan: ImportPlan = { spaces: [], items: [], skipped: [] };

  for (const row of table.rows()) {
    const product = row.text(COLUMN.product);
    const name = product === null ? '' : clip(singleLine(product), MAX_ITEM_NAME_LENGTH);

    let read: PlannedItem | ImportSkipReason;
    try {
      read = name === '' ? IMPORT_SKIP_REASON.NoName : readRow(row, table, name, spaces);
    } catch (error) {
      if (!(error instanceof CellValueError)) throw error;
      read = IMPORT_SKIP_REASON.InvalidValue;
    }

    if (typeof read === 'string') {
      plan.skipped.push({
        sheet: table.sheet.name,
        row: row.rowNumber,
        name: name || null,
        reason: read,
      });
    } else {
      plan.items.push(read);
    }
  }

  plan.spaces = [...spaces.values()];
  return plan;
}

function readRow(
  row: TableRow,
  table: SheetTable,
  name: string,
  spaces: Map<string, PlannedSpace>,
): PlannedItem | ImportSkipReason {
  const pieces = row.number(COLUMN.pieces);
  if (pieces === null || pieces <= 0) return IMPORT_SKIP_REASON.NoQuantity;

  // The open piece, unless it is full (every piece is then) or empty (there is none).
  const fill = percentLeft(row);
  const count = Math.ceil(pieces);
  const full = fill === FULL ? count : count - 1;
  const open = fill > 0 && fill < FULL ? 1 : 0;
  if (full + open === 0) return IMPORT_SKIP_REASON.NothingLeft;

  const expiresAt = row.date(COLUMN.expires);
  const unit = (fillPercent: number): PlannedUnit => ({
    id: null,
    expiresAt,
    openedAt: null,
    periodAfterOpeningDays: null,
    fillPercent,
  });
  // The open one first, so the limit never cuts it: it is the one in use.
  const kept = Math.min(full + open, MAX_ITEM_QUANTITY);
  const units = [
    ...(open === 1 ? [unit(fill)] : []),
    ...Array.from({ length: kept - open }, () => unit(FULL)),
  ];

  const shelf = clip(singleLine(row.text(COLUMN.shelf) ?? ''), MAX_LOCATION_NAME_LENGTH);
  const space = spaceFor(shelf, spaces);

  return {
    sheet: table.sheet.name,
    row: row.rowNumber,
    id: null,
    spaceKey: space.key,
    name,
    ...categoryOf(row.text(COLUMN.category), shelf),
    unit: COUNT_UNIT,
    ...sizeOf(row, full + (open * fill) / FULL),
    notes: notesOf(row, table),
    units,
    excessUnits: full + open - kept,
  };
}

/**
 * How full the open piece is, 0–100. Written as text, "50%"; a cell formatted
 * as a percentage holds the fraction instead, 0.5.
 */
function percentLeft(row: TableRow): number {
  const value = row.value(COLUMN.percentLeft);
  if (value === null) return FULL;

  let percent = Number.NaN;
  if (typeof value === 'number') {
    percent = value <= 1 ? value * FULL : value;
  } else if (typeof value === 'string') {
    const match = /^(\d+(?:[.,]\d+)?)\s*(%?)$/.exec(value);
    if (match?.[1] !== undefined) {
      const number = Number(match[1].replace(',', '.'));
      percent = match[2] === '%' || number > 1 ? number : number * FULL;
    }
  }

  if (!(percent >= 0 && percent <= FULL)) throw new CellValueError(COLUMN.percentLeft);
  return Math.round(percent);
}

/**
 * One full piece: what is left, over how many full pieces that makes — the
 * full ones, and the open one's fraction. `null` without an amount or a metric
 * unit, which KitchenPal leaves out for things it does not weigh.
 */
function sizeOf(row: TableRow, fullPieces: number): Pick<PlannedItem, 'sizeValue' | 'sizeUnit'> {
  const none = { sizeValue: null, sizeUnit: null };
  const amount = row.number(COLUMN.amount);
  const unit = row.text(COLUMN.amountUnit);
  const metric = unit === null ? undefined : METRIC_UNITS.get(unit.toLowerCase());
  if (amount === null || amount <= 0 || metric === undefined || fullPieces <= 0) return none;

  const each = (amount * metric.factor) / fullPieces;
  const [value, code] =
    each >= 1000 ? [each / 1000, LARGER_UNIT[metric.base]] : [each, metric.base];
  // `numeric(10, 3)`: three decimals, as the DTOs allow.
  const sizeValue = Math.round(value * 1000) / 1000;
  return sizeValue > 0 && sizeValue <= MAX_SIZE_VALUE ? { sizeValue, sizeUnit: code } : none;
}

function categoryOf(
  kitchenPalCategory: string | null,
  shelf: string,
): Pick<PlannedItem, 'category' | 'isEdible'> {
  const category = (kitchenPalCategory ?? '').toLowerCase();
  const mapped = CATEGORIES.get(category);
  if (mapped !== undefined) return { category: mapped, isEdible: null };

  const shelfKey = nameKey(shelf);
  if (shelfKey === MEDICINE_SHELF) return { category: MEDICINE_CATEGORY, isEdible: null };

  const nonFood = category === NON_FOOD_CATEGORY || NON_FOOD_SHELVES.has(shelfKey);
  return { category: DEFAULT_CATEGORY, isEdible: nonFood ? false : null };
}

/** The row's notes, then a line for each of brand, store, price and barcode it has. */
function notesOf(row: TableRow, table: SheetTable): string | null {
  const lines = [row.text(COLUMN.notes)?.trim() ?? ''];
  for (const column of NOTE_COLUMNS) {
    const value = row.text(column);
    if (value !== null) lines.push(`${table.header(column)}: ${singleLine(value)}`);
  }

  const notes = lines.filter((line) => line !== '').join('\n');
  return notes === '' ? null : clip(notes, MAX_ITEM_NOTES_LENGTH);
}

/** The space for a shelf, by name: one per distinct shelf, in the order they come up. */
function spaceFor(shelf: string, spaces: Map<string, PlannedSpace>): PlannedSpace {
  if (shelf === '') {
    if (!spaces.has(NO_SHELF.key)) spaces.set(NO_SHELF.key, NO_SHELF);
    return NO_SHELF;
  }

  const key = nameKey(shelf);
  const known = spaces.get(key);
  if (known !== undefined) return known;

  const space: PlannedSpace = { key, id: null, name: shelf, icon: null, isFallback: false };
  spaces.set(key, space);
  return space;
}
