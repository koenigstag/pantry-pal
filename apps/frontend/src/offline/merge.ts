import { effectiveExpiry, withSubItems, type PantryItem, type SubItem } from '@pantry-pal/shared';
import type { RxConflictHandler, WithDeleted } from 'rxdb/plugins/core';

type Fields = Record<string, unknown>;

/**
 * Whether two versions of a document hold the same data. Fields are compared
 * one by one; RxDB's own bookkeeping (`_rev`, `_meta`, `_attachments`) is left
 * out, `_deleted` is not. A list of units compares by content, in any order: two
 * copies of one list are never the same object.
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
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return Array.isArray(a) && Array.isArray(b) && sameUnits(a as Fields[], b as Fields[]);
}

/** The same units — flat objects with ids — in the same states, whatever their order. */
function sameUnits(a: readonly Fields[], b: readonly Fields[]): boolean {
  if (a.length !== b.length) return false;

  const byId = new Map(b.map((unit) => [unit['id'], unit]));
  return a.every((unit) => {
    const other = byId.get(unit['id']);
    return other !== undefined && sameFlat(unit, other);
  });
}

function sameFlat(a: Fields, b: Fields): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
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

/**
 * The item fields its units decide: how many, and the lead unit's dates. They
 * follow from the merged units rather than being merged themselves.
 */
const UNIT_DERIVED_FIELDS = new Set([
  'quantity',
  'expiresAt',
  'openedAt',
  'periodAfterOpeningDays',
]);

/** What changing a unit changes: its dates, how much is left, and whether it is still on the shelf. */
const SUB_ITEM_FIELDS = [
  'expiresAt',
  'openedAt',
  'periodAfterOpeningDays',
  'fillPercent',
  'status',
] as const satisfies readonly (keyof SubItem)[];

/**
 * An item's conflicts: `conflictHandler`'s, and when units changed here, unit
 * by unit. Units added here join theirs, units deleted here leave, and a unit's
 * changed fields go on top of their copy of it — unless it is gone over there,
 * used up or deleted by someone else, when the change goes with it. The
 * quantity and dates then follow from the merged units, as on the server.
 */
export function itemConflictHandler(rules: MergeRules): RxConflictHandler<PantryItem> {
  const byField = conflictHandler<PantryItem>(rules);

  return {
    isEqual: byField.isEqual,
    resolve: async (input, context) => {
      const { assumedMasterState, realMasterState, newDocumentState } = input;
      if (rules.wasRefused(realMasterState.id) || realMasterState._deleted) return realMasterState;
      if (assumedMasterState === undefined) return realMasterState;
      if (newDocumentState._deleted) return { ...realMasterState, _deleted: true };

      const assumedUnits = assumedMasterState.subItems as SubItem[] | undefined;
      const nextUnits = newDocumentState.subItems as SubItem[] | undefined;
      const realUnits = realMasterState.subItems as SubItem[] | undefined;
      if (
        assumedUnits === undefined ||
        nextUnits === undefined ||
        realUnits === undefined ||
        sameValue(assumedUnits, nextUnits)
      ) {
        return byField.resolve(input, context);
      }

      const assumed = assumedMasterState as unknown as Fields;
      const next = newDocumentState as unknown as Fields;
      const merged: Fields = { ...realMasterState };
      for (const key of rules.fields) {
        if (!UNIT_DERIVED_FIELDS.has(key) && !Object.is(next[key], assumed[key])) {
          merged[key] = next[key];
        }
      }

      const item = withSubItems(
        merged as unknown as PantryItem,
        mergeSubItems(assumedUnits, nextUnits, realUnits),
      );
      return sameDocument(item, realMasterState)
        ? realMasterState
        : (item as WithDeleted<PantryItem>);
    },
  };
}

/** Their units with the changes made here, from `assumed` to `next`, on top. */
function mergeSubItems(
  assumed: readonly SubItem[],
  next: readonly SubItem[],
  real: readonly SubItem[],
): SubItem[] {
  const before = new Map(assumed.map((unit) => [unit.id, unit]));
  const now = new Set(next.map((unit) => unit.id));
  const merged = new Map(real.map((unit) => [unit.id, unit]));

  for (const unit of assumed) {
    if (!now.has(unit.id)) merged.delete(unit.id);
  }
  for (const unit of next) {
    const was = before.get(unit.id);
    if (was === undefined) {
      // Added here; there already when a push whose answer was lost landed.
      if (!merged.has(unit.id)) merged.set(unit.id, unit);
      continue;
    }

    const theirs = merged.get(unit.id);
    const changed = SUB_ITEM_FIELDS.filter((field) => !Object.is(unit[field], was[field]));
    if (theirs === undefined || changed.length === 0) continue;

    const patched: SubItem = { ...theirs, updatedAt: unit.updatedAt };
    for (const field of changed) Object.assign(patched, { [field]: unit[field] });
    merged.set(unit.id, { ...patched, effectiveExpiresAt: effectiveExpiry(patched) });
  }

  return [...merged.values()];
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
