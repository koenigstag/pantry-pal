import {
  DEFAULT_SYNC_PULL_LIMIT,
  MAX_ITEM_QUANTITY,
  MAX_SYNC_PUSH_BATCH,
  SYNC_COLLECTION,
  type PantryItem,
  type PantryLocation,
  type ShoppingList,
  type ShoppingListEntry,
  type SyncCheckpoint,
  type SyncCollection,
  type SyncPullPayload,
  type SyncPushCollection,
  type SyncPushResult,
  type SyncPushRow,
} from '@pantry-pal/shared';
import {
  addRxPlugin,
  createRxDatabase,
  type RxCollection,
  type RxDatabase,
  type RxStorage,
} from 'rxdb/plugins/core';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';
import { RxDBLocalDocumentsPlugin } from 'rxdb/plugins/local-documents';
import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { distinctUntilChanged, map, merge, Subject, type Observable } from 'rxjs';

import { MIRROR_PREFIX } from './forget';
import { drainLegacyMirror } from './legacy';
import { conflictHandler, itemConflictHandler, Refusals, sameDocument } from './merge';
import { itemSchema, locationSchema, shoppingEntrySchema, shoppingListSchema } from './schemas';

addRxPlugin(RxDBLeaderElectionPlugin);
addRxPlugin(RxDBLocalDocumentsPlugin);

/**
 * Part of every mirror's database name. Raised when a schema changes: the next
 * start opens a new, empty database and pulls everything again, which is
 * simpler than migrating data the server can always resend. What the old
 * database never sent is pushed from it first (`legacy.ts`).
 *
 * 2: items carry their units (`PantryItem.subItems`).
 */
const MIRROR_VERSION = 2;

/**
 * A local document written once a first sync has pulled everything: from then
 * on the mirror holds the whole household, in every tab and every later session.
 */
const SYNCED_MARKER = 'synced';

export type MirroredDocument = PantryItem | PantryLocation | ShoppingList | ShoppingListEntry;

/** How the mirror reaches the server: the sync routes, with the caller's session. */
export interface MirrorTransport {
  pull(
    collection: SyncCollection,
    checkpoint: SyncCheckpoint | undefined,
    limit: number,
  ): Promise<SyncPullPayload<MirroredDocument>>;
  push(
    collection: SyncPushCollection,
    rows: readonly SyncPushRow<MirroredDocument>[],
  ): Promise<SyncPushResult<MirroredDocument>>;
}

/** A change made here that the server would not take. */
export interface MirrorRefusal {
  collection: SyncPushCollection;
  id: string;
  message: string;
}

/** An item as it was just before a change, and as the change left it. */
export interface ItemChange {
  before: PantryItem;
  after: PantryItem;
}

interface Collections {
  items: RxCollection<PantryItem>;
  locations: RxCollection<PantryLocation>;
  shopping_lists: RxCollection<ShoppingList>;
  shopping_list_entries: RxCollection<ShoppingListEntry>;
}

type MirrorDatabase = RxDatabase<Collections>;

export interface MirrorOptions {
  userId: string;
  householdId: string;
  /** Where the server is; part of each replication's identity, so two backends never share a checkpoint. */
  origin: string;
  transport: MirrorTransport;
  /** Emits whenever the server may have changes this mirror has not pulled: a broadcast, a reconnect. */
  changes$: Observable<unknown>;
}

/**
 * One household's data on this device, for one user: items, storage spaces,
 * shopping lists and entries, in IndexedDB through RxDB. The UI reads only this;
 * it is what lets the app work without a network.
 *
 * **Replication, per collection:** pulls page through the sync route from a
 * checkpoint whenever `changes$` says the server moved on; pushes send local
 * changes to items and entries, which the server applies through its domain
 * services. Storage spaces and lists are only pulled: their editors write over
 * REST, online, and hand the server's answer to `acceptLocations` and
 * `acceptShoppingLists`.
 *
 * **Entries are pushed after items.** An entry may name an item created on this
 * device, which the server must have first; so each push of entries waits until
 * the items have gone.
 *
 * **One tab replicates** (leader election); the others see its writes through
 * the shared database, so the same change is never pushed twice. RxDB would
 * also replicate in whichever tab is visible, which is switched off: the
 * conflict handler adds quantity changes up, so one change pushed from two tabs
 * could count twice. The leading tab passes the server's refusals on to the
 * others, since the change may have been made in any of them.
 */
