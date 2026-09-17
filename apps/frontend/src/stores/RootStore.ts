import { authApi, pantryApi } from '../services/api';
import { createPantrySocket } from '../services/socket';
import { AuthStore } from './AuthStore';
import { NoticeStore } from './NoticeStore';
import { PantryStore } from './PantryStore';
import { QuantityUpdates } from './QuantityUpdates';

/**
 * Composition root. Domain stores receive their collaborators here rather than
 * importing them, which keeps every store constructible with fakes in a test.
 *
 * This part lives as long as the page: notices, and whether anyone is signed in.
 */
export class RootStore {
  readonly notices: NoticeStore;
  readonly auth: AuthStore;

  constructor() {
    this.notices = new NoticeStore();
    this.auth = new AuthStore(authApi);
  }

  dispose(): void {
    this.notices.dispose();
  }
}

/**
 * The stores of one signed-in session. They are created when the signed-in pages
 * mount and disposed when they unmount, so signing out drops the pantry and
 * closes its socket, and the next sign-in starts clean.
 */
export class SessionStores {
  readonly pantry: PantryStore;
  readonly quantities: QuantityUpdates;

  constructor(notices: NoticeStore) {
    this.pantry = new PantryStore(pantryApi, createPantrySocket(), notices);
    this.quantities = new QuantityUpdates(this.pantry, pantryApi, notices);
  }

  dispose(): void {
    this.quantities.dispose();
    this.pantry.dispose();
  }
}
