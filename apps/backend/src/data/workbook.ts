import { IMPORT_ERROR, MAX_IMPORT_ROWS, type ImportErrorCode } from '@pantry-pal/shared';
import { Workbook, type CellValue, type Row, type Worksheet } from 'exceljs';

/**
 * A file an import turns away whole, with the code the client names it by. The
 * readers here and the source parsers throw it; the controller turns it into a
 * 400, or a 413 for `too-large`. It stays free of Nest, like the parsers.
 */
export class ImportFileError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportFileError';
  }
}

/** A value that cannot be what its column holds. The parsers skip that row. */
export class CellValueError extends Error {
  constructor(readonly column: string) {
    super(`Unreadable ${column}`);
    this.name = 'CellValueError';
  }
}

/**
 * An .xlsx is a zip of XML parts, and exceljs unpacks all of them into memory.
 * No export comes near these, while a zip bomb — a small file inflating a
 * thousandfold — goes far past them.
 */
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_RECORD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;

/**
 * Checks what the zip's central directory says it holds before anything is
 * unpacked: no directory at all is not a workbook (a CSV, a legacy .xls), and
 * too many entries or bytes is too large. A directory that lies about its
 * sizes is not caught here; the upload limit is what bounds that.
 */
function assertPlausibleZip(buffer: Buffer): void {
  let end = -1;
  const earliest = Math.max(0, buffer.length - END_RECORD_LENGTH - MAX_ZIP_COMMENT_LENGTH);
  for (let at = buffer.length - END_RECORD_LENGTH; at >= earliest; at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw notAWorkbook();

  const entries = buffer.readUInt16LE(end + 10);
  if (entries > MAX_ZIP_ENTRIES) throw tooLarge();

  let offset = buffer.readUInt32LE(end + 16);
  let unpacked = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (
      offset + CENTRAL_HEADER_LENGTH > buffer.length ||
      buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER
    ) {
      throw notAWorkbook();
    }
    // ZIP64 marks its sizes 0xFFFFFFFF, which is over the limit too: no export needs it.
    unpacked += buffer.readUInt32LE(offset + 24);
    if (unpacked > MAX_UNPACKED_BYTES) throw tooLarge();

    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += CENTRAL_HEADER_LENGTH + nameLength + extraLength + commentLength;
  }
}

function notAWorkbook(): ImportFileError {
  return new ImportFileError(
    IMPORT_ERROR.NotAWorkbook,
    'This file is not an Excel workbook (.xlsx).',
  );
}

function tooLarge(): ImportFileError {
  return new ImportFileError(
    IMPORT_ERROR.TooLarge,
    'This file unpacks to far more than any export would.',
  );
}

export async function readWorkbook(buffer: Buffer): Promise<Workbook> {
  assertPlausibleZip(buffer);

  const workbook = new Workbook();
  try {
    // exceljs types its input as an ArrayBuffer, which a Node Buffer is not; this copies it into one.
    await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  } catch {
    throw notAWorkbook();
  }
  return workbook;
}

/** A cell as the parsers read it. */
export type CellData = string | number | boolean | Date | null;

/**
 * What a cell shows: text trimmed, empty text as `null`, a formula as its
 * computed result, and an error value (`#NAME?`, which KitchenPal's photo
 * column holds) as `null`, like a blank.
 */
export function cellData(value: CellValue): CellData {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? null : text;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value instanceof Date) return value;
  if ('richText' in value) return cellData(value.richText.map((run) => run.text).join(''));
  if ('formula' in value || 'sharedFormula' in value) return cellData(value.result ?? null);
  if ('hyperlink' in value) return cellData(value.text);
  return null;
}

/** Headers compare trimmed and ignoring case: `Expiry_date`, `expiry_date `. */
const headerKey = (text: string): string => text.trim().toLowerCase();

/**
 * One sheet read as a table: the first row names the columns, and each row
 * after it is read by those names. Blank rows are left out, and so are rows
 * beyond what any import takes, which fail the whole file instead.
 */
export class SheetTable {
  private readonly headers = new Map<string, string>();
  private readonly columns = new Map<string, number>();

