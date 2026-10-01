/**
 * `pnpm db:ingredients [file]` — imports the Open Food Facts ingredients
 * taxonomy into `ingredients`, as often as it is run.
 *
 * Downloads `ingredients.full.json` unless given a copy of it, adds the names
 * the taxonomy lacks from `data/ingredient-names.<language>.json`, and puts
 * those of `data/ingredient-overrides.<language>.json` before its own. Glue
 * only: the parsing and the writes live in `src/ingredients-taxonomy.ts`. The
 * environment is loaded as for `db:seed`.
 */
import { readdir, readFile } from 'node:fs/promises';

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

/**
 * `data/ingredient-<kind>.ru.json` and the like, by language: `names` fills the
 * taxonomy's gaps, `overrides` replaces its own names.
 */
async function loadNames(kind) {
  const directory = new URL('../data/', import.meta.url);
  const names = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const loaded = await Promise.all(
    names.flatMap((name) => {
      const language = new RegExp(`^ingredient-${kind}\\.([a-z]{2,3})\\.json$`).exec(name)?.[1];
      if (language === undefined) return [];
      return readFile(new URL(name, directory), 'utf8').then((text) => [
        language,
        JSON.parse(text),
      ]);
    }),
  );
  for (const [language, byId] of loaded) {
    console.log(`${kind}: ${Object.keys(byId).length} in ${language}`);
  }
  return Object.fromEntries(loaded);
}

const entries = parseOffTaxonomy(await loadTaxonomy(), {
  translations: await loadNames('names'),
  overrides: await loadNames('overrides'),
});
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
