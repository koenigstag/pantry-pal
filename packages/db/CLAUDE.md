# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/db` — the database layer. See the root `CLAUDE.md` for
workspace-wide guidance.

## Status: implemented

Fourteen tables, the transaction layer, seed data, and repositories for users,
refresh tokens, households, members, locations, items, item events, units,
categories, the default storage spaces, shopping lists and their entries.

The initial migration has been applied to a real PostgreSQL 18 instance and the
behaviour verified there: the `LEAST(...)` generated column, every CHECK
constraint, the `lower(name)` expression indexes and the partial indexes all
execute as written, and a rollback correctly unwinds writes made through two
separate repositories.

Migration `0001_household_services` adds `app_settings`, soft-deleted locations,
each household's fallback location flag, the composite tenancy foreign key on
`items`, and the `deleted` event type.

Not yet written: the `pg_notify` LISTEN subscriber, and a products repository.

## Commands

```bash
pnpm build        # tsup, ESM only
pnpm type-check   # tsc --noEmit

pnpm db:generate  # drizzle-kit: SQL migrations from the schema
pnpm db:migrate   # apply migrations
pnpm db:seed      # reset and re-create the test household (builds first)
pnpm db:push      # push schema directly (development only)
pnpm db:studio    # browse data
```

The `db:*` commands need a connection. Set `DATABASE_HOST`, `DATABASE_PORT`,
`DATABASE_USER`, `DATABASE_PASSWORD` and `DATABASE_NAME` in `.env.local`
(git-ignored). `resolveConnectionString(env)` composes them — it takes the env
record as an argument, so it lives under `src/` without breaking the
no-`process.env` rule, and the backend can reuse it. A single `DATABASE_URL`
overrides the five, and a shell variable overrides both files, so a one-off
`DATABASE_URL=... pnpm db:migrate` is never silently retargeted by a file on
disk.

drizzle-kit does not read dotenv files itself; `drizzle.config.ts` loads them
with Node's built-in `process.loadEnvFile`. `db:seed` gets the same precedence
from Node's `--env-file-if-exists` flags instead. Neither needs dotenv.

## Test household

`pnpm db:seed` resets `TEST_HOUSEHOLD_ID` (`00000000-0000-4000-8000-000000000001`)
and re-creates it in one transaction: two members with different unit systems,
all eight locations, the shopping list a new household starts with, six products
and 35 items covering every expiry state.
The fixture is `src/fixtures/test-household.ts`, published separately as
`@pantry-pal/db/fixtures` so seed data never enters the main import graph;
`scripts/seed-test-household.mjs` is only glue.

- **Dates are offsets from the run, never calendar dates**, so the data keeps
  its shape whenever it is re-seeded. Do not hardcode a date in a fixture.
- **The reset is a single DELETE** of the household row; everything else
  cascades. Users are upserted, never deleted — deleting one would cascade into
  its refresh tokens and sign a developer out.
- **Several rows exist to catch UIs that read `expires_at`** instead of
  `effective_expires_at`. Mascara is the clearest: its printed date is over a
  year away, but a 180-day period after opening expired it ten days ago. If a
  screen shows Mascara as fresh, that screen is reading the wrong column.
- Fixture barcodes use GS1's restricted-circulation prefix `2`, so they can
  never match a real product lookup.

**Never commit a real host, port, credential or database name.**
`.env.example` ships variable names with empty values.

## Hard constraints

These are deliberate. Changing any of them affects the whole workspace.

- **Framework-free.** Dependencies are `drizzle-orm` and `pg` only — no
  `@nestjs/*`, not even as a peer. Nest wiring belongs in `apps/backend`.
- **Dependency direction is one-way: `db → shared`.** Never the reverse, and
  never `db → apps/*`.
- **No `process.env` under `src/`.** `createDatabase(connectionString)` takes
  the URL as an argument so the backend's `ConfigService` stays the one place
  configuration is resolved. `drizzle.config.ts` is tooling and may read the
  environment.
- **ESM-only**, unlike `@pantry-pal/shared`, which is dual ESM/CJS. The backend
  is CommonJS and reaches this package through Node's `require(esm)` support —
  the same path it already uses for NestJS 12 itself. There is no browser
  consumer, so a CJS build would be dead weight.
- `pg` and `drizzle-orm` are marked `external` in `tsup.config.ts`; the driver
  must not be bundled.

## Schema design

- **Tenancy** via `households` + `household_members` from day one — not a
  `user_id` column. Retrofitting tenancy later is a rewrite.
