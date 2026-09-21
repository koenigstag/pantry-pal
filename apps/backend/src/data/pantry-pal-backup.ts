import {
  COUNT_UNIT,
  DEFAULT_CATEGORY,
  FALLBACK_LOCATION_NAME,
  IMPORT_ERROR,
  IMPORT_SKIP_REASON,
  MAX_CATEGORY_CODE_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_NOTES_LENGTH,
  MAX_ITEM_QUANTITY,
  MAX_LOCATION_ICON_LENGTH,
  MAX_LOCATION_NAME_LENGTH,
  MAX_PERIOD_AFTER_OPENING_DAYS,
  MAX_SIZE_VALUE,
  MAX_UNIT_CODE_LENGTH,
  type ImportSkippedRow,
  type ImportSkipReason,
} from '@pantry-pal/shared';
import type { Workbook, Worksheet } from 'exceljs';

import {
  ABOUT_KEY,
  BACKUP_FORMAT,
  BACKUP_SHEET,
  BACKUP_VERSION,
  ITEM_COLUMN,
  SPACE_COLUMN,
  UNIT_COLUMN,
} from './backup-format';
import {
  clip,
  isUuid,
  nameKey,
  singleLine,
  type ImportPlan,
  type PlannedItem,
  type PlannedSpace,
  type PlannedUnit,
} from './import-plan';
import { cellData, CellValueError, ImportFileError, SheetTable, type TableRow } from './workbook';

const FULL = 100;

/** Where an item goes when the file names no storage space for it. */
const FALLBACK_SPACE: PlannedSpace = {
  key: '\u0000fallback',
  id: null,
  name: FALLBACK_LOCATION_NAME,
  icon: null,
  isFallback: true,
};

/** Reads a backup the export wrote (see `backup-format.ts`), or one edited by hand since. */
export function readBackup(workbook: Workbook): ImportPlan {
  const itemsSheet = workbook.getWorksheet(BACKUP_SHEET.Items);
  const items = itemsSheet === undefined ? undefined : new SheetTable(itemsSheet);
  if (items === undefined || !items.has(ITEM_COLUMN.Name)) {
    throw new ImportFileError(
      IMPORT_ERROR.WrongFormat,
      'This is not a Pantry Pal backup: it has no Items sheet with a Name column.',
    );
  }
  assertReadable(workbook.getWorksheet(BACKUP_SHEET.About));

  const skipped: ImportSkippedRow[] = [];
  const spaces = new SpaceList(workbook.getWorksheet(BACKUP_SHEET.Spaces), skipped);
  const read = readItems(items, spaces, skipped);
  readUnits(workbook.getWorksheet(BACKUP_SHEET.Units), read, skipped);

  return { spaces: spaces.planned(), items: [...read.values()].map(withPlainUnits), skipped };
}

/**
 * A backup says what wrote it. One without the sheet was put together by hand
 * and is read as the current format; one from a newer Pantry Pal may mean
 * something this reader would get wrong, so it is turned away.
 */
function assertReadable(about: Worksheet | undefined): void {
  if (about === undefined) return;

  const values = new Map<string, unknown>();
  about.eachRow((row) => {
    const key = cellData(row.getCell(1).value);
    if (typeof key === 'string') values.set(key.toLowerCase(), cellData(row.getCell(2).value));
  });

  const format = values.get(ABOUT_KEY.Format.toLowerCase());
  if (format !== undefined && format !== BACKUP_FORMAT) {
    throw new ImportFileError(IMPORT_ERROR.WrongFormat, 'This is not a Pantry Pal backup.');
  }
  const version = values.get(ABOUT_KEY.Version.toLowerCase());
  if (typeof version === 'number' && version > BACKUP_VERSION) {
    throw new ImportFileError(
      IMPORT_ERROR.WrongFormat,
      'This backup was made by a newer version of Pantry Pal.',
    );
  }
}

/**
 * The file's storage spaces, by id and by name, plus any an item names only by
 * name, and the fallback once an item names none.
 */
class SpaceList {
  private readonly byKey = new Map<string, PlannedSpace>();
  private readonly byName = new Map<string, PlannedSpace>();

