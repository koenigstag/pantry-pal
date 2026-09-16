# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/db` — the database layer. See the root `CLAUDE.md` for
workspace-wide guidance.

## Status: implemented

Ten tables, the transaction layer, seed data, and repositories for users,
households, members, locations, items, item events, units and app settings.

The initial migration has been applied to a real PostgreSQL 18 instance and the
behaviour verified there: the `LEAST(...)` generated column, every CHECK
constraint, the `lower(name)` expression indexes and the partial indexes all
execute as written, and a rollback correctly unwinds writes made through two
separate repositories.

Migration `0001_household_services` adds `app_settings`, soft-deleted locations,
the composite tenancy foreign key on `items`, and the `deleted` event type.

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
all eight locations, six products and 35 items covering every expiry state.
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
- **Tenancy is enforced by foreign keys, not trusted to callers.** `items`
  references `locations(household_id, id)` with a composite key, so an item
  cannot be filed under another household's location. That needs the otherwise
  redundant `UNIQUE (household_id, id)` on `locations` as its target.
- **`products` (catalog, barcode) + `items` (a physical batch with its own
  expiry).** One product, many batches.
- **`locations`** is per-household, copied on creation from the
  `default-locations` setting (code default: Kitchen / Fridge / Freezer /
  Pantry / Spices / Bathroom / Medicines / Other). Location (_where_) and
  category (_what_) are separate axes — do not collapse them.
- **Locations are soft-deleted.** The items foreign key is `RESTRICT` and counts
  consumed, discarded and soft-deleted rows too, so a hard delete would be
  impossible for any location that ever held an item. The case-insensitive name
  index is partial (`WHERE deleted_at IS NULL`), so a deleted name can be reused.
  `sort_order` is display order, rewritten densely by a reorder.
- **`app_settings`** is key → jsonb for global, admin-managed values. Untyped
  here on purpose: keys, value types and defaults live in `@pantry-pal/shared`
  (`APP_SETTING`), and the backend validates every read and write. A missing row
  means "use the default", so it needs no seed.
- **Quantity is three parts** so `1 can 300 ml` can be represented: `quantity` +
  `unit` + `size_value` + `size_unit`. `pcs` is the only count unit; container
  nouns like "can" or "jar" are display-only via `products.package_label`.
- **`quantity` is an integer** — how many whole things — and so is
  `item_events.quantity_delta`. A fractional amount is a size: a 1.5 kg bag of
  flour is `1 pcs` with `size_value 1.5` in `kg`. `size_value` stays
  `numeric(10, 3)`. The shared DTOs enforce the same rule with `@IsInt()`.
- **`units` is a lookup TABLE**, not an enum, with FKs from `items.unit` and
  `items.size_unit` (code/label/kind/system/factor). Adding `fl_oz_us` is an
  INSERT, not a migration. `factor` exists but nothing reads it yet —
  conversions are deferred.
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

`HOUSEHOLD_ROLE`, `ITEM_STATUS`, `ITEM_EVENT_TYPE`, `UNIT_KINDS`, `UNIT_SYSTEMS`,
`UNIT_SYSTEM_PREFERENCES` and `DEFAULT_LOCATIONS` are defined in
`shared/src/constants.ts` and imported by the schema, never redefined here. The
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
where no named access is wanted (`UNIT_KINDS`, `DEFAULT_LOCATIONS`).

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
(`HouseholdsRepository.lock`, `LocationsRepository.lock`, `ItemsRepository.lock`),
and every `update()` treats an empty patch as a no-op — Drizzle itself throws
"No values to set" on an empty SET, `$onUpdate` columns notwithstanding.

## Errors

`findPostgresError(error)` walks the `cause` chain (Drizzle wraps driver errors
in `DrizzleQueryError`) and returns the SQLSTATE, constraint, table and detail.
It recognises the driver error by shape, so callers need no `pg` import.
`PG_ERROR` names the codes worth translating.

## Migrations

drizzle-kit orders statements by kind, not by dependency. In `0001` it emitted
the composite foreign key before the `UNIQUE (household_id, id)` it points at,
which Postgres rejects; the file is hand-ordered and says so. Read a generated
migration before applying it, especially when it adds a key and its target
together.

**`0000` was edited in place** (2026-09-16) to make `items.quantity` and
`item_events.quantity_delta` integers, with both snapshots updated to match, at
the user's request rather than adding a migration. The migrator never re-runs an
applied migration, so a database created before that edit still has `numeric`
columns: drop and re-create it (`db:migrate`, then `db:seed`) instead of
expecting a migration to fix it.

## Resolved: the category blocker

`PANTRY_CATEGORIES` in `@pantry-pal/shared` gained `medicine`,
`personal-care` and `cleaning`, so Bathroom and Medicines items now satisfy
`items_category_check`.

Note the asymmetry this leaves behind: that CHECK is **generated from the shared
constant into the DDL**, so adding another category needs a new migration.
Adding a _unit_ does not — `units` is a lookup table, so it is an INSERT. If
categories start churning, promote them to a table for the same reason.

## Deferred

Medicine metadata (dosage and lot go in `notes` for now), row-level security,
reminders, unit conversions, and an `attributes jsonb` column.
