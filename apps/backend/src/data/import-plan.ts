import type { ImportSkippedRow } from '@pantry-pal/shared';

/**
 * What a file holds, in the shape the household keeps things, before anything
 * is written. Each source's parser builds one from a workbook; `ImportService`
 * writes it, matching what the household has already. Parsers never touch the
 * database, so a file that cannot be read fails before the transaction opens.
 */
export interface ImportPlan {
  spaces: PlannedSpace[];
  items: PlannedItem[];
  /** Rows the parser left out, and why. */
  skipped: ImportSkippedRow[];
}

/** A storage space the file names. */
export interface PlannedSpace {
  /** How the file's items name it: unique within the plan. */
  key: string;
  /** A backup's id for it, matched against the household's. `null` from other sources. */
  id: string | null;
  name: string;
  icon: string | null;
  /** The file's catch-all, which maps onto the household's fallback. */
  isFallback: boolean;
}

export interface PlannedItem {
  /** Where it came from, for the summary. */
  sheet: string;
  row: number;
  /** A backup's id for it, matched against the household's. `null` from other sources. */
  id: string | null;
  spaceKey: string;
  name: string;
  /** A category code; one the server does not have becomes the default category. */
  category: string;
  /** Read in the default category only, where each item decides; `null` takes the category's. */
  isEdible: boolean | null;
  /** A count unit's code; anything else becomes `pcs`. */
  unit: string;
  sizeValue: number | null;
  sizeUnit: string | null;
  notes: string | null;
  units: PlannedUnit[];
  /** Units the file lists beyond `MAX_ITEM_QUANTITY`, left out already. */
  excessUnits: number;
}

export interface PlannedUnit {
  /** A backup's id, so a unit the household holds already is not added again. */
  id: string | null;
  expiresAt: string | null;
  /** `null` with a fill under 100 takes the day of the import: a used unit was opened. */
  openedAt: string | null;
  periodAfterOpeningDays: number | null;
  /** 1–100. */
  fillPercent: number;
}

/** Trimmed, with every run of whitespace one space: names are one line. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** How names compare: ignoring case, surrounding space and doubled spaces. */
export function nameKey(name: string): string {
  return singleLine(name).normalize('NFC').toLowerCase();
}

/**
 * At most `max` characters, as Postgres counts them for a `varchar`: code
 * points, so an emoji is never cut in half.
 */
export function clip(text: string, max: number): string {
  const characters = [...text];
  return characters.length <= max ? text : characters.slice(0, max).join('').trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A file's id is looked up in the database only if it is a UUID; any other is the file's own. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
