# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/db` — the database layer. See the root `CLAUDE.md` for
workspace-wide guidance.

## Status: skeleton

Only `createDatabase()` and an empty schema barrel exist. The schema,
repositories and transaction handling described below are **agreed but not yet
written**. Read the blocker before starting on the schema.

## Commands

```bash
pnpm build        # tsup, ESM only
pnpm type-check   # tsc --noEmit

pnpm db:generate  # drizzle-kit: SQL migrations from the schema
pnpm db:migrate   # apply migrations
pnpm db:push      # push schema directly (development only)
pnpm db:studio    # browse data
```

The `db:*` commands need `DATABASE_URL`; see `.env.example`. No live database
connection has been tested yet — the skeleton only verifies that the client
constructs and that a CommonJS consumer can load it.

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

## Agreed schema design (not yet implemented)

- **Tenancy** via `households` + `household_members` from day one — not a
  `user_id` column. Retrofitting tenancy later is a rewrite.
- **`products` (catalog, barcode) + `items` (a physical batch with its own
  expiry).** One product, many batches.
- **`locations`** is per-household, seeded Kitchen / Fridge / Freezer / Pantry /
  Spices / Bathroom / Medicines. Location (_where_) and category (_what_) are
  separate axes — do not collapse them.
- **Quantity is three parts** so `1 can 300 ml` can be represented: `quantity` +
  `unit` + `size_value` + `size_unit`. `pcs` is the only count unit; container
  nouns like "can" or "jar" are display-only via `products.package_label`.
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

## Agreed transaction design (not yet implemented)

Repositories are plain classes that never know about transactions. A Proxy
resolves `db` to an `AsyncLocalStorage`-held transaction at property-access
time — **bind methods to the real object**, because Drizzle's private fields
throw when accessed through a Proxy.

`@Transactional()` decorates service methods, modelled on
`typeorm-transactional`, supporting REQUIRED / REQUIRES_NEW / MANDATORY /
NESTED. Write it in **legacy decorator form**: the backend sets
`experimentalDecorators` for Nest, so the two must agree.

## Blocker before any schema work

`PANTRY_CATEGORIES` in `@pantry-pal/shared` is currently:

```
produce, dairy, meat, grains, canned, frozen, spices, beverages, other
```

It has no `medicine`, `personal-care` or `cleaning`. Since the CHECK constraint
on `items.category` is generated from that constant, **every Bathroom and
Medicines item would be rejected** — even though those locations are in the
seeded defaults. Extend `PANTRY_CATEGORIES` first; it is additive and both apps
pick it up automatically (the frontend's category dropdown is generated from
it).

## Deferred

Medicine metadata (dosage and lot go in `notes` for now), row-level security,
reminders, unit conversions, and an `attributes jsonb` column.