export class Mirror {
  readonly items$: Observable<PantryItem[]>;
  readonly locations$: Observable<PantryLocation[]>;
  readonly shoppingLists$: Observable<ShoppingList[]>;
  readonly shoppingEntries$: Observable<ShoppingListEntry[]>;
  /**
   * Whether the household is all here: a first sync finished, in this tab or
   * another, in this session or an earlier one.
   */
  readonly synced$: Observable<boolean>;
  /** Local changes the server refused, with its reason, whichever tab made them. */
  readonly refused$: Observable<MirrorRefusal>;
  /**
   * Replication failures in this tab: mostly an unreachable server, which
   * replication retries by itself. Only the leading tab replicates, so only it
   * sees them.
   */
  readonly errors$: Observable<unknown>;

  private constructor(
    private readonly db: MirrorDatabase,
    private readonly replications: readonly RxReplicationState<MirroredDocument, SyncCheckpoint>[],
    private readonly closing: AbortController,
    private readonly refusalChannel: BroadcastChannel | null,
    refused$: Observable<MirrorRefusal>,
  ) {
    this.items$ = live(db.items);
    this.locations$ = live(db.locations);
    this.shoppingLists$ = live(db.shopping_lists);
    this.shoppingEntries$ = live(db.shopping_list_entries);
    this.synced$ = db.getLocal$(SYNCED_MARKER).pipe(
      map((marker) => marker !== null),
      distinctUntilChanged(),
    );
    this.refused$ = refused$;
    this.errors$ = merge(...replications.map((replication) => replication.error$));
  }

  static async open({
    userId,
    householdId,
    origin,
    transport,
    changes$,
  }: MirrorOptions): Promise<Mirror> {
    const itemRefusals = new Refusals();
    const entryRefusals = new Refusals();
    const closing = new AbortController();
    const name = mirrorName(userId, householdId);

    const storage = await mirrorStorage();
    const db = await createRxDatabase<Collections>({
      name,
      storage,
      multiInstance: true,
      eventReduce: true,
      localDocuments: true,
      // A second open of the same database — a remount in development — replaces the first.
      closeDuplicates: true,
    });

    await db.addCollections({
      items: {
        schema: itemSchema,
        conflictHandler: itemConflictHandler({
          fields: ITEM_FIELDS,
          quantity: { min: 0, max: MAX_ITEM_QUANTITY },
          wasRefused: (id) => itemRefusals.take(id),
        }),
      },
      locations: { schema: locationSchema },
      shopping_lists: { schema: shoppingListSchema },
      shopping_list_entries: {
        schema: shoppingEntrySchema,
        conflictHandler: conflictHandler<ShoppingListEntry>({
          fields: ENTRY_FIELDS,
          quantity: { min: 1, max: MAX_ITEM_QUANTITY },
          wasRefused: (id) => entryRefusals.take(id),
        }),
      },
    });

    const refused = new Subject<MirrorRefusal>();
    const refusalChannel =
      typeof BroadcastChannel === 'function' ? new BroadcastChannel(`${name}:refused`) : null;
    refusalChannel?.addEventListener('message', (event: MessageEvent<MirrorRefusal>) =>
      refused.next(event.data),
    );
    /** Says so here, and in the other tabs: the change may have been made in any of them. */
    const announce = (refusal: MirrorRefusal): void => {
      refused.next(refusal);
      // A BroadcastChannel reaches this origin only, and takes no target origin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      refusalChannel?.postMessage(refusal);
    };
    const resync$ = changes$.pipe(map(() => 'RESYNC' as const));

    const replicate = (
      collection: RxCollection<MirroredDocument>,
      syncCollection: SyncCollection,
      pushTo?: {
        collection: SyncPushCollection;
        refusals: Refusals;
        /** What must happen before each push. */
        before?: () => Promise<unknown>;
      },
    ): RxReplicationState<MirroredDocument, SyncCheckpoint> =>
      replicateRxCollection<MirroredDocument, SyncCheckpoint>({
        collection,
        replicationIdentifier: `${origin}|${householdId}|${syncCollection}`,
        live: true,
        retryTime: 5_000,
        // The leading tab only; see the class comment.
        toggleOnDocumentVisible: false,
        pull: {
          batchSize: DEFAULT_SYNC_PULL_LIMIT,
          stream$: resync$,
          handler: async (checkpoint, batchSize) => {
            const page = await transport.pull(syncCollection, checkpoint, batchSize);
            return { documents: page.documents, checkpoint: page.checkpoint ?? checkpoint };
          },
        },
        push:
          pushTo === undefined
            ? undefined
            : {
                batchSize: MAX_SYNC_PUSH_BATCH,
                handler: async (rows) => {
                  await pushTo.before?.();
                  const result = await transport.push(pushTo.collection, rows);
                  for (const refusal of result.refused) {
                    pushTo.refusals.add(refusal.id);
                    announce({ collection: pushTo.collection, ...refusal });
                  }
                  return result.conflicts;
                },
              },
      });

    const items = replicate(asMirrored(db.items), SYNC_COLLECTION.Items, {
      collection: SYNC_COLLECTION.Items,
      refusals: itemRefusals,
    });
    const replications = [
      items,
      replicate(asMirrored(db.locations), SYNC_COLLECTION.Locations),
      replicate(asMirrored(db.shopping_lists), SYNC_COLLECTION.ShoppingLists),
      replicate(asMirrored(db.shopping_list_entries), SYNC_COLLECTION.ShoppingListEntries, {
        collection: SYNC_COLLECTION.ShoppingListEntries,
        refusals: entryRefusals,
        before: () => untilAborted(items.awaitInSync(), closing.signal),
      }),
    ];

    // The database the version before this one kept, if this device has one.
    void drainLegacyMirror({
      userId,
      householdId,
      origin,
      transport,
      storage,
      onRefusal: announce,
      signal: closing.signal,
    });

    // Resolves only in the leading tab, which is the one that pulls.
    void Promise.all(replications.map((replication) => replication.awaitInitialReplication()))
      .then(() => db.upsertLocal(SYNCED_MARKER, { at: new Date().toISOString() }))
      .catch(() => {
        // Closed before the first sync finished: the next start syncs again.
      });

    return new Mirror(db, replications, closing, refusalChannel, refused);
  }

