/**
 * What every mirror database's name starts with, so signing out can find them
 * all. Here rather than beside the mirror, which would bring RxDB along with it.
 */
export const MIRROR_PREFIX = 'pantrypal';

/**
 * Deletes every offline mirror on this device, whoever's and whichever
 * household's. Called when someone signs out: the pantry leaves the device with
 * the person, and changes that never reached the server go with it.
 *
 * Not when a session merely ends — it expired, or was ended elsewhere — nor
 * when one starts. A mirror's name holds its user's id, so another account
 * never opens it, and the same person signing in again finds their offline
 * changes still waiting to be sent.
 *
 * A mirror still open in some tab is deleted once that tab closes it, which
 * signing out there does at once. Without `indexedDB.databases()` (Firefox
 * before 126) nothing can be found, and nothing is deleted.
 */
export function forgetMirrors(): Promise<void> {
  return deleteDatabases((name) => name.includes(MIRROR_PREFIX));
}

/**
 * The IndexedDB databases on this device whose names `matches` says. RxDB's
 * Dexie storage keeps each collection of a mirror in a database of its own,
 * named after the mirror. Empty without `indexedDB.databases()`.
 */
export async function findDatabases(matches: (name: string) => boolean): Promise<string[]> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return [];

  try {
    return (await indexedDB.databases())
      .map(({ name }) => name)
      .filter((name): name is string => name !== undefined && matches(name));
  } catch {
    return [];
  }
}

/**
 * Deletes the IndexedDB databases `matches` names. Removing an RxDB database
 * only empties its collections, so this is what takes them off the device.
 */
export async function deleteDatabases(matches: (name: string) => boolean): Promise<void> {
  const names = await findDatabases(matches);

  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          // Blocked means open elsewhere: the delete waits for it, and this need not.
          for (const event of ['success', 'error', 'blocked'] as const) {
            request.addEventListener(event, () => resolve(), { once: true });
          }
        }),
    ),
  );
}
