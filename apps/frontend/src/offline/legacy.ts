import {
  MAX_ITEM_QUANTITY,
  MAX_SYNC_PUSH_BATCH,
  SYNC_COLLECTION,
  type PantryItem,
  type ShoppingListEntry,
  type SyncCheckpoint,
  type SyncPushCollection,
} from '@pantry-pal/shared';
import {
  createRxDatabase,
  type RxCollection,
  type RxDatabase,
  type RxJsonSchema,
  type RxStorage,
} from 'rxdb/plugins/core';
import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication';

import { deleteDatabases, findDatabases, MIRROR_PREFIX } from './forget';
import { conflictHandler, Refusals } from './merge';
import type { MirroredDocument, MirrorRefusal, MirrorTransport } from './mirror';

/**
 * The mirror's version before items had units. A device that last ran it may
 * still hold changes it never sent — made offline, and the app closed before
 * it was back online — which the new database, pulled fresh from the server,
 * would never know about.
 */
const LEGACY_VERSION = 1;

/** How long a drain may take before it gives up, until the next start. */
const DRAIN_TIMEOUT_MS = 30_000;

/** An item as version 1 held it: without units, which the server still takes. */
type LegacyItem = Omit<PantryItem, 'subItems'>;

/*
 * Version 1's schemas, exactly as they were: RxDB opens a database only with
 * the schemas it was made with. Never change these; a later version that
 * replaces the mirror again brings its own copies.
 */
const ID = { type: 'string', maxLength: 36 } as const;
const TEXT = { type: 'string' } as const;
const NULLABLE_TEXT = { type: ['string', 'null'] } as const;
const INSTANT = { type: 'string' } as const;

const legacyItemSchema: RxJsonSchema<LegacyItem> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: ID,
    householdId: ID,
    locationId: ID,
    productId: { type: ['string', 'null'] },
    name: TEXT,
    category: TEXT,
    isEdible: { type: 'boolean' },
    quantity: { type: 'integer' },
    unit: TEXT,
    sizeValue: { type: ['number', 'null'] },
    sizeUnit: NULLABLE_TEXT,
    expiresAt: NULLABLE_TEXT,
    openedAt: NULLABLE_TEXT,
    periodAfterOpeningDays: { type: ['integer', 'null'] },
    effectiveExpiresAt: NULLABLE_TEXT,
    notes: NULLABLE_TEXT,
    status: TEXT,
    defaultShoppingListId: { type: ['string', 'null'] },
    createdAt: INSTANT,
    updatedAt: INSTANT,
  },
  required: ['id', 'householdId', 'locationId', 'name', 'category', 'quantity', 'unit', 'status'],
};

const legacyEntrySchema: RxJsonSchema<ShoppingListEntry> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: ID,
    householdId: ID,
    listId: ID,
    itemId: ID,
    quantity: { type: 'integer' },
    checkedAt: NULLABLE_TEXT,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  },
  required: ['id', 'householdId', 'listId', 'itemId', 'quantity'],
};

/** The fields version 1 changed on an item and an entry, merged as it merged them. */
const LEGACY_ITEM_FIELDS = [
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
] as const satisfies readonly (keyof LegacyItem)[];
const LEGACY_ENTRY_FIELDS = [
  'quantity',
  'checkedAt',
] as const satisfies readonly (keyof ShoppingListEntry)[];

interface LegacyCollections {
  items: RxCollection<LegacyItem>;
  shopping_list_entries: RxCollection<ShoppingListEntry>;
}

export interface LegacyDrainOptions {
  userId: string;
  householdId: string;
  /** The server, as the old mirror named its replications: `${origin}|${householdId}|${collection}`. */
  origin: string;
  transport: MirrorTransport;
  storage: RxStorage<unknown, unknown>;
  /** A change the server would not take, to say so as the mirror does. */
  onRefusal: (refusal: MirrorRefusal) => void;
  /** Aborted when the mirror closes: the drain stops, and tries again at the next start. */
  signal: AbortSignal;
}

/**
 * Sends whatever this user's version-1 database of this household never sent,
 * then deletes it. Its items have no units, and the server takes them as it
 * always did: a quantity and dates for the whole item.
 *
 * Nothing waits for it. Only its own changes are pushed — nothing is pulled into
 * a database about to go — and the new mirror learns of them from the server,
 * like of anyone's. Whatever stops it from finishing — no network, another tab
 * draining it, the mirror closing — leaves the database for the next start.
 */