  /* ------------------------------------------------------------------ reads */

  async item(id: string): Promise<PantryItem | undefined> {
    return (await this.db.items.findOne(id).exec())?.toJSON() as PantryItem | undefined;
  }

  async shoppingList(id: string): Promise<ShoppingList | undefined> {
    return (await this.db.shopping_lists.findOne(id).exec())?.toJSON() as ShoppingList | undefined;
  }

  /** The entries on a list, or only those naming `itemId` when given: at most one, then. */
  async entriesOn(listId: string, itemId?: string): Promise<ShoppingListEntry[]> {
    const selector = itemId === undefined ? { listId } : { listId, itemId };
    const docs = await this.db.shopping_list_entries.find({ selector }).exec();
    return docs.map((doc) => doc.toJSON() as ShoppingListEntry);
  }

  /** The entries naming any of these items, on whichever list. */
  async entriesNaming(itemIds: readonly string[]): Promise<ShoppingListEntry[]> {
    if (itemIds.length === 0) return [];
    const docs = await this.db.shopping_list_entries
      .find({ selector: { itemId: { $in: [...itemIds] } } })
      .exec();
    return docs.map((doc) => doc.toJSON() as ShoppingListEntry);
  }

  /* ------------------------------------------------------------- local writes */

  async insertItem(item: PantryItem): Promise<void> {
    await this.db.items.insert(item);
  }

  /**
   * Changes an item here; replication pushes it. Returns the item just before
   * and just after, or `undefined` for an item this device does not hold.
   */
  async patchItem(
    id: string,
    patch: (item: PantryItem) => Partial<PantryItem>,
  ): Promise<ItemChange | undefined> {
    const doc = await this.db.items.findOne(id).exec();
    if (doc === null) return undefined;

    let before: PantryItem | undefined;
    const changed = await doc.incrementalModify(({ _deleted, ...data }) => {
      before = data;
      return { ...data, ...patch(data), _deleted };
    });
    const after = changed.toJSON() as PantryItem;
    return { before: before ?? after, after };
  }

  async removeItems(ids: readonly string[]): Promise<void> {
    if (ids.length > 0) await this.db.items.bulkRemove([...ids]);
  }

  async insertEntries(entries: readonly ShoppingListEntry[]): Promise<void> {
    if (entries.length > 0) await this.db.shopping_list_entries.bulkInsert([...entries]);
  }

  /** Changes an entry here; replication pushes it. False for an entry this device does not hold. */
  async patchEntry(
    id: string,
    patch: (entry: ShoppingListEntry) => Partial<ShoppingListEntry>,
  ): Promise<boolean> {
    const doc = await this.db.shopping_list_entries.findOne(id).exec();
    if (doc === null) return false;

    await doc.incrementalModify(({ _deleted, ...data }) => ({ ...data, ...patch(data), _deleted }));
    return true;
  }

  async removeEntries(ids: readonly string[]): Promise<void> {
    if (ids.length > 0) await this.db.shopping_list_entries.bulkRemove([...ids]);
  }

