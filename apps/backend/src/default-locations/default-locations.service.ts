import { Injectable } from '@nestjs/common';
import {
  DefaultLocationsRepository,
  Transactional,
  type DefaultLocationTranslationRow,
} from '@pantry-pal/db';
import { FALLBACK_LOCATION_NAME, pickTranslation, type DefaultLocation } from '@pantry-pal/shared';
import type { ReplaceDefaultLocationsDto } from '@pantry-pal/shared/dto';

/** A storage space as a new household gets it: already named for its creator. */
export interface NewHouseholdLocation {
  name: string;
  icon: string | null;
  isFallback: boolean;
}

/** Positions are this far apart, like categories', so one can be slotted between two by hand. */
const SORT_ORDER_STEP = 10;

function translationsByCode(
  rows: readonly DefaultLocationTranslationRow[],
): Map<string, Record<string, string>> {
  const byCode = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const names = byCode.get(row.code) ?? {};
    names[row.locale] = row.name;
    byCode.set(row.code, names);
  }
  return byCode;
}

/**
 * The storage spaces every new household starts with, and their names in each
 * language. Written whole through the admin API; read when a household is
 * created.
 *
 * Nothing is broadcast: no client shows the defaults, and every household keeps
 * the spaces it was given.
 */
@Injectable()
export class DefaultLocationsService {
  constructor(private readonly defaults: DefaultLocationsRepository) {}

  /** In a new household's order, each with every translation. */
  async list(): Promise<DefaultLocation[]> {
    const [rows, translations] = await Promise.all([
      this.defaults.list(),
      this.defaults.listTranslations(),
    ]);
    const byCode = translationsByCode(translations);

    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      icon: row.icon,
      isFallback: row.isFallback,
      translations: byCode.get(row.code) ?? {},
    }));
  }

  /**
   * Replaces the list and all its translations at once. The DTO has checked
   * that codes and names do not repeat, in any supported locale, and that one
   * default is the fallback.
   */
  @Transactional()
  async replace(dto: ReplaceDefaultLocationsDto): Promise<DefaultLocation[]> {
    await this.defaults.replaceAll(
      dto.locations.map((entry, index) => ({
        code: entry.code,
        name: entry.name,
        icon: entry.icon ?? null,
        sortOrder: (index + 1) * SORT_ORDER_STEP,
        isFallback: entry.isFallback ?? false,
      })),
      dto.locations.flatMap((entry) =>
        Object.entries(entry.translations ?? {}).map(([locale, name]) => ({
          code: entry.code,
          locale,
          name,
        })),
      ),
    );
    return this.list();
  }

  /**
   * The defaults as a new household gets them: in order, each named for
   * `locale` — its exact tag, else its language, else English — and one of
   * them the fallback. A list edited by hand into having none still gives the
   * household one, appended.
   */
  async forNewHousehold(locale: string): Promise<NewHouseholdLocation[]> {
    const locations = (await this.list()).map((entry) => ({
      name: pickTranslation(entry.translations, locale, entry.name),
      icon: entry.icon,
      isFallback: entry.isFallback,
    }));

    return locations.some((location) => location.isFallback)
      ? locations
      : [...locations, { name: FALLBACK_LOCATION_NAME, icon: null, isFallback: true }];
  }
}
