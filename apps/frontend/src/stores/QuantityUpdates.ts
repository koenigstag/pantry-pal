import { MAX_ITEM_QUANTITY, type PantryItem } from '@pantry-pal/shared';
import { makeAutoObservable, observable } from 'mobx';

import { messages } from '../i18n/messages';
import type { PantryApi } from '../services/api';
import type { NoticeStore } from './NoticeStore';
import type { PantryStore } from './PantryStore';

/** How long after the last tap on a card its quantity is sent. */
export const QUANTITY_SAVE_DELAY_MS = 600;

/**
 * Optimistic quantity steps: **the only optimistic state in the app.**
 *
 * A tap records the wanted quantity in `pending` at once, and cards render
 * `quantityOf(item)`, so the number changes under the finger. The PATCH goes
 * out once taps on that item stop for `QUANTITY_SAVE_DELAY_MS`, one request per
 * item at a time and always with the newest value.
 *
 * When the server has confirmed the value the user last asked for, the overlay
 * is dropped — the server's copy now shows the same number, so nothing moves —
 * and the item list is refetched in the background. A failed request drops the
 * overlay too, so the card falls back to the server's quantity, and says so.
 *
 * `PantryStore` is never written optimistically: the overlay is the only place
 * a not-yet-confirmed value exists, which is why a broadcast from another
 * client can never be clobbered by, or clobber, an unsent tap.
 */
export class QuantityUpdates {
  private readonly pantry: PantryStore;
  private readonly api: PantryApi;
  private readonly notices: NoticeStore;

  /** Item id -> the quantity the user asked for and the server has not confirmed. */
  private readonly pending = observable.map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<string>();

  constructor(pantry: PantryStore, api: PantryApi, notices: NoticeStore) {
    this.pantry = pantry;
    this.api = api;
    this.notices = notices;

    makeAutoObservable<
      QuantityUpdates,
      'pantry' | 'api' | 'notices' | 'pending' | 'timers' | 'inFlight'
    >(
      this,
      { pantry: false, api: false, notices: false, pending: false, timers: false, inFlight: false },
      { autoBind: true },
    );
  }

  /** What a card shows: the unconfirmed quantity if there is one, else the server's. */
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

  /** Forgets an unsent step, e.g. for an item about to be deleted. */
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
        void this.send(itemId);
      }, QUANTITY_SAVE_DELAY_MS),
    );
  }

  private clearTimer(itemId: string): void {
    clearTimeout(this.timers.get(itemId));
    this.timers.delete(itemId);
  }

  private async send(itemId: string): Promise<void> {
    // One request per item: the one running re-checks for a newer value when it returns.
    if (this.inFlight.has(itemId)) return;

    const householdId = this.pantry.householdId;
    const quantity = this.pending.get(itemId);
    if (householdId === null || quantity === undefined) return;

    this.inFlight.add(itemId);
    try {
      this.pantry.acceptItem(await this.api.updateItem(householdId, itemId, { quantity }));
    } catch {
      this.fail(itemId);
      return;
    } finally {
      this.inFlight.delete(itemId);
    }

    this.settle(itemId, quantity);
  }

  private settle(itemId: string, sent: number): void {
    // More taps are waiting out their own delay; that timer sends them.
    if (this.timers.has(itemId)) return;

    // Tapped again while the request was out, and that delay has already
    // passed (its send found this one in flight): send the newer value now.
    if (this.pending.has(itemId) && this.pending.get(itemId) !== sent) {
      void this.send(itemId);
      return;
    }

    this.pending.delete(itemId);
    void this.pantry.refreshItems();
  }

  private fail(itemId: string): void {
    // A discarded step (the item was being deleted) fails quietly.
    if (!this.pending.has(itemId)) return;

    this.discard(itemId);
    this.notices.error(messages.errors.quantityNotSaved);
    void this.pantry.refreshItems();
  }
}
