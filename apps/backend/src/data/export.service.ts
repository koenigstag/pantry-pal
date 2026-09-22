import { Injectable, NotFoundException } from '@nestjs/common';
import {
  HouseholdsRepository,
  ItemsRepository,
  LocationsRepository,
  Transactional,
  type SubItemRow,
} from '@pantry-pal/db';
import { Workbook, type Column, type Worksheet } from 'exceljs';

import type { Membership } from '../common/request-context';
import {
  ABOUT_KEY,
  BACKUP_FORMAT,
  BACKUP_SHEET,
  BACKUP_VERSION,
  ITEM_COLUMN,
  SPACE_COLUMN,
  UNIT_COLUMN,
} from './backup-format';

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface Backup {
  filename: string;
  content: Buffer;
}

/** How a column is laid out: its header, its row object key, its width and how it shows. */
type ColumnSpec = Pick<Column, 'header' | 'key' | 'width'> & { numFmt?: string };

const DATE_FORMAT = 'yyyy-mm-dd';
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Writes a household's backup: the .xlsx `backup-format.ts` describes, which
 * the `pantry-pal` import reads back.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly locations: LocationsRepository,
    private readonly items: ItemsRepository,
  ) {}

  /** Read in one snapshot, so the sheets agree: no unit of an item another sheet lacks. */
  @Transactional({ isolationLevel: 'repeatable read' })
  async backup(membership: Membership): Promise<Backup> {
    const { householdId } = membership;
    const household = await this.households.findById(householdId);
    if (household === undefined) throw new NotFoundException('Household not found');

    const locations = await this.locations.list(householdId);
    const items = await this.items.listActive(householdId);
    const units = await this.items.listActiveUnits(householdId);
    const exportedAt = new Date();

    // Items in the household's order: by storage space, then by name.
    const position = new Map(locations.map((location, index) => [location.id, index]));
    const locationName = new Map(locations.map((location) => [location.id, location.name]));
    items.sort(
      (a, b) =>
        (position.get(a.locationId) ?? Infinity) - (position.get(b.locationId) ?? Infinity) ||
        nameCollator.compare(a.name, b.name),
    );
    const unitsOf = new Map<string, SubItemRow[]>();
    for (const unit of units) unitsOf.set(unit.itemId, [...(unitsOf.get(unit.itemId) ?? []), unit]);

    const workbook = new Workbook();
    workbook.creator = 'Pantry Pal';
    workbook.created = exportedAt;

    const about = workbook.addWorksheet(BACKUP_SHEET.About);
    about.columns = [{ width: 14 }, { width: 40 }];
    about.addRows([
      [ABOUT_KEY.Format, BACKUP_FORMAT],
      [ABOUT_KEY.Version, BACKUP_VERSION],
      [ABOUT_KEY.Household, household.name],
      [ABOUT_KEY.Exported, exportedAt.toISOString()],
    ]);
    about.getColumn(1).font = { bold: true };

    addTable(
      workbook,
      BACKUP_SHEET.Spaces,
      [
        { header: SPACE_COLUMN.Id, key: 'id', width: 38 },
        { header: SPACE_COLUMN.Name, key: 'name', width: 24 },
        { header: SPACE_COLUMN.Icon, key: 'icon', width: 14 },
        { header: SPACE_COLUMN.Fallback, key: 'fallback', width: 10 },
      ],
      locations.map((location) => ({
        id: location.id,
        name: location.name,
        icon: location.icon,
        fallback: location.isFallback,
      })),
    );

    addTable(
      workbook,
      BACKUP_SHEET.Items,
      [
        { header: ITEM_COLUMN.Id, key: 'id', width: 38 },
        { header: ITEM_COLUMN.Name, key: 'name', width: 32 },
        { header: ITEM_COLUMN.SpaceId, key: 'spaceId', width: 38 },
        { header: ITEM_COLUMN.Space, key: 'space', width: 20 },
        { header: ITEM_COLUMN.Category, key: 'category', width: 14 },
        { header: ITEM_COLUMN.Edible, key: 'edible', width: 8 },
        { header: ITEM_COLUMN.Unit, key: 'unit', width: 8 },
        { header: ITEM_COLUMN.Size, key: 'size', width: 8 },
        { header: ITEM_COLUMN.SizeUnit, key: 'sizeUnit', width: 9 },
        { header: ITEM_COLUMN.Quantity, key: 'quantity', width: 9 },
        { header: ITEM_COLUMN.Notes, key: 'notes', width: 40 },
      ],
      items.map((item) => ({
        id: item.id,
        name: item.name,
        spaceId: item.locationId,
        space: locationName.get(item.locationId) ?? null,
        category: item.category,
        edible: item.isEdible,
        unit: item.unit,
        size: item.sizeValue,
        sizeUnit: item.sizeUnit,
        quantity: item.quantity,
        notes: item.notes,
      })),
    );

    addTable(
      workbook,
      BACKUP_SHEET.Units,
      [
        { header: UNIT_COLUMN.Id, key: 'id', width: 38 },
        { header: UNIT_COLUMN.ItemId, key: 'itemId', width: 38 },
        { header: UNIT_COLUMN.Item, key: 'item', width: 32 },
        { header: UNIT_COLUMN.Expires, key: 'expires', width: 12, numFmt: DATE_FORMAT },
        { header: UNIT_COLUMN.Opened, key: 'opened', width: 12, numFmt: DATE_FORMAT },
        { header: UNIT_COLUMN.DaysAfterOpening, key: 'daysAfterOpening', width: 18 },
        { header: UNIT_COLUMN.Fill, key: 'fill', width: 8 },
      ],
      items.flatMap((item) =>
        (unitsOf.get(item.id) ?? []).map((unit) => ({
          id: unit.id,
          itemId: item.id,
          item: item.name,
          expires: dateCell(unit.expiresAt),
          opened: dateCell(unit.openedAt),
          daysAfterOpening: unit.periodAfterOpeningDays,
          fill: unit.fillPercent,
        })),
      ),
    );

    return {
      filename: `pantry-pal-backup-${exportedAt.toISOString().slice(0, 10)}.xlsx`,
      content: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
}

/** A sheet with a bold header that stays in view while scrolling. */
function addTable(
  workbook: Workbook,
  name: string,
  columns: readonly ColumnSpec[],
  rows: readonly Record<string, unknown>[],
): Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(({ numFmt, ...column }) => ({
    ...column,
    ...(numFmt === undefined ? {} : { style: { numFmt } }),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows([...rows]);
  return sheet;
}

/**
 * A calendar date as a date cell, so a spreadsheet shows and sorts it as one.
 * `YYYY-MM-DD` parses as UTC midnight, which exceljs writes as that day's
 * serial number whatever the server's time zone.
 */
function dateCell(date: string | null): Date | null {
  return date === null ? null : new Date(date);
}
