import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UnitsRepository } from '@pantry-pal/db';
import { COUNT_UNIT, QUANTITY_UNIT_KIND, type Unit } from '@pantry-pal/shared';
import type { CreateUnitDto, UpdateUnitDto } from '@pantry-pal/shared/dto';

import { toUnit } from './unit.mapper';

/**
 * Global reference data: read by everyone, written through the admin API.
 *
 * Changes are not broadcast. Clients load units once per session; a unit added
 * mid-session shows up on their next load.
 */
@Injectable()
export class UnitsService {
  constructor(private readonly units: UnitsRepository) {}

  async list(): Promise<Unit[]> {
    return (await this.units.list()).map(toUnit);
  }

  async get(code: string): Promise<Unit> {
    const row = await this.units.findByCode(code);
    if (row === undefined) throw new NotFoundException(`Unit "${code}" not found`);
    return toUnit(row);
  }

  async create(dto: CreateUnitDto): Promise<Unit> {
    if ((await this.units.findByCode(dto.code)) !== undefined) {
      throw new ConflictException(`A unit with code "${dto.code}" already exists`);
    }

    const row = await this.units.create({
      code: dto.code,
      label: dto.label,
      kind: dto.kind,
      system: dto.system,
      factor: dto.factor,
    });
    return toUnit(row);
  }

  /**
   * `code` is immutable: items reference it. So is the kind of a unit in use: a
   * count unit's is held by `items_unit_count_fk`, and a size of 500 must not
   * turn from grams into millilitres under the items that hold it.
   */
  async update(code: string, dto: UpdateUnitDto): Promise<Unit> {
    if (code === COUNT_UNIT && dto.kind !== undefined && dto.kind !== QUANTITY_UNIT_KIND) {
      throw new ConflictException(`"${COUNT_UNIT}" must stay a count unit: new items start in it`);
    }

    if (dto.kind !== undefined) {
      const current = await this.units.findByCode(code);
      if (current === undefined) throw new NotFoundException(`Unit "${code}" not found`);
      if (current.kind !== dto.kind && (await this.units.isInUse(code))) {
        throw new ConflictException(
          `Unit "${code}" is still used by items or products, so its kind cannot change`,
        );
      }
    }

    const row = await this.units.update(code, {
      label: dto.label,
      kind: dto.kind,
      system: dto.system,
      factor: dto.factor,
    });
    if (row === undefined) throw new NotFoundException(`Unit "${code}" not found`);
    return toUnit(row);
  }

  /**
   * Refused while anything references the unit, deleted and consumed items
   * included — the foreign keys count those, and rewriting history to free a
   * unit code would be worse than keeping it.
   */
  async remove(code: string): Promise<void> {
    if (code === COUNT_UNIT) {
      throw new ConflictException(`"${COUNT_UNIT}" cannot be deleted: new items start in it`);
    }
    if ((await this.units.findByCode(code)) === undefined) {
      throw new NotFoundException(`Unit "${code}" not found`);
    }
    if (await this.units.isInUse(code)) {
      throw new ConflictException(`Unit "${code}" is still used by items or products`);
    }

    await this.units.delete(code);
  }
}
