import { MAX_ITEM_QUANTITY, type PantryItem } from '@pantry-pal/shared';
import { makeAutoObservable, observable } from 'mobx';

import { messages } from '../i18n/messages';
import type { NoticeStore } from './NoticeStore';
import type { PantryStore } from './PantryStore';

/** How long after the last tap on a card its quantity is saved. */
export const QUANTITY_SAVE_DELAY_MS = 600;

/**
 * Quantity steps, shown under the finger and saved once the tapping stops.
 *
 * A tap records the wanted quantity in `pending` at once, and cards render
 * `quantityOf(item)`, so the number changes as it is tapped. The item itself
 * changes once taps on it stop for `QUANTITY_SAVE_DELAY_MS`: a run of taps is
 * one write to the offline mirror, and so one change pushed to the server, and
 * a list sorted by quantity does not reshuffle while a card is being tapped.
 *
 * The write resolves once the pantry shows the new quantity, so dropping the
 * overlay then moves nothing. A write that fails drops the overlay too, so the
 * card falls back to the saved quantity, and says so.
 */
export class QuantityUpdates {
  private readonly pantry: PantryStore;
  private readonly notices: NoticeStore;

  /** Item id -> the quantity the user asked for and the pantry does not show yet. */
  private readonly pending = observable.map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<string>();

  constructor(pantry: PantryStore, notices: NoticeStore) {
    this.pantry = pantry;
    this.notices = notices;

    makeAutoObservable<QuantityUpdates, 'pantry' | 'notices' | 'pending' | 'timers' | 'inFlight'>(
      this,
      { pantry: false, notices: false, pending: false, timers: false, inFlight: false },
      { autoBind: true },
    );
  }

  /** What a card shows: the quantity being tapped if there is one, else the saved one. */
  quantityOf(item: PantryItem): number {
    return this.pending.get(item.id) ?? item.quantity;
  }

  /** Quantities are whole numbers (the DTO says so), so a step is exactly one. */
  canStep(item: PantryItem, delta: 1 | -1): boolean {
    const next = this.quantityOf(item) + delta;
    return next > 0 && next <= MAX_ITEM_QUANTITY;
  }

  step(item: PantryItem, delta: 1 | -1): void {
    if (!this.canStep(item, delta)) return;

    this.pending.set(item.id, this.quantityOf(item) + delta);
    this.schedule(item.id);
  }

  /** Forgets an unsaved step, e.g. for an item about to be deleted. */
  discard(itemId: string): void {
    this.clearTimer(itemId);
    this.pending.delete(itemId);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(itemId: string): void {
    this.clearTimer(itemId);
    this.timers.set(
      itemId,
      setTimeout(() => {
        this.timers.delete(itemId);
        void this.save(itemId);
      }, QUANTITY_SAVE_DELAY_MS),
    );
  }

  private clearTimer(itemId: string): void {
    clearTimeout(this.timers.get(itemId));
    this.timers.delete(itemId);
  }

  private async save(itemId: string): Promise<void> {
    // One write per item at a time: the one running re-checks for a newer value when it returns.
    if (this.inFlight.has(itemId)) return;

    const quantity = this.pending.get(itemId);
    if (quantity === undefined) return;

    this.inFlight.add(itemId);
    let failure: string | null;
    try {
      failure = await this.pantry.updateItem(itemId, { quantity });
    } finally {
      this.inFlight.delete(itemId);
    }

    if (failure === null) this.settle(itemId, quantity);
    else this.fail(itemId);
  }

  private settle(itemId: string, saved: number): void {
    // More taps are waiting out their own delay; that timer saves them.
    if (this.timers.has(itemId)) return;

    // Tapped again while the write was out, and that delay has already passed
    // (its save found this one in flight): save the newer value now.
    if (this.pending.has(itemId) && this.pending.get(itemId) !== saved) {
      void this.save(itemId);
      return;
    }

    this.pending.delete(itemId);
  }

  private fail(itemId: string): void {
    // A discarded step (the item was being deleted) fails quietly.
    if (!this.pending.has(itemId)) return;

    this.discard(itemId);
    this.notices.error(messages.errors.quantityNotSaved);
  }
}