  constructor(sheet: Worksheet | undefined, skipped: ImportSkippedRow[]) {
    if (sheet === undefined) return;

    const table = new SheetTable(sheet);
    for (const row of table.rows()) {
      const name = clip(singleLine(row.text(SPACE_COLUMN.Name) ?? ''), MAX_LOCATION_NAME_LENGTH);
      const skip = (reason: ImportSkipReason): void => {
        skipped.push({ sheet: sheet.name, row: row.rowNumber, name: name || null, reason });
      };
      if (name === '') {
        skip(IMPORT_SKIP_REASON.NoName);
        continue;
      }

      try {
        const id = idOf(row, SPACE_COLUMN.Id);
        const key = id ?? nameSpaceKey(name);
        if (this.byKey.has(key)) {
          skip(IMPORT_SKIP_REASON.InvalidValue);
          continue;
        }

        const icon = row.text(SPACE_COLUMN.Icon);
        this.add({
          key,
          id: id !== null && isUuid(id) ? id : null,
          name,
          icon: icon === null ? null : clip(icon.trim(), MAX_LOCATION_ICON_LENGTH),
          isFallback: row.boolean(SPACE_COLUMN.Fallback) ?? false,
        });
      } catch (error) {
        if (!(error instanceof CellValueError)) throw error;
        skip(IMPORT_SKIP_REASON.InvalidValue);
      }
    }
  }

  /** The space an item names: by id, else by name, else the fallback. */
  forItem(id: string | null, name: string | null): PlannedSpace {
    const byId = id === null ? undefined : this.byKey.get(id);
    if (byId !== undefined) return byId;

    const clipped = clip(singleLine(name ?? ''), MAX_LOCATION_NAME_LENGTH);
    if (clipped === '') {
      this.byKey.set(FALLBACK_SPACE.key, FALLBACK_SPACE);
      return FALLBACK_SPACE;
    }

    const byName = this.byName.get(nameKey(clipped));
    if (byName !== undefined) return byName;

    const space: PlannedSpace = {
      key: nameSpaceKey(clipped),
      id: null,
      name: clipped,
      icon: null,
      isFallback: false,
    };
    this.add(space);
    return space;
  }

  planned(): PlannedSpace[] {
    return [...this.byKey.values()];
  }

  private add(space: PlannedSpace): void {
    this.byKey.set(space.key, space);
    if (!this.byName.has(nameKey(space.name))) this.byName.set(nameKey(space.name), space);
  }
}

/** A space the file names without an id. Prefixed, so it can never pass for one. */
const nameSpaceKey = (name: string): string => `\u0000name:${nameKey(name)}`;

/** An item as read, before its units: they come from their own sheet. */
interface ReadItem {
  item: PlannedItem;
  /** The Quantity column: plain units for an item without unit rows. */
  quantity: number | null;
  hasUnitRows: boolean;
}

function readItems(
  table: SheetTable,
  spaces: SpaceList,
  skipped: ImportSkippedRow[],
): Map<string, ReadItem> {
  const items = new Map<string, ReadItem>();

  for (const row of table.rows()) {
    const name = clip(singleLine(row.text(ITEM_COLUMN.Name) ?? ''), MAX_ITEM_NAME_LENGTH);
    const skip = (reason: ImportSkipReason): void => {
      skipped.push({ sheet: table.sheet.name, row: row.rowNumber, name: name || null, reason });
    };
    if (name === '') {
      skip(IMPORT_SKIP_REASON.NoName);
      continue;
    }

    try {
      const id = idOf(row, ITEM_COLUMN.Id);
      // A row without an id still becomes an item; no unit can name it, though.
      const key = id ?? `\u0000row:${row.rowNumber}`;
      if (items.has(key)) {
        skip(IMPORT_SKIP_REASON.InvalidValue);
        continue;
      }

      const notes = row.text(ITEM_COLUMN.Notes)?.trim() ?? '';
      const fields = {
        category: codeOf(row, ITEM_COLUMN.Category, MAX_CATEGORY_CODE_LENGTH) ?? DEFAULT_CATEGORY,
        isEdible: row.boolean(ITEM_COLUMN.Edible),
        unit: codeOf(row, ITEM_COLUMN.Unit, MAX_UNIT_CODE_LENGTH) ?? COUNT_UNIT,
        ...sizeOf(row),
        notes: notes === '' ? null : clip(notes, MAX_ITEM_NOTES_LENGTH),
      };
      const quantity = row.integer(ITEM_COLUMN.Quantity, 0, Number.MAX_SAFE_INTEGER);
      // Last, once nothing can fail: a space is planned only for an item that is.
      const space = spaces.forItem(idOf(row, ITEM_COLUMN.SpaceId), row.text(ITEM_COLUMN.Space));

      items.set(key, {
        item: {
          sheet: table.sheet.name,
          row: row.rowNumber,
          id: id !== null && isUuid(id) ? id : null,
          spaceKey: space.key,
          name,
          ...fields,
          units: [],
          excessUnits: 0,
        },
        quantity,
        hasUnitRows: false,
      });
    } catch (error) {
      if (!(error instanceof CellValueError)) throw error;
      skip(IMPORT_SKIP_REASON.InvalidValue);
    }
  }

  return items;
}

