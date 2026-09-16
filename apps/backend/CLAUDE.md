# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/backend` — NestJS HTTP + WebSocket API. See the root
`CLAUDE.md` for workspace-wide guidance.

## Commands

```bash
pnpm dev          # nest start --watch
pnpm build        # nest build (tsc builder)
pnpm start        # node dist/main.js
pnpm type-check   # tsc --noEmit
```

Served at `http://localhost:3001/api/v1`; socket namespace `/pantry`.
`GET /api/v1/health` is the liveness route. The database must be migrated first
(`pnpm --filter @pantry-pal/db db:migrate`); `pnpm db:seed` there adds a test
household whose owner is `owner@pantry-pal.test`.

## Module format — read before touching tsconfig

**NestJS 12 ships ESM-only.** This package still emits **CommonJS**, which works
only because Node >= 22.12 supports `require()` of ESM.

That is why `tsconfig.json` uses `"module": "nodenext"` with
`"moduleResolution": "nodenext"` — it is what lets `tsc` model that behaviour
_and_ resolve package `exports` subpaths. Plain `"commonjs"` + `"node10"` still
compiles and runs, but cannot resolve `@pantry-pal/shared/dto` and will fail
with a confusing "could not be resolved under your current moduleResolution"
error. The package is deliberately **not** `"type": "module"`. `@pantry-pal/db`
is ESM-only too and arrives through the same `require(esm)` path.

`emitDecoratorMetadata` and `experimentalDecorators` are required here — Nest
resolves providers from decorator metadata at runtime. `useDefineForClassFields`
must stay `false` for constructor parameter properties to behave.

## Layout

```
src/
  database/     DatabaseModule (@Global): pool, transactional proxy, repositories;
                Postgres error -> HTTP translation
  auth/         AccessGuard (global), IdentityService, @Public/@AdminOnly, GET/PATCH /me
  common/       request context: @CurrentUser, @CurrentMembership, Membership
  households/   households + members, MembershipService, HouseholdAccessGuard
  locations/    per-household locations: CRUD, reorder, soft delete
  items/        per-household items and their event history
  units/        GET /units (public reference data)
  categories/   GET /categories (public reference data)
  settings/     typed access to app_settings, with code defaults
  admin/        /admin/units, /admin/categories, /admin/settings
  realtime/     ChangeFeed, PantryGateway, Socket.IO adapter, WS exception filter
```

### Routes

```
GET    PATCH           /me                                            PATCH: the caller's locale
GET    /units
GET    /categories
GET    POST            /households
GET    PATCH  DELETE   /households/:householdId                       PATCH/DELETE: owner
GET    POST            /households/:householdId/members               POST: owner
GET    PATCH  DELETE   /households/:householdId/members/:userId       PATCH: owner; DELETE: owner or self
GET    POST   PUT      /households/:householdId/locations             PUT: the editor's whole list
PUT                    /households/:householdId/locations/order       full ordered id list
GET    PATCH  DELETE   /households/:householdId/locations/:locationId DELETE takes ?moveItemsTo=
GET    POST            /households/:householdId/items                 GET takes ?status=&locationId=
GET    PATCH  DELETE   /households/:householdId/items/:itemId
GET    POST            /admin/units              GET PATCH DELETE /admin/units/:code
GET    POST            /admin/categories         GET PATCH DELETE /admin/categories/:code
GET                    /admin/settings           GET PUT   DELETE /admin/settings/:key
```

## Authentication and authorization

**Every route requires a user unless marked otherwise.** `AccessGuard` is
registered as `APP_GUARD`, so a new controller fails closed. `@Public()` opts
out (health, units); `@AdminOnly()` switches to the `x-admin-api-key` header,
which compares in constant time and answers 403 while `ADMIN_API_KEY` is unset.

**Identity is a development stand-in.** With `DEV_AUTH=true`, the
`x-dev-user-email` header names the caller, and an email seen for the first time
becomes a user — the way a first sign-in through an identity provider would.
`IdentityService.authenticate()` is the seam real authentication replaces;
`AccessGuard` and the socket handshake call nothing else. Configuration refuses
to boot with `DEV_AUTH=true` under `NODE_ENV=production`.

**Household scope.** Every route with `:householdId` goes through
`HouseholdAccessGuard`, which resolves the caller's membership (404, not 403,
for non-members, so ids cannot be probed) and enforces `@RequireHouseholdRole`.
Household-scoped service methods take a `Membership`, never a bare household id,
so they cannot be reached without the check. Owners manage the household and its
members; any member manages locations and items.

**Every household has a fallback location**, "Other", created with it
(`withFallbackLocation`). Deleting a location — `DELETE ...?moveItemsTo=` or a
`removed` entry of the editor's `PUT` — moves its active items to `moveItemsTo`,
or to the fallback when that is omitted. The fallback itself can be reordered and
re-iconed but never renamed or deleted (409); the database backs the delete rule
with `locations_fallback_not_deleted`.

## Request flow

```
HTTP  → Controller ─┐                                          ┌→ household room
                    ├→ Service ──→ ChangeFeed.publish() ──commit──→ PantryGateway
WS    → Gateway ────┘   (@Transactional)                       └→ user room
```

Both transports write through the same services, which publish a
`DomainChange` onto `ChangeFeed`. `PantryGateway` holds the single subscription
and does all broadcasting.

**Never emit socket events from a service or controller.** Publish a change; the
gateway fans it out. This keeps HTTP and WebSocket writes consistent and avoids
circular DI between gateway and services.

