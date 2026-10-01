import {
  MAX_INGREDIENT_LOOKUP_IDS,
  type Ingredient,
  type IngredientMatch,
} from '@pantry-pal/shared';
import { makeAutoObservable, observable, runInAction } from 'mobx';

import type { PantryApi } from '../services/api';

/** Where the names this device has seen are kept, per language. */
const STORAGE_KEY = 'pantry-pal:ingredient-names';

/** Names kept on the device: enough for a household's items and then some. */
const MAX_STORED_NAMES = 2000;

type IngredientApi = Pick<PantryApi, 'searchIngredients' | 'lookupIngredients'>;

/**
 * Ingredients as this page's language names them: searched online, and the
 * names of those items hold, kept so they show offline too.
 *
 * Items store only an ingredient's id, `en:whole-milk`, so its name is looked up
 * here. The names this device has seen are kept in localStorage — the service
 * worker leaves ingredients out of its cache, whose every search would be an
 * entry. Without a name, `nameOf` still reads the id as words.
 */
export class IngredientCatalog {
  private readonly api: IngredientApi;
  private readonly language: string;

  /** Id -> name, in `language`. */
  private readonly names = observable.map<string, string>();
  /** Ids asked for and not answered yet, or answered without a name. */
  private readonly requested = new Set<string>();
  /** Ids waiting for the next lookup, gathered over one task. */
  private readonly queued = new Set<string>();
  private flushScheduled = false;

  constructor(api: IngredientApi, language: string) {
    this.api = api;
    this.language = language;
    for (const [id, name] of Object.entries(readStored(language))) this.names.set(id, name);

    makeAutoObservable<
      IngredientCatalog,
      'api' | 'language' | 'names' | 'requested' | 'queued' | 'flushScheduled'
    >(
      this,
      {
        api: false,
        language: false,
        names: false,
        requested: false,
        queued: false,
        flushScheduled: false,
      },
      { autoBind: true },
    );
  }

  /** The ingredient's name in this page's language, else its id read as words. */
  nameOf(id: string): string {
    return this.names.get(id) ?? idAsWords(id);
  }

  /**
   * Makes sure the names of `ids` are known, looking up the ones that are not:
   * every caller during one task shares one request.
   */
  load(ids: Iterable<string>): void {
    for (const id of ids) {
      if (this.names.has(id) || this.requested.has(id)) continue;
      this.requested.add(id);
      this.queued.add(id);
    }
    if (this.queued.size === 0 || this.flushScheduled) return;

    this.flushScheduled = true;
    setTimeout(() => void this.flush(), 0);
  }

  /** Ingredients matching `query`, best first. Throws when the server cannot be reached. */
  search(query: string): Promise<IngredientMatch[]> {
    return this.api.searchIngredients(query, this.language);
  }

  /** Keeps the name of an ingredient the user picked, so it shows at once and offline. */
  remember(ingredient: Ingredient): void {
    this.names.set(ingredient.id, ingredient.name);
    this.store();
  }

  private async flush(): Promise<void> {
    const ids = [...this.queued];
    runInAction(() => {
      this.queued.clear();
      this.flushScheduled = false;
    });

    for (let start = 0; start < ids.length; start += MAX_INGREDIENT_LOOKUP_IDS) {
      const batch = ids.slice(start, start + MAX_INGREDIENT_LOOKUP_IDS);
      try {
        // One batch at a time: a household rarely needs a second.
        // oxlint-disable-next-line no-await-in-loop
        const found = await this.api.lookupIngredients(batch, this.language);
        runInAction(() => {
          for (const ingredient of found) this.names.set(ingredient.id, ingredient.name);
          this.store();
        });
      } catch {
        // Offline, most likely: ask again the next time one is shown.
        runInAction(() => {
          for (const id of batch) this.requested.delete(id);
        });
      }
    }
  }

  private store(): void {
    const entries = [...this.names].slice(-MAX_STORED_NAMES);
    writeStored(this.language, Object.fromEntries(entries));
  }
}

/** `en:whole-milk` as `whole milk`: what an ingredient is called before its name arrives. */
export function idAsWords(id: string): string {
  return (id.split(':')[1] ?? id).replaceAll('-', ' ');
}

/**
 * Forgets the names kept on this device, in every language: they say what
 * someone's pantry holds, so they go with the session, like the cached reads.
 */
export function forgetIngredientNames(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`${STORAGE_KEY}:`)) localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: then nothing was kept either.
  }
}

function readStored(language: string): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:${language}`) ?? '{}');
    return typeof stored === 'object' && stored !== null ? (stored as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStored(language: string, names: Record<string, string>): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${language}`, JSON.stringify(names));
  } catch {
    // Storage blocked or full: names are looked up again next time.
  }
}
