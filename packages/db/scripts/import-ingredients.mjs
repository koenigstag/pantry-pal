/**
 * `pnpm db:ingredients [file]` — imports the Open Food Facts ingredients
 * taxonomy into `ingredients`, as often as it is run.
 *
 * Downloads `ingredients.full.json` unless given a copy of it. Glue only: the
 * parsing and the writes live in `src/ingredients-taxonomy.ts`. The environment
 * is loaded as for `db:seed`.
 */
import { readFile } from 'node:fs/promises';

import {
  createDatabase,
  importIngredients,
  OFF_INGREDIENTS_TAXONOMY_URL,
  parseOffTaxonomy,
  resolveConnectionString,
} from '@pantry-pal/db';

const file = process.argv[2];

async function loadTaxonomy() {
  if (file !== undefined) return JSON.parse(await readFile(file, 'utf8'));

  console.log(`Downloading ${OFF_INGREDIENTS_TAXONOMY_URL}`);
  const response = await fetch(OFF_INGREDIENTS_TAXONOMY_URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  return response.json();
}

const entries = parseOffTaxonomy(await loadTaxonomy());
const handle = createDatabase(resolveConnectionString(process.env));

try {
  const summary = await importIngredients(handle.db, entries);
  console.log(
    `Imported ${summary.ingredients} ingredients, ${summary.names} names, ` +
      `${summary.parents} parent links`,
  );
} finally {
  await handle.close();
}
