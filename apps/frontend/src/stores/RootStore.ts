import { pantryApi } from '../services/api';
import { createPantrySocket } from '../services/socket';
import { NoticeStore } from './NoticeStore';
import { PantryStore } from './PantryStore';
import { QuantityUpdates } from './QuantityUpdates';

/**
 * Composition root. Domain stores receive their collaborators here rather than
 * importing them, which keeps every store constructible with fakes in a test.
 */
export class RootStore {
  readonly notices: NoticeStore;
  readonly pantry: PantryStore;
  readonly quantities: QuantityUpdates;

  constructor() {
    this.notices = new NoticeStore();
    this.pantry = new PantryStore(pantryApi, createPantrySocket(), this.notices);
    this.quantities = new QuantityUpdates(this.pantry, pantryApi, this.notices);
  }

  dispose(): void {
    this.quantities.dispose();
    this.pantry.dispose();
    this.notices.dispose();
  }
}
