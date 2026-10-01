/**
 * Text folded for matching rather than display: lowercase, without accents or
 * stress marks, whitespace collapsed. `Crème fraîche` and `creme  fraiche` fold
 * alike, and so do `ма́сло` and `масло`.
 *
 * The ingredient importer stores names folded this way, and a search folds its
 * query the same way, so the two must stay this one function.
 */
export function searchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