  constructor(readonly sheet: Worksheet) {
    sheet.getRow(1).eachCell((cell, column) => {
      const text = cellData(cell.value);
      if (typeof text !== 'string') return;

      const key = headerKey(text);
      if (this.columns.has(key)) return;
      this.columns.set(key, column);
      this.headers.set(key, text);
    });
  }

  has(header: string): boolean {
    return this.columns.has(headerKey(header));
  }

  /** A header as the file spells it, for labelling what came from that column. */
  header(header: string): string {
    return this.headers.get(headerKey(header)) ?? header;
  }

  /** The rows below the header that hold anything, in order. */
  rows(): TableRow[] {
    // `actualRowCount` counts rows with values, the header included.
    if (this.sheet.actualRowCount - 1 > MAX_IMPORT_ROWS) {
      throw new ImportFileError(
        IMPORT_ERROR.TooManyRows,
        `The sheet "${this.sheet.name}" has more than ${MAX_IMPORT_ROWS} rows.`,
      );
    }

    const rows: TableRow[] = [];
    this.sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const read = new TableRow(this.sheet.name, rowNumber, row, this.columns);
      if (!read.isBlank()) rows.push(read);
    });
    return rows;
  }
}

/** One row of a `SheetTable`, read by column header. */
export class TableRow {
  constructor(
    readonly sheet: string,
    readonly rowNumber: number,
    private readonly row: Row,
    private readonly columns: ReadonlyMap<string, number>,
  ) {}

  /** A row whose named columns are all empty: styled, but holding nothing. */
  isBlank(): boolean {
    return [...this.columns.values()].every(
      (column) => cellData(this.row.getCell(column).value) === null,
    );
  }

  value(header: string): CellData {
    const column = this.columns.get(headerKey(header));
    return column === undefined ? null : cellData(this.row.getCell(column).value);
  }

  /** Text, with numbers written out as they are: a barcode or a price may arrive as one. */
  text(header: string): string | null {
    const value = this.value(header);
    if (value === null) return null;
    if (value instanceof Date) return isoDate(value);
    return String(value);
  }

  /** A number, or text that is one: `1,5` counts, with a comma for the decimal point. */
  number(header: string): number | null {
    const value = this.value(header);
    if (value === null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new CellValueError(header);
  }

  /** A whole number from `min` to `max`. */
  integer(header: string, min: number, max: number): number | null {
    const value = this.number(header);
    if (value === null) return null;
    if (!Number.isInteger(value) || value < min || value > max) throw new CellValueError(header);
    return value;
  }

  boolean(header: string): boolean | null {
    const value = this.value(header);
    if (value === null) return null;
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === 'string') {
      const word = value.toLowerCase();
      if (['true', 'yes', '1'].includes(word)) return true;
      if (['false', 'no', '0'].includes(word)) return false;
    }
    throw new CellValueError(header);
  }

  /**
   * A calendar date as `YYYY-MM-DD`, from a date cell, a date's serial number,
   * or text written `YYYY-MM-DD` or `DD/MM/YYYY` (dots or dashes too).
   */
  date(header: string): string | null {
    const value = this.value(header);
    if (value === null) return null;

    let date: Date | null = null;
    if (value instanceof Date) date = value;
    else if (typeof value === 'number') date = fromSerial(value);
    else if (typeof value === 'string') date = fromText(value);

    if (date === null || Number.isNaN(date.getTime())) throw new CellValueError(header);
    const year = date.getUTCFullYear();
    if (year < MIN_YEAR || year > MAX_YEAR) throw new CellValueError(header);
    return isoDate(date);
  }
}

/** Anything outside this is a typo, or a number that was never a date. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/**
 * exceljs reads a date cell as that day's instant in UTC, its time of day
 * included (KitchenPal writes noon), so the date is the UTC one.
 */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Excel counts days from 1899-12-30 (in its 1900 system); the fraction is the time of day. */
function fromSerial(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 24 * 60 * 60 * 1000);
}

function fromText(text: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [iso[1], iso[2], iso[3]]
    : dayFirst
      ? [dayFirst[3], dayFirst[2], dayFirst[1]]
      : [];
  if (year === undefined || month === undefined || day === undefined) return null;

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // `Date.UTC` rolls 2026-02-30 over into March; a real day comes back as given.
  return date.getUTCDate() === Number(day) && date.getUTCMonth() === Number(month) - 1
    ? date
    : null;
}
