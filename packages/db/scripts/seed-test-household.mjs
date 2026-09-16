/**
 * `pnpm db:seed` — resets and re-creates the test household.
 *
 * Glue only: the typed fixture lives in `src/fixtures/test-household.ts`. This
 * file imports the built package through its own `exports` map, which is why
 * the `db:seed` script builds first.
 *
 * The environment is loaded by the `--env-file-if-exists` flags in that script.
 * Node never lets a file override a variable already set in the shell, and a
 * later file overrides an earlier one — so the precedence is shell, then
 * `.env.local`, then `.env`: the same order `drizzle.config.ts` applies.
 */
import { createDatabase, resolveConnectionString } from '@pantry-pal/db';
import { seedTestHousehold, TEST_HOUSEHOLD_NAME } from '@pantry-pal/db/fixtures';

const handle = createDatabase(resolveConnectionString(process.env));

try {
  const { householdId, members, locations, products, items, expiry, events } =
    await seedTestHousehold(handle.db);

  console.log(`Seeded "${TEST_HOUSEHOLD_NAME}" (${householdId})`);
  console.log(
    `  members    ${members.map((m) => `${m.email} (${m.role}, ${m.unitSystem})`).join(', ')}`,
  );
  console.log(`  locations  ${locations}`);
  console.log(`  products   ${products}`);
  console.log(
    `  items      ${items.active} active · ${items.consumed} consumed · ` +
      `${items.discarded} discarded · ${items.deleted} deleted`,
  );
  console.log(
    `  expiry     ${expiry.expired} expired · ${expiry.expiringSoon} expiring soon · ` +
      `${expiry.fresh} fresh · ${expiry.noDate} no date`,
  );
  console.log(`  events     ${events}`);
} finally {
  await handle.close();
}