function readUnits(
  sheet: Worksheet | undefined,
  items: ReadonlyMap<string, ReadItem>,
  skipped: ImportSkippedRow[],
): void {
  if (sheet === undefined) return;

  const table = new SheetTable(sheet);
  const seen = new Set<string>();
  for (const row of table.rows()) {
    const itemKey = idOf(row, UNIT_COLUMN.ItemId);
    const read = itemKey === null ? undefined : items.get(itemKey);
    const skip = (reason: ImportSkipReason): void => {
      const name = read?.item.name ?? row.text(UNIT_COLUMN.Item);
      skipped.push({ sheet: sheet.name, row: row.rowNumber, name, reason });
    };
    if (read === undefined) {
      skip(IMPORT_SKIP_REASON.UnknownItem);
      continue;
    }
    // Even one that fails below: the item's Quantity is not a stand-in for it.
    read.hasUnitRows = true;

    try {
      const id = idOf(row, UNIT_COLUMN.Id);
      if (id !== null && seen.has(id)) {
        skip(IMPORT_SKIP_REASON.InvalidValue);
        continue;
      }
      if (id !== null) seen.add(id);

      const unit: PlannedUnit = {
        id: id !== null && isUuid(id) ? id : null,
        expiresAt: row.date(UNIT_COLUMN.Expires),
        openedAt: row.date(UNIT_COLUMN.Opened),
        periodAfterOpeningDays: row.integer(
          UNIT_COLUMN.DaysAfterOpening,
          1,
          MAX_PERIOD_AFTER_OPENING_DAYS,
        ),
        fillPercent: row.integer(UNIT_COLUMN.Fill, 1, FULL) ?? FULL,
      };
      if (read.item.units.length < MAX_ITEM_QUANTITY) read.item.units.push(unit);
      else read.item.excessUnits += 1;
    } catch (error) {
      if (!(error instanceof CellValueError)) throw error;
      skip(IMPORT_SKIP_REASON.InvalidValue);
    }
  }
}

/**
 * An item with no unit rows at all holds as many plain units as its Quantity
 * says: how a row added by hand says how many there are.
 */
function withPlainUnits({ item, quantity, hasUnitRows }: ReadItem): PlannedItem {
  if (hasUnitRows || quantity === null || quantity === 0) return item;

  const kept = Math.min(quantity, MAX_ITEM_QUANTITY);
  const plain: PlannedUnit = {
    id: null,
    expiresAt: null,
    openedAt: null,
    periodAfterOpeningDays: null,
    fillPercent: FULL,
  };
  return {
    ...item,
    units: Array.from({ length: kept }, () => ({ ...plain })),
    excessUnits: quantity - kept,
  };
}

function idOf(row: TableRow, column: string): string | null {
  const id = row.text(column)?.trim() ?? '';
  return id === '' ? null : id;
}

/** A category or unit code, as the API spells them: lowercase. */
function codeOf(row: TableRow, column: string, max: number): string | null {
  const code = row.text(column)?.trim().toLowerCase() ?? '';
  if (code === '') return null;
  if ([...code].length > max) throw new CellValueError(column);
  return code;
}

/** Both or neither, like the item's columns; a size out of range is left out. */
function sizeOf(row: TableRow): Pick<PlannedItem, 'sizeValue' | 'sizeUnit'> {
  const value = row.number(ITEM_COLUMN.Size);
  const unit = codeOf(row, ITEM_COLUMN.SizeUnit, MAX_UNIT_CODE_LENGTH);
  if (value === null || unit === null || !(value > 0 && value <= MAX_SIZE_VALUE)) {
    return { sizeValue: null, sizeUnit: null };
  }
  return { sizeValue: Math.round(value * 1000) / 1000, sizeUnit: unit };
}
