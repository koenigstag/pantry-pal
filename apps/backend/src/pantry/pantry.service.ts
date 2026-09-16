import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId, type PantryItem } from '@pantry-pal/shared';
import type { CreatePantryItemDto, UpdatePantryItemDto } from '@pantry-pal/shared/dto';
import { Subject, type Observable } from 'rxjs';

export type PantryChange =
  | { readonly type: 'created'; readonly item: PantryItem }
  | { readonly type: 'updated'; readonly item: PantryItem }
  | { readonly type: 'deleted'; readonly id: string };

/**
 * In-memory pantry store.
 *
 * Mutations publish onto `changes$` rather than calling the gateway directly:
 * that keeps the HTTP and WebSocket paths from depending on each other (no
 * circular DI) and means every write is broadcast exactly once, whichever
 * transport triggered it.
 */
@Injectable()
export class PantryService implements OnModuleInit {
  private readonly logger = new Logger(PantryService.name);
  private readonly items = new Map<string, PantryItem>();
  private readonly changes = new Subject<PantryChange>();

  readonly changes$: Observable<PantryChange> = this.changes.asObservable();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('seedDemoData') === true) {
      this.seed();
      this.logger.log(`Seeded ${this.items.size} demo items`);
    }
  }

  findAll(): PantryItem[] {
    return [...this.items.values()];
  }

  findOne(id: string): PantryItem {
    const item = this.items.get(id);
    if (item === undefined) {
      throw new NotFoundException(`Pantry item "${id}" was not found`);
    }
    return item;
  }

  create(dto: CreatePantryItemDto): PantryItem {
    const now = new Date().toISOString();
    const item: PantryItem = {
      id: createId(),
      name: dto.name.trim(),
      quantity: dto.quantity,
      unit: dto.unit,
      category: dto.category,
      expiresAt: dto.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(item.id, item);
    this.changes.next({ type: 'created', item });
    return item;
  }

  update(id: string, dto: UpdatePantryItemDto): PantryItem {
    const current = this.findOne(id);
    const item: PantryItem = {
      ...current,
      ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
      ...(dto.quantity === undefined ? {} : { quantity: dto.quantity }),
      ...(dto.unit === undefined ? {} : { unit: dto.unit }),
      ...(dto.category === undefined ? {} : { category: dto.category }),
      ...(dto.expiresAt === undefined ? {} : { expiresAt: dto.expiresAt }),
      updatedAt: new Date().toISOString(),
    };

    this.items.set(id, item);
    this.changes.next({ type: 'updated', item });
    return item;
  }

  remove(id: string): void {
    // Resolve first so a missing id raises 404 instead of silently succeeding.
    this.findOne(id);
    this.items.delete(id);
    this.changes.next({ type: 'deleted', id });
  }

  private seed(): void {
    const today = new Date();
    const inDays = (days: number): string => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };

    const demo: readonly CreatePantryItemDto[] = [
      { name: 'Whole milk', quantity: 2, unit: 'l', category: 'dairy', expiresAt: inDays(2) },
      {
        name: 'Sourdough loaf',
        quantity: 1,
        unit: 'pcs',
        category: 'grains',
        expiresAt: inDays(-1),
      },
      {
        name: 'Chopped tomatoes',
        quantity: 4,
        unit: 'can',
        category: 'canned',
        expiresAt: inDays(320),
      },
      { name: 'Smoked paprika', quantity: 1, unit: 'pack', category: 'spices', expiresAt: null },
    ];

    for (const entry of demo) {
      this.create(entry);
    }
  }
}