- **`refresh_tokens` holds one row per signed-in session**, rotated in place: a
  refresh replaces `token_hash` and pushes `expires_at` out, so the row id is the
  session id for its whole life. The refresh token is a JWT whose `jti` changes at
  every refresh, and `token_hash` is that `jti`'s hash, never the token. Signing
  out sets `revoked_at`. Nothing deletes rows yet: the backend plans a pg-boss job
  to purge expired and revoked ones. `users.password_hash` is null for accounts
  made by the development sign-in, which therefore cannot sign in with a password.
- **Tenancy is enforced by foreign keys, not trusted to callers.** `items`
  references `locations(household_id, id)` with a composite key, so an item
  cannot be filed under another household's location. That needs the otherwise
  redundant `UNIQUE (household_id, id)` on `locations` as its target.
- **`products` (catalog, barcode) + `items` (a physical batch with its own
  expiry).** One product, many batches.
- **`locations`** is per-household, copied on creation from
  `default_locations` (seeded: Kitchen / Fridge / Freezer / Pantry / Spices /
  Bathroom / Medicines / Other). Location (_where_) and category (_what_) are
  separate axes — do not collapse them.
- **`default_locations` + `default_location_translations`** hold the storage
  spaces a new household starts with, by `code`, and their names by locale. A
  household's copies are named for its creator's `users.locale`: the exact tag,
  then its language, then the English `name`; nothing references the defaults
  afterwards. `locale` is checked for its form only, `^[a-z]{2,3}(-[A-Z]{2})?$`,
  and the admin DTO accepts `TRANSLATION_LOCALES` from `@pantry-pal/shared`: a
  CHECK generated from that list would need a migration for every new language.
  Names are unique ignoring case, among the defaults and per locale among the
  translations, since a household's names are. At most one default is the
  fallback (`default_locations_fallback_idx`); the admin DTO requires exactly one.
- **`categories` is a lookup table**, like `units`: `items.category` and
  `products.default_category` reference `categories(code)` (`RESTRICT`), so
  adding a category is an INSERT through the admin API. `CATEGORY_SEED` is the
  default list; `other` is the fixed catch-all a new item starts in.
- **`is_edible`**: a category's says whether its items are food or drink, and
  `items.is_edible` copies it — except in `other`, where each item sets its own
  and the category's flag is only the starting value. No constraint can state
  that exception, so the items and categories services keep it.
- **Locations are soft-deleted.** The items foreign key is `RESTRICT` and counts
  consumed, discarded and soft-deleted rows too, so a hard delete would be
  impossible for any location that ever held an item. The case-insensitive name
  index is partial (`WHERE deleted_at IS NULL`), so a deleted name can be reused.
  `sort_order` is display order, rewritten densely by a reorder.
- **Every household has one fallback location**, "Other" (`is_fallback`): where
  a deleted location's active items go unless the caller names another. It can
  be reordered, never renamed or deleted, so things always have somewhere to go.
  The database allows one per household (`locations_household_fallback_idx`)
  and refuses soft-deleting it (`locations_fallback_not_deleted`); renaming is
  refused by the backend, because a CHECK cannot see the old name. Households
  get it on creation, from the default flagged `is_fallback`.
- **Shopping lists** (`shopping_lists`) are per-household and named, unique
  ignoring case with archived lists included, so restoring one never collides.
  **`shopping_list_entries`** holds an item and how many to buy, at most once per
  list (`shopping_list_entries_list_item_idx`). The item is referenced, never
  copied: putting the shopping away restocks that same row, even one used up
  meanwhile. Both tables carry composite tenancy keys like `items`, which is why
  `items` has the otherwise redundant `UNIQUE (household_id, id)`. A household
  starts with one list, "My shopping list" in its creator's language, which the
  backend creates with it; nothing marks that list afterwards.
- **`items.default_shopping_list_id`** names the list an item goes on when it runs
  out. Its key (`items_default_shopping_list_household_fk`) is `NO ACTION`: a list
  that is still some item's default cannot be deleted, so `ShoppingListsService`
  clears those defaults first and announces each item.
  `ON DELETE SET NULL (default_shopping_list_id)` would clear them silently — no
  broadcast — and a plain `SET NULL` would null `household_id` too.
- **Lists are deleted outright**, unlike locations: no history points at one, and
  its entries cascade. **`archived_at`** freezes a list instead of deleting it; the
  column only records it, and the backend refuses writes to a frozen list.
- **Quantity is how many, then what is inside one**, so `2 cans × 400 g` can be
  represented: `quantity` + `unit`, then `size_value` + `size_unit`.
