import { pantryApi } from '../services/api';
import { createPantrySocket } from '../services/socket';
import { PantryStore } from './PantryStore';

/**
 * Composition root. Domain stores receive their collaborators here rather than
 * importing them, which keeps every store constructible with fakes in a test.
 */
export class RootStore {
  readonly pantry: PantryStore;

  constructor() {
    this.pantry = new PantryStore(pantryApi, createPantrySocket());
  }

  dispose(): void {
    this.pantry.dispose();
  }
}