export async function drainLegacyMirror(options: LegacyDrainOptions): Promise<void> {
  const { userId, householdId, origin, transport, storage, onRefusal, signal } = options;
  const name = `${MIRROR_PREFIX}_${LEGACY_VERSION}_${userId}_${householdId}`;
  // Each collection is an IndexedDB database of its own, named after the mirror.
  const isPart = (database: string): boolean => database.includes(`-${name}--`);
  // Without `indexedDB.databases()` (Firefox before 126) nothing is found, and the
  // old database stays until signing out deletes every mirror.
  if (signal.aborted || (await findDatabases(isPart)).length === 0) return;

  let db: RxDatabase<LegacyCollections> | undefined;
  const replications: RxReplicationState<MirroredDocument, SyncCheckpoint>[] = [];
  try {
    db = await createRxDatabase<LegacyCollections>({
      name,
      storage,
      multiInstance: true,
      eventReduce: true,
      localDocuments: true,
      closeDuplicates: true,
    });
    const itemRefusals = new Refusals();
    const entryRefusals = new Refusals();
    await db.addCollections({
      items: {
        schema: legacyItemSchema,
        conflictHandler: conflictHandler<LegacyItem>({
          fields: LEGACY_ITEM_FIELDS,
          quantity: { min: 0, max: MAX_ITEM_QUANTITY },
          wasRefused: (id) => itemRefusals.take(id),
        }),
      },
      shopping_list_entries: {
        schema: legacyEntrySchema,
        conflictHandler: conflictHandler<ShoppingListEntry>({
          fields: LEGACY_ENTRY_FIELDS,
          quantity: { min: 1, max: MAX_ITEM_QUANTITY },
          wasRefused: (id) => entryRefusals.take(id),
        }),
      },
    });

    const pushOnly = (
      collection: RxCollection<MirroredDocument>,
      pushTo: SyncPushCollection,
      refusals: Refusals,
      before?: () => Promise<unknown>,
    ): RxReplicationState<MirroredDocument, SyncCheckpoint> =>
      replicateRxCollection<MirroredDocument, SyncCheckpoint>({
        collection,
        // The old replications' names: they hold what was never sent.
        replicationIdentifier: `${origin}|${householdId}|${pushTo}`,
        live: true,
        retryTime: 5_000,
        toggleOnDocumentVisible: false,
        push: {
          batchSize: MAX_SYNC_PUSH_BATCH,
          handler: async (rows) => {
            await before?.();
            const result = await transport.push(pushTo, rows);
            for (const refusal of result.refused) {
              refusals.add(refusal.id);
              onRefusal({ collection: pushTo, ...refusal });
            }
            return result.conflicts;
          },
        },
      });

    const items = pushOnly(
      db.items as unknown as RxCollection<MirroredDocument>,
      SYNC_COLLECTION.Items,
      itemRefusals,
    );
    // An entry may name an item made offline, which the server needs first.
    const entries = pushOnly(
      db.shopping_list_entries as unknown as RxCollection<MirroredDocument>,
      SYNC_COLLECTION.ShoppingListEntries,
      entryRefusals,
      () => items.awaitInSync(),
    );
    replications.push(items, entries);

    const drained = await settleWithin(
      Promise.all([items.awaitInSync(), entries.awaitInSync()]),
      DRAIN_TIMEOUT_MS,
      signal,
    );
    await Promise.all(replications.map((replication) => replication.cancel()));
    if (!drained) {
      await db.close();
      return;
    }
    // Removing it only empties it: its databases would be found again at every start.
    await db.remove();
    await deleteDatabases(isPart);
  } catch (error) {
    if (import.meta.env.DEV)
      console.warn('Offline mirror: the old database could not be sent', error);
    await Promise.allSettled(replications.map((replication) => replication.cancel()));
    await db?.close().catch(() => undefined);
  }
}

/** True once `work` resolves; false if it takes longer than `timeoutMs`, or `signal` aborts first. */
async function settleWithin(
  work: Promise<unknown>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const giveUp = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work.then(() => true), giveUp]);
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}