- **Things are counted, never weighed.** `items.unit` must be a count unit:
  `pcs`, `pill`, or a container such as `bottle`, `can`, `jar`, `pack`, `box`,
  `bag`, `tube` or `blister`. A mass or volume goes in the size, whose unit may
  be of any kind, so rice is `1 bag × 2 kg`. The database enforces it:
  `items_unit_count_fk` references `units(code, kind)` from `(unit, unit_kind)`,
  and `unit_kind` is a column pinned to `'count'` by a DEFAULT and a CHECK,
  because a foreign key can only compare columns. The target needs the otherwise
  redundant `UNIQUE (code, kind)` on `units`, and the same key refuses changing
  the kind of a count unit in use. `products.default_unit` follows the same rule
  (`products_default_unit_count_fk`).
- **`quantity` is an integer** — how many whole things — and so is
  `item_events.quantity_delta`. A fractional amount is a size: a 1.5 kg bag of
  flour is `1 bag` with `size_value 1.5` in `kg`. `size_value` stays
  `numeric(10, 3)`. The shared DTOs enforce the same rule with `@IsInt()`.
- **`units` is a lookup TABLE**, not an enum, with FKs from `items.unit`,
  `items.size_unit` and `products.default_unit` (code/label/kind/system/factor).
  Adding `fl_oz_us` or a `carton` is an INSERT, not a migration. A count unit's
  label is its singular noun; the frontend's message catalog pluralises the ones
  it knows. `factor` exists but nothing reads it yet — conversions are deferred.
- **`effective_expires_at`** is
  `GENERATED ALWAYS AS (LEAST(expires_at, opened_at + period_after_opening_days)) STORED`.
  **Expiry status must read this column, not `expires_at`** — otherwise an
  opened item reports fresh until its printed date.
- **Soft delete** (`deleted_at`) plus a `(household_id, updated_at)` index, so a
  reconnecting WebSocket client can fetch a delta rather than a full snapshot.
- **Realtime via `pg_notify`**, ids only (8 KB payload cap). NOTIFY is
  transactional, so a rolled-back write cannot leak a phantom event.

### Why `text` + CHECK rather than `pgEnum`

`ALTER TYPE ... ADD VALUE` cannot run in the same transaction that adds it,
which breaks Drizzle's transactional migrations. Use `text` with a CHECK
constraint generated from the shared constants, or a lookup table.

### Value sets live in `@pantry-pal/shared`

`HOUSEHOLD_ROLE`, `ITEM_STATUS`, `ITEM_EVENT_TYPE`, `UNIT_KINDS`, `UNIT_SYSTEMS`
and `UNIT_SYSTEM_PREFERENCES` are defined in `shared/src/constants.ts` and
imported by the schema, never redefined here. The
request DTOs and the frontend need the same lists the CHECK constraints are
generated from, and neither can depend on this package.

### Value sets are const objects, never TS `enum`

Follow the `PANTRY_EVENT` shape used in `@pantry-pal/shared`:

```ts
export const ITEM_STATUS = { Active: 'active', Consumed: 'consumed' } as const;
export type ItemStatus = (typeof ITEM_STATUS)[keyof typeof ITEM_STATUS];
export const ITEM_STATUSES = Object.values(ITEM_STATUS);
```

String enum members are not assignable from plain `string`, and every value here
arrives as one — from JSON bodies, WS payloads and Drizzle's `text()` columns —
so an enum forces `as` casts at every boundary. The runtime array is also needed
to generate the SQL CHECK constraints, and `enum` is not erasable syntax
(`isolatedModules` is set workspace-wide). Plain `as const` arrays are fine
where no named access is wanted (`UNIT_KINDS`, `UNIT_SYSTEMS`).

## Transaction design

Repositories are plain classes that never know about transactions. A Proxy
resolves `db` to an `AsyncLocalStorage`-held transaction at property-access
time — **bind methods to the real object**, because Drizzle's private fields
throw when accessed through a Proxy.

`@Transactional()` decorates service methods, modelled on
`typeorm-transactional`, supporting REQUIRED / REQUIRES_NEW / MANDATORY /
NESTED. Write it in **legacy decorator form**: the backend sets
`experimentalDecorators` for Nest, so the two must agree. Use it on service
methods only: above a Nest route decorator it would replace the function that
carries the route metadata.

`runOnCommit(callback)` defers a side effect until the outermost transaction
commits, or runs it at once outside one. It is dropped on rollback, including
the rollback of a NESTED savepoint; a released savepoint hands its callbacks to
the enclosing transaction. Callbacks must not throw — the write is durable by
then. The backend's realtime broadcasts go through it.

Repositories lock rows explicitly where a service reads before it writes
(`HouseholdsRepository.lock`, `LocationsRepository.lock`, `ItemsRepository.lock`
and `lockMany`, `ShoppingListsRepository.lock`, `ShoppingListEntriesRepository.lockMany`),
and every `update()` treats an empty patch as a no-op — Drizzle itself throws
"No values to set" on an empty SET, `$onUpdate` columns notwithstanding.
`lockMany` locks in id order, so two callers locking overlapping rows cannot
deadlock on each other.

