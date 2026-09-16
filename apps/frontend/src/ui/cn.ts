/** Joins class names, skipping the falsy ones a conditional leaves behind. */
export function cn(...classes: ReadonlyArray<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
