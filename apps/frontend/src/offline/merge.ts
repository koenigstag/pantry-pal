import type { RxConflictHandler, WithDeleted } from 'rxdb/plugins/core';

type Fields = Record<string, unknown>;

/**
 * Whether two versions of a document hold the same data. Documents are flat, so
 * this compares field by field; RxDB's own bookkeeping (`_rev`, `_meta`,
 * `_attachments`) is left out, `_deleted` is not.
 */
export function sameDocument(a: object, b: object): boolean {
  const left = a as Fields;
  const right = b as Fields;
  const keys = new Set(
    [...Object.keys(left), ...Object.keys(right)].filter(
      (key) => !key.startsWith('_') || key === '_deleted',
    ),
  );
  for (const key of keys) {
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

export interface MergeRules {
  /** The fields a client changes; the rest are the server's to set. */
  fields: readonly string[];
  /** How many there may be: quantities are merged by adding up, then kept in range. */
  quantity: { min: number; max: number };
  /**
   * Whether the server refused the last change to this document, consuming the
   * answer. A refused change is dropped rather than merged, or it would be sent
   * again forever.
   */
  wasRefused: (id: string) => boolean;
}

/**
 * Resolves a push the server answered with its own version: someone changed the
 * document since this client last pulled it.
 *
 * - **Refused, or deleted over there:** the server's version stands.
 * - **Created here under an id that exists:** the server's version stands.
 * - **Deleted here:** still deleted, whatever else changed.
 * - **Already in:** every field changed here already holds the new value there
 *   — a push whose answer was lost landed after all — so nothing is re-applied.
 * - **Otherwise field by field:** what changed here goes on top of their
 *   version. A quantity is a delta, not a value: stepping 5 → 6 here while they
 *   stepped 5 → 3 gives 4, not 6, so two people's steps add up.
 *
 * The result is pushed again, now based on the server's version.
 */
export function conflictHandler<T extends { id: string }>(rules: MergeRules): RxConflictHandler<T> {
  return {
    isEqual: (a, b) => sameDocument(a, b),
    resolve: async ({ assumedMasterState, realMasterState, newDocumentState }) => {
      if (rules.wasRefused(realMasterState.id) || realMasterState._deleted) return realMasterState;
      if (assumedMasterState === undefined) return realMasterState;
      if (newDocumentState._deleted) return { ...realMasterState, _deleted: true };

      const assumed = assumedMasterState as unknown as Fields;
      const next = newDocumentState as unknown as Fields;
      const real = realMasterState as unknown as Fields;

      const changed = rules.fields.filter((key) => !Object.is(next[key], assumed[key]));
      if (changed.every((key) => Object.is(real[key], next[key]))) return realMasterState;

      const merged: Fields = { ...real };
      for (const key of changed) merged[key] = next[key];
      if (changed.includes('quantity')) {
        const delta = (next['quantity'] as number) - (assumed['quantity'] as number);
        const quantity = (real['quantity'] as number) + delta;
        merged['quantity'] = Math.min(rules.quantity.max, Math.max(rules.quantity.min, quantity));
      }
      return merged as WithDeleted<T>;
    },
  };
}

/** Ids whose last change the server refused, until their conflict is resolved. */
export class Refusals {
  private readonly ids = new Set<string>();

  add(id: string): void {
    this.ids.add(id);
  }

  /** Whether `id` was refused, forgetting it: a later change to it is judged afresh. */
  take(id: string): boolean {
    return this.ids.delete(id);
  }
}