## Errors

`findPostgresError(error)` walks the `cause` chain (Drizzle wraps driver errors
in `DrizzleQueryError`) and returns the SQLSTATE, constraint, table and detail.
It recognises the driver error by shape, so callers need no `pg` import.
`PG_ERROR` names the codes worth translating, `40P01` (a deadlock, rolled back
whole) among them.

## Migrations

drizzle-kit orders statements by kind, not by dependency. In `0001` it emitted
the composite foreign key before the `UNIQUE (household_id, id)` it points at,
which Postgres rejects; the file is hand-ordered and says so. Read a generated
migration before applying it, especially when it adds a key and its target
together.

**`0000` was edited in place** twice on 2026-09-16, with both snapshots updated
to match, at the user's request rather than adding migrations:

1. `items.quantity` and `item_events.quantity_delta` became integers.
2. Count units: `units_code_kind_unique`, `items.unit_kind` with
   `items_unit_count_fk` and `items_unit_kind_count`, the same pair on
   `products.default_unit`, and `products.package_label` removed. The
   `items_size_only_count` CHECK is gone, since a size no longer depends on the
   unit.

**`0001` was edited in place** the same day, following that choice, for the
fallback location: `locations.is_fallback`, `locations_household_fallback_idx`
and `locations_fallback_not_deleted`. Its statements are drizzle-kit's own —
generated as a temporary `0002`, moved into `0001` beside the other location
changes, with `0002`'s snapshot becoming `0001`'s.

The migrator never re-runs an applied migration, so a database created before
any of these edits keeps the old columns and constraints: drop and re-create it
(`db:migrate`, then `db:seed`) instead of expecting a migration to fix it.
`drizzle-kit generate` reporting no changes confirms the latest snapshot; the
edited `CREATE TABLE` statements were also compared against a from-scratch
generation.

`0002_categories` and `0003_edible` are new migrations, not in-place edits, so
an existing database upgrades with `db:migrate`. Both are hand-edited, and say so:

- `0002` inserts the default categories between the `CREATE TABLE` and the
  foreign keys that replace the old CHECKs, or existing items would violate them.
- `0003` flags the inedible categories, then adds `items.is_edible` in three
  steps — nullable, backfilled from each item's category, then `NOT NULL` —
  because drizzle-kit's one-statement `ADD COLUMN ... NOT NULL` fails on a table
  with rows.

Both were verified on a database migrated to `0001` and seeded before them.

`0004_birth_date` adds the nullable `users.birth_date`, exactly as drizzle-kit
generated it. It has no CHECK: the range ends today, which a CHECK cannot
compare with, so the DTO checks it.

`0005_default_locations` creates the default storage space tables, inserts
`DEFAULT_LOCATION_SEED` as it stood then, and drops `app_settings`, whose only
key the tables replace. It is hand-assembled, and says so: drizzle-kit asks
whether a new table is a dropped one renamed, a prompt that needs a TTY, so the
drop and the new tables were generated as two migrations and merged into one,
the second one's snapshot becoming `0005`'s. `drizzle-kit generate` reporting no
changes confirms that snapshot.

`0006_shopping_lists` adds both shopping tables and `items.default_shopping_list_id`,
then gives every existing household the list a new one starts with. It is
hand-edited in two places, and says so:

- It is hand-ordered: drizzle-kit emitted `items_household_id_id_unique` last,
  after the entries' foreign key that references it, as it did in `0001`.
- The backfill is hand-added. Each list is named for the `users.locale` of its
  household's creator, from a `CASE` holding the names `defaultShoppingListName`
  in `@pantry-pal/shared` gave then: the exact tag, then its language, then
  English. A copy, so that changing the names later never changes a migration.

Verified on PostgreSQL 18 over a database migrated to `0005`, with items in it,
and with households whose creators use every supported language and one without
a translation (`pt-BR`, which gets English). Also verified in a rolled-back
transaction: the tenancy keys, the one-entry-per-item index, the quantity check,
refusing to delete a list that is still a default, and deleting a household that
holds lists, defaults and entries.

## Resolved: categories are a table

Categories used to be a CHECK generated from a shared constant, so adding one
needed a migration while adding a unit did not. `0002_categories` promoted them to
a lookup table like `units`, and the asymmetry is gone.

## Deferred

Medicine metadata (dosage and lot go in `notes` for now), row-level security,
reminders, unit conversions, and an `attributes jsonb` column.