**Publishing inside a transaction is safe and expected.** `ChangeFeed.publish()`
defers through `runOnCommit()` from `@pantry-pal/db`, so a rolled-back write
announces nothing, and a released NESTED savepoint's changes wait for the outer
commit.

### Rooms

Each socket joins `user:<id>` and `household:<id>` for every membership at
connect time. Broadcasts go to the household room. `member.added` moves the
user's sockets into the room before emitting (so the new member hears it);
`member.removed` and `household.deleted` emit first, then move sockets out.
Joining a room only grants receiving: socket commands resolve membership per
call, exactly as HTTP does.

The gateway's subscriber catches its own errors. RxJS rethrows a subscriber's
error asynchronously, which would crash the process.

## Concurrency

Row locks, not isolation levels, keep multi-row invariants:

- Membership changes lock the household row (`FOR NO KEY UPDATE`, which does
  not block inserts referencing the household), then re-check the caller's
  role and the owner count under the lock. A household always keeps an owner.
- Location create, reorder, upsert and delete take the same household lock.
- The upsert (`PUT .../locations`, the frontend's locations editor) applies
  renames, additions, deletions and order in one transaction and broadcasts one
  `LocationsUpserted` list. `locations` plus `removed` must name every active
  location: a missing one is a 409, meaning the client edited a stale list.
  Renames go through a placeholder first (`LocationsRepository.updateMany`),
  because the unique name index cannot be deferred and swapped names would
  collide mid-statement.
- Filing an item under a location share-locks it; deleting a location locks it
  exclusively. The delete therefore waits for in-flight item writes, and an item
  can never be filed under a location deleted a moment earlier.
- An item update locks the item, so the before/after it records is exact.

## Validation and error handling

The global `ValidationPipe` in `main.ts` applies to **every execution context**,
WebSocket handlers included. Consequences:

- Do **not** add a second validation pipe to `@MessageBody()` — the global one
  already ran, and a param-level pipe never gets the chance.
- The global pipe raises `BadRequestException`, which the WebSocket layer
  reports to clients as a bare "Internal server error". `WsExceptionFilter`
  (applied via `@UseFilters` on the gateway) re-wraps HTTP exceptions as
  `WsException` so validation details survive. Keep it on any new gateway.

**Postgres errors** are translated by `translateDatabaseError()`: unique and
foreign-key violations become 409, check/not-null/invalid-input become 400,
anything else stays a 500. `DatabaseExceptionFilter` applies it to HTTP as an
`APP_FILTER`. **Global filters do not run for gateways in Nest 12**, so
`WsExceptionFilter` calls the same function itself. Services still check the
common cases up front (unknown unit or category, a quantity unit that is not a
count unit, a unit's kind changing while in use, an `isEdible` its category
contradicts, foreign location, size pair) for precise messages; the translation
is the safety net for races.

DTOs come from `@pantry-pal/shared/dto` and must be imported **as values** in
controllers and gateways — Nest reads the runtime class from parameter metadata.

## Categories and `isEdible`

Categories are global reference data like units: public `GET /categories`,
written through `/admin/categories`. `code` is immutable; `other`
(`DEFAULT_CATEGORY`) cannot be deleted, and nor can a category any item or
product references, deleted and past items included.

An item's `isEdible` is its category's, resolved by `ItemsService` on every
create and on any update that sends a category or a value — except in `other`,
where the item sets its own and omitting it keeps what it had (a new item starts
from `other`'s flag). A value that contradicts any other category is a 400, not
silently replaced. Item writes share-lock the category row.

Changing a category's `isEdible` rewrites its items in every household in the
same transaction (the share lock makes it wait for in-flight item writes), except
for `other`, whose items keep theirs. Like other reference-data changes it is
not broadcast; `updated_at` moves, so clients see it on their next refetch.

## Admin settings

`/admin/settings/:key` is generic over `APP_SETTING` in `@pantry-pal/shared`.
`SETTINGS_REGISTRY` maps each key to its validation DTO; the mapped type makes a
missing entry a compile error. The PUT body is `unknown` so the global pipe
skips it, and `SettingsService` validates with a `ValidationPipe` configured
like the global one — same rules, same 400 shape. Stored values are validated
again on read; an invalid row logs a warning and falls back to the default.

A household copies the `default-locations` setting in force when it is
created. Later changes to the setting never reach existing households.

## Socket.IO configuration

Socket.IO does its own CORS handling and **ignores `app.enableCors()`**. Origins
are applied in `PantryIoAdapter`, registered via `app.useWebSocketAdapter()`.
The `@WebSocketGateway()` decorator sets only the namespace, because decorator
options are evaluated at import time — before `ConfigModule` has loaded `.env`.

Browsers cannot set headers on a WebSocket, so the handshake carries identity in
`auth.devUserEmail`; the header is accepted too, for non-browser clients.

## Express 5

Nest 12 runs on Express 5, whose `query parser` default changed from `extended`
to `simple`, silently breaking `?tags[]=a&tags[]=b` and `?filter[name]=x`.
`main.ts` restores it with `app.set('query parser', 'extended')` — leave it in.

The app is typed as `NestExpressApplication` so `app.set()` is available.

## Configuration

`config/configuration.ts` is the only place that reads `process.env`; everything
else goes through `ConfigService`. It throws at boot on dangerous or invalid
settings rather than failing later. `ConfigModule` loads `.env.local` ahead of
`.env`. See `.env.example` for the supported variables.

On boot, `DatabaseModule` seeds `units` and `categories` **only into an empty
table** — seeding every time would resurrect rows an admin deleted. Migration
`0002_categories` inserts the categories itself; the boot seed covers `db:push`.
That first query doubles as the connectivity check.
