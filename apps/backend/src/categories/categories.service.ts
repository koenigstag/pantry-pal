import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CategoriesRepository, ItemsRepository, Transactional } from '@pantry-pal/db';
import { DEFAULT_CATEGORY, type Category } from '@pantry-pal/shared';
import type { CreateCategoryDto, UpdateCategoryDto } from '@pantry-pal/shared/dto';

import { toCategory } from './category.mapper';

/**
 * Global reference data, like units: read by everyone, written through the
 * admin API.
 *
 * Changes are not broadcast. Clients load categories once per session; one
 * added mid-session shows up on their next load. Nor are the item updates a
 * changed `isEdible` causes: they span every household, and a client's next
 * item refetch brings them in.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly categories: CategoriesRepository,
    private readonly items: ItemsRepository,
  ) {}

  async list(): Promise<Category[]> {
    return (await this.categories.list()).map(toCategory);
  }

  async get(code: string): Promise<Category> {
    const row = await this.categories.findByCode(code);
    if (row === undefined) throw new NotFoundException(`Category "${code}" not found`);
    return toCategory(row);
  }

  /** Without a `sortOrder`, it goes after the last category. */
  async create(dto: CreateCategoryDto): Promise<Category> {
    if ((await this.categories.findByCode(dto.code)) !== undefined) {
      throw new ConflictException(`A category with code "${dto.code}" already exists`);
    }

    const row = await this.categories.create({
      code: dto.code,
      label: dto.label,
      sortOrder: dto.sortOrder ?? (await this.categories.nextSortOrder()),
      isEdible: dto.isEdible,
    });
    return toCategory(row);
  }

  /**
   * `code` is immutable: items reference it. A changed `isEdible` is copied to
   * every item in the category, in the same transaction — except in the default
   * category, where it only sets where a new item starts and items keep their own.
   */
  @Transactional()
  async update(code: string, dto: UpdateCategoryDto): Promise<Category> {
    const row = await this.categories.update(code, {
      label: dto.label,
      sortOrder: dto.sortOrder,
      isEdible: dto.isEdible,
    });
    if (row === undefined) throw new NotFoundException(`Category "${code}" not found`);

    if (dto.isEdible !== undefined && code !== DEFAULT_CATEGORY) {
      await this.items.setEdibleInCategory(code, dto.isEdible);
    }
    return toCategory(row);
  }

  /**
   * Refused while anything references the category, deleted and consumed items
   * included — the foreign keys count those, and rewriting history to free a
   * code would be worse than keeping it.
   */
  async remove(code: string): Promise<void> {
    if (code === DEFAULT_CATEGORY) {
      throw new ConflictException(`"${DEFAULT_CATEGORY}" cannot be deleted: new items start in it`);
    }
    if ((await this.categories.findByCode(code)) === undefined) {
      throw new NotFoundException(`Category "${code}" not found`);
    }
    if (await this.categories.isInUse(code)) {
      throw new ConflictException(`Category "${code}" is still used by items or products`);
    }

    await this.categories.delete(code);
  }
}
