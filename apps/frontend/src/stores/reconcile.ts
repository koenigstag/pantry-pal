/** Same keys, and `Object.is`-equal values under each: enough for flat wire objects. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as Array<keyof T>;
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * Returns the entities of `next`, reusing `current`'s object wherever an entity
 * is unchanged — and `current` itself when nothing changed at all.
 *
 * Observer components are memoised on their props, so an entity whose object
 * identity survives a refetch or a snapshot does not re-render. This is what
 * lets a background refetch repaint only the cards that actually changed,
 * rather than flickering the whole list.
 *
 * Order is ignored: every list is sorted for display anyway.
 */
export function reconcileById<T extends { readonly id: string }>(
  current: readonly T[],
  next: readonly T[],
): readonly T[] {
  const existing = new Map(current.map((entity) => [entity.id, entity]));
  let changed = current.length !== next.length;

  const merged = next.map((incoming) => {
    const previous = existing.get(incoming.id);
    if (previous !== undefined && shallowEqual(previous, incoming)) return previous;
    changed = true;
    return incoming;
  });

  return changed ? merged : current;
}