  /* ------------------------------------------------- the server's answers */

  /**
   * Storage spaces as a REST write answered them, shown before the pull brings
   * the same. `complete` means every space the household has, so any other is
   * gone. These collections are only pulled, so nothing written here is pushed.
   */
  async acceptLocations(locations: readonly PantryLocation[], complete: boolean): Promise<void> {
    await accept(this.db.locations, locations, complete);
  }

  /** Shopping lists as a REST write answered them; see `acceptLocations`. */
  async acceptShoppingLists(lists: readonly ShoppingList[], complete: boolean): Promise<void> {
    await accept(this.db.shopping_lists, lists, complete);
  }

  /* -------------------------------------------------------------- lifecycle */

  /** Pulls now, from where each collection left off: after a write made over REST, say. */
  reSync(): void {
    for (const replication of this.replications) replication.reSync();
  }

  /**
   * Resolves once the changes made here have reached the server, as far as this
   * tab can tell, or after `timeoutMs`. Only the leading tab replicates, so any
   * other resolves at once: the leader pushes a change within moments of it.
   */
  async pushed(timeoutMs: number): Promise<void> {
    if (!this.db.isLeader()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([
        Promise.all(this.replications.map((replication) => replication.awaitInSync())),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stops replicating and closes the database, keeping its data for the next start. */
  async close(): Promise<void> {
    await this.stop();
    await this.db.close();
  }

  /** Stops replicating and deletes the database: a household this user can no longer see. */
  async remove(): Promise<void> {
    await this.stop();
    await this.db.remove();
  }

  private async stop(): Promise<void> {
    this.closing.abort();
    this.refusalChannel?.close();
    await Promise.all(this.replications.map((replication) => replication.cancel()));
  }
}

/** Every field a client changes on an item: `CreatePantryItemDto`'s, and the status. */
const ITEM_FIELDS = [
  'name',
  'locationId',
  'category',
  'isEdible',
  'quantity',
  'unit',
  'sizeValue',
  'sizeUnit',
  'expiresAt',
  'openedAt',
  'periodAfterOpeningDays',
  'notes',
  'defaultShoppingListId',
  'status',
] as const satisfies readonly (keyof PantryItem)[];

/** An entry's list and item never change; how many to buy and the tick do. */
const ENTRY_FIELDS = [
  'quantity',
  'checkedAt',
] as const satisfies readonly (keyof ShoppingListEntry)[];

function mirrorName(userId: string, householdId: string): string {
  return `${MIRROR_PREFIX}_${MIRROR_VERSION}_${userId}_${householdId}`;
}

/** Live query results as plain objects: the documents not deleted. */
function live<T>(collection: RxCollection<T>): Observable<T[]> {
  return collection.find().$.pipe(map((docs) => docs.map((doc) => doc.toJSON() as T)));
}

function asMirrored<T extends MirroredDocument>(
  collection: RxCollection<T>,
): RxCollection<MirroredDocument> {
  return collection as unknown as RxCollection<MirroredDocument>;
}

/** Writes what changed among `docs`; with `complete`, removes every document not among them. */
async function accept<T extends { id: string }>(
  collection: RxCollection<T>,
  docs: readonly T[],
  complete: boolean,
): Promise<void> {
  const current = await collection.find().exec();
  const held = new Map(current.map((doc) => [doc.primary, doc.toJSON() as T]));

  const changed = docs.filter((doc) => {
    const existing = held.get(doc.id);
    return existing === undefined || !sameDocument(existing, doc);
  });
  if (changed.length > 0) await collection.bulkUpsert([...changed]);

  if (!complete) return;
  const kept = new Set(docs.map((doc) => doc.id));
  const gone = [...held.keys()].filter((id) => !kept.has(id));
  if (gone.length > 0) await collection.bulkRemove(gone);
}

/** `promise`, unless `signal` aborts first: then a rejection, so nothing waits forever. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('The mirror is closing'));
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new Error('The mirror is closing'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * IndexedDB through Dexie. In development, documents are also checked against
 * the schemas and RxDB explains its errors; both stay out of production builds.
 */
async function mirrorStorage(): Promise<RxStorage<unknown, unknown>> {
  const storage = getRxStorageDexie();
  if (!import.meta.env.DEV) return storage;

  const [devMode, ajv] = await Promise.all([
    import('rxdb/plugins/dev-mode'),
    import('rxdb/plugins/validate-ajv'),
  ]);
  devMode.disableWarnings();
  addRxPlugin(devMode.RxDBDevModePlugin);
  return ajv.wrappedValidateAjvStorage({ storage });
}
