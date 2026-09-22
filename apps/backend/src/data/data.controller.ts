import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseFilePipe,
  PayloadTooLargeException,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type HttpException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IMPORT_ERROR,
  IMPORT_FILE_FIELD,
  IMPORT_SOURCE,
  MAX_IMPORT_FILE_BYTES,
  type ImportSource,
  type ImportSummary,
} from '@pantry-pal/shared';

import {
  CurrentMembership,
  CurrentUser,
  type AuthenticatedUser,
  type Membership,
} from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { ExportService, XLSX_CONTENT_TYPE } from './export.service';
import { ImportService } from './import.service';
import { readKitchenPal } from './kitchen-pal';
import { readBackup } from './pantry-pal-backup';
import { ImportFileError, readWorkbook } from './workbook';

/** What `FileInterceptor` hands over — multer's file — narrowed to what is read here. */
interface UploadedWorkbook {
  buffer: Buffer;
  size: number;
}

/** Each source's parser: one workbook in, the plan `ImportService` writes out. */
const READERS = {
  [IMPORT_SOURCE.PantryPal]: readBackup,
  [IMPORT_SOURCE.KitchenPal]: readKitchenPal,
} as const;

/**
 * The Data sheet's routes: a household's backup out, and an import in. Any
 * member may do either, as any member may manage items.
 */
@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId')
export class DataController {
  constructor(
    private readonly exports: ExportService,
    private readonly imports: ImportService,
  ) {}

  /** The household as an .xlsx backup: storage spaces, the items on them, and their units. */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  async export(@CurrentMembership() membership: Membership): Promise<StreamableFile> {
    const backup = await this.exports.backup(membership);
    return new StreamableFile(backup.content, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${backup.filename}"`,
      length: backup.content.length,
    });
  }

  /**
   * Adds a file's storage spaces, items and units to the household: a backup
   * (`pantry-pal`) or another app's export. The file is multipart, in the
   * `file` field. The guard has checked the membership before the upload is read.
   */
  @Post('import/:source')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor(IMPORT_FILE_FIELD, { limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 } }),
  )
  async import(
    @CurrentMembership() membership: Membership,
    @CurrentUser() user: AuthenticatedUser,
    @Param('source', new ParseEnumPipe(IMPORT_SOURCE)) source: ImportSource,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: true })) file: UploadedWorkbook,
  ): Promise<ImportSummary> {
    try {
      const plan = READERS[source](await readWorkbook(file.buffer));
      return await this.imports.apply(membership, user.locale, source, plan);
    } catch (error) {
      if (error instanceof ImportFileError) throw toHttpException(error);
      throw error;
    }
  }
}

/**
 * A 400 naming what was wrong with the file, or a 413 for one too large to
 * unpack. The `code` is what the client picks its words by; the message is for
 * everyone else.
 */
function toHttpException(error: ImportFileError): HttpException {
  if (error.code === IMPORT_ERROR.TooLarge) {
    return new PayloadTooLargeException({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      error: 'Payload Too Large',
      message: error.message,
      code: error.code,
    });
  }
  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: error.message,
    code: error.code,
  });
}
