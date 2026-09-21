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
household whose owner is `owner@pantry-pal.test`. Seeded users have no password:
get a session for one with `POST /api/v1/auth/dev-sign-in` (`DEV_AUTH=true`).

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
  auth/         AccessGuard (global, Passport JWT), sign-up/sign-in/refresh/sign-out,
                SessionsService, IdentityService, @Public/@AdminOnly, /me and its password
  common/       request context: @CurrentUser, @CurrentMembership, Membership
  households/   households + members, MembershipService, HouseholdAccessGuard
  locations/    per-household locations: CRUD, reorder, soft delete
  items/        per-household items and their event history; running out, restocking
  shopping-lists/ lists and their entries: the editor's save, archiving, putting away
  sync/         the offline mirror: pulls since a checkpoint, pushes through the services
  data/         the Data sheet: an .xlsx backup out; imports in, from a backup or KitchenPal
  units/        GET /units (public reference data)
  categories/   GET /categories (public reference data)
  default-locations/  the storage spaces a new household starts with, and their translations
  admin/        /admin/units, /admin/categories, /admin/default-locations, /admin/users (passwords)
  realtime/     ChangeFeed, PantryGateway, Socket.IO adapter, WS exception filter
```

### Routes

```
POST                   /auth/sign-up  /auth/sign-in                   public; 10/min per client address
POST                   /auth/refresh  /auth/sign-out                  public; 30/min; body: refreshToken
POST                   /auth/dev-sign-in                              DEV_AUTH=true only, else 404
GET    PATCH           /me                                            PATCH: name, units, date of birth, locale
POST                   /me/password                                   current + new; 5/min per account
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
GET    POST   PUT      /households/:householdId/shopping-lists        PUT: the editor's whole set
PATCH  DELETE          /households/:householdId/shopping-lists/:listId
POST                   /households/:householdId/shopping-lists/:listId/entries           itemIds, quantity
PATCH  DELETE          /households/:householdId/shopping-lists/:listId/entries/:entryId  quantity, checked
POST                   /households/:householdId/shopping-lists/:listId/put-away          entryIds
GET                    /households/:householdId/sync/:collection      ?updatedAt=&id=&limit=
POST                   /households/:householdId/sync/:collection/push rows: items, entries only
GET                    /households/:householdId/export                an .xlsx backup
POST                   /households/:householdId/import/:source        multipart `file`; pantry-pal, kitchen-pal
GET    POST            /admin/units              GET PATCH DELETE /admin/units/:code
GET    POST            /admin/categories         GET PATCH DELETE /admin/categories/:code
GET    PUT             /admin/default-locations                       PUT: the whole list, with translations
PUT                    /admin/users/:email/password                   sets it, ends every session; no email
```

## Authentication and authorization

**Every route requires a user unless marked otherwise.** `AccessGuard` is
registered as `APP_GUARD`, so a new controller fails closed. `@Public()` opts
out (health, units); `@AdminOnly()` switches to the `x-admin-api-key` header,
which compares in constant time and answers 403 while `ADMIN_API_KEY` is unset.

**Identity is an access token**: a 15-minute HS256 JWT naming the user (`sub`)
and the session (`sid`), sent as `Authorization: Bearer`. `AccessGuard` extends
Passport's `AuthGuard('jwt')`; `JwtStrategy` checks the signature and expiry, and
`IdentityService.userFromClaims` loads the user into `request.user`. Passport
does not run for sockets, so the handshake calls
`IdentityService.verifyAccessToken`, which ends in the same lookup.

**Access and refresh tokens have separate secrets**, `JWT_ACCESS_SECRET` and
`JWT_REFRESH_SECRET`, so neither kind verifies as the other. `TokenSigner` passes
the secret and the algorithm on every sign and verify; `JwtModule` has no default
secret, so a call that names none fails rather than borrowing one. Passport's
strategy reads the access secret itself.

**A session is one `refresh_tokens` row** (`SessionsService`). Its refresh token is
a 30-day JWT naming the user, the session and a `jti` that changes at every
refresh; the row stores only the `jti`'s SHA-256. It is verified in
`SessionsService` rather than by a second Passport strategy, since rotation needs
the row lock anyway. `POST /auth/refresh` rotates the row in place and answers
with a new pair. A signed token whose `jti` the row no longer holds was spent
already, so it was copied: the session is revoked for both holders. Two
consequences for clients:

- Refreshes must be serialised. Two tabs refreshing with one token look exactly
  like theft, and sign the user out.
- A refresh response lost in transit leaves the client holding a spent token, so
  that client is signed out.

`POST /auth/sign-out` revokes the session only when given its current token, so a
stale copy signs nobody out. An access token already issued stays valid until it
expires; household membership is still checked per request, so a removed member
loses access at once.

Nothing deletes a session's row yet, so every sign-in leaves one behind for good.
Purging expired and revoked rows is the first planned background job (see
Background jobs).

**Revoking a session closes its sockets.** A socket authenticates only at its
handshake and joins `session:<sid>`; `SessionsService` publishes
`session.revoked`, and the gateway disconnects that room. An access token that
merely expires does not disconnect anything.

**Passwords** are hashed with Argon2id (`@node-rs/argon2`: 19 MiB, 2 passes, 1
thread, OWASP's baseline). Sign-up refuses an email that has an account, a
passwordless one included: setting a password on it would hand the account to
whoever typed the email first. Sign-in answers the same 401 for an unknown email
and a wrong password, though sign-up's 409 reveals whether an email has an
account anyway.

**A new account starts in the client's language.** Sign-up and dev sign-in take
an optional `locale`, the language the client was showing; omitted, the column's
default applies. Without it, a client in another language would reload into
English the moment the account exists. Dev sign-in applies it only when it
creates the account: an existing account keeps its own.

**`PATCH /me` changes the caller's own settings**: `displayName`, `unitSystem`,
`birthDate` and `locale`, each left alone when absent.

- **The date of birth is private.** `GET /me` returns it, but member lists never
  select it. `null` removes it, and the DTO takes dates from `MIN_BIRTH_DATE`
  (1900) up to today anywhere on Earth, so up to a day ahead of UTC.
- **A new name is broadcast.** Members see each other by name, so the service
  publishes `member.updated` to each of the caller's households, in the
  transaction that saves it. Nothing else a user sets is broadcast.

**Changing a password** (`POST /me/password`) takes the current password and a
new one. Every other session of the account is revoked, closing its sockets, and
the caller's own session stays signed in. Nothing sends email: a forgotten
password is reset by an administrator (below).

- **A wrong current password is 403, never 401**: clients take a 401 to mean the
  access token expired.
- **It needs the caller's session.** `JwtStrategy` puts the access token's `sid` on
  the request (`@CurrentSessionId()`), kept off `request.user`, which `GET /me`
  returns. The development header has no session and gets a 403, and so does an
  account without a password.
- **Argon2 runs outside the transaction.** Inside it, the user row is locked, and
  the change goes ahead only if the stored hash is still the one just verified
  (409 otherwise) and the caller's session is still live (401 otherwise). Of two
  concurrent changes, one wins.

**An administrator can reset any password**:
`PUT /admin/users/:email/password` with `{ password }` and the `x-admin-api-key`
header. It sets the password and ends every session of the user, closing their
sockets.

- **Nothing is emailed.** The administrator hands the password over, and the user
  can replace it with `POST /me/password` once signed in.
- **Passwordless accounts** made by the development sign-in get a password this
  way.
- **The email** is matched like at sign-up (trimmed, lowercased) and may be
  percent-encoded: 400 if it is not an email, 404 if nobody has it.
- **No current password and no rate limit**: the API key is the proof, as for
  every admin route.
- **It locks the user row**, so a change the user makes at the same moment either
  finishes first or finds the new hash and answers 409.
- **Each reset is logged** with the user's id.

**Rate limits** come from `@nestjs/throttler`, in memory and per process, and only
the auth controller and the password change use its guard (`rate-limits.ts`).
Each route has its own budget: per client address, 10 requests a minute for
sign-up, sign-in and dev sign-in and 30 for refresh and sign-out; per account, 5
password changes, so a copied access token gains nothing from many addresses.
Behind a reverse proxy, set `TRUST_PROXY`, or every client looks like the proxy
and all share one budget. Unset, `X-Forwarded-For` is ignored, so it cannot be
spoofed to get a fresh budget.

**Development sign-in.** With `DEV_AUTH=true`, `POST /auth/dev-sign-in` gives any
email a normal session, creating the account on first use; without it, the route
answers with a 404. It is the only way into the seeded accounts, which have no
password until an administrator sets one. Configuration refuses to boot with
`DEV_AUTH=true` under `NODE_ENV=production`.

**Household scope.** Every route with `:householdId` goes through
`HouseholdAccessGuard`, which resolves the caller's membership (404, not 403,
for non-members, so ids cannot be probed) and enforces `@RequireHouseholdRole`.
Household-scoped service methods take a `Membership`, never a bare household id,
so they cannot be reached without the check. Owners manage the household and its
members; any member manages locations and items.

**Every household has a fallback location**, "Other", created with it among
the default storage spaces. Deleting a location — `DELETE ...?moveItemsTo=` or a
`removed` entry of the editor's `PUT` — moves its active items to `moveItemsTo`,
or to the fallback when that is omitted. The fallback itself can be reordered and
re-iconed but never renamed or deleted (409); the database backs the delete rule
with `locations_fallback_not_deleted`.

## Shopping lists

A list names items rather than copying them: an entry is an item, how many to
buy, and whether it is ticked off. Any member manages lists and entries.

- **Every household starts with a list**, "My shopping list", which
  `HouseholdsService.create` creates with it. The name follows the creator's
  language (`defaultShoppingListName` in shared): the exact tag, then its
  language, then English.
  - From then on it is an ordinary list, renamed, archived or deleted like any
    other, so a household can end up with none.
  - Creating a household announces the creator as a member first, which moves
    their open sockets into its room, and then the list.
- **Running out puts an item on its default list** (`items.default_shopping_list_id`),
  in the same transaction. `ItemsService.update` adds one of it when a patch takes
  it from in stock (active, quantity above 0) to not: consumed, discarded, or down
  to 0. An item already on the list stays as it is. Deleting an item is a
  correction, and takes it off every list instead. A sync push skips this: the
  offline mirror applies the same rule itself (see Offline sync).
- **"I used it already"** sends `status` and `defaultShoppingListId` in one patch,
  so a list picked while using an item up becomes its default, atomically.
- **Adding** (`POST .../entries`) skips items already on the list and answers with
  the entries it created. One unknown item fails the whole request (404).
- **Putting the shopping away** (`POST .../put-away`, the frontend's "Bought"
  button) restocks each named entry's item (`ItemsService.restock`) and deletes
  the entries, all or nothing.
  - An item in stock gains the quantity, up to `MAX_ITEM_QUANTITY` — and never
    loses any: one filled past the limit before it was lowered keeps what it has.
  - One that ran out starts over as a new batch: active, just the bought quantity,
    dates cleared, in its own location, or in the fallback if that was deleted.
  - An entry not on the list, or no longer ticked off, is a 409: the client acted
    on a stale list.
- **The editor saves with one `PUT`**, like the locations editor: additions, renames,
  archiving, deletions and order, announced as one `ShoppingListsUpserted` set.
  The set must name every list, archived ones included (409 otherwise), and renames
  go through placeholders so swapped names do not collide mid-statement.
- **Deleting a list** clears it from the items that have it as their default, each
  recorded in the item's history and announced, then deletes it with its entries.
- **An archived list is frozen.**
  - Every entry write to it is a 409.
  - It cannot become an item's default (400).
  - Items that run out skip it but keep it as their default, so restoring the
    list brings everything back as it was.
  - It can still be renamed, restored or deleted.
- **Broadcasts carry the items with the entries** (`ShoppingListEntriesUpserted`): an
  item used up is off the shelf, so it is not among the active items a client holds.
  The socket snapshot includes the lists, their entries and those items.
- **Locks follow one order** — household, items, lists, entries — in both
  `ItemsService` and `ShoppingListsService`, so the two cannot deadlock on each
  other. A deadlock that happens anyway (`40P01`) is rolled back whole and
  translated to a 409, so the request can simply be sent again.

## Offline sync

The frontend keeps an offline mirror of a household (RxDB, in
`apps/frontend/src/offline`). It pulls `items`, `locations`, `shopping-lists` and `shopping-list-entries`
(`SYNC_COLLECTION`), and pushes its own changes to items and entries only
(`SYNC_PUSH_COLLECTIONS`): the everyday actions touch nothing else, and the
space and list editors stay online.

- **A page of changes after a checkpoint**, oldest first: `?updatedAt=&id=` names
  the last document of the previous page (both or neither, 400 otherwise), and
  `?limit=` caps the page (200 by default, 500 at most). A client pulls again
  from the checkpoint it gets back until a page comes back short; an empty page
  hands its own checkpoint back.
- **Deleted rows are sent**, with `_deleted: true` beside the usual wire shape:
  that is how a client that was away learns what to drop. Items of every status
  are sent, since a used-up item can still be on a shopping list.
- **The checkpoint's `updatedAt` is the database's text, to the microsecond.**
  Pass it back untouched: a value round-tripped through a JS `Date` loses its
  microseconds and sits before its own row.
- **Reads only.** One query per call, no transaction: a row written during a
  pull is in this page or, with a later `updated_at`, the next. Writes keep
  going through the domain services, the push's included, so the mirror never
  bypasses their rules.
- **Units and categories are not synced**: the same for every household and
  about never changed, so the frontend keeps reading them over REST.
- **A push goes through the domain services** (`SyncPushService`), row by row,
  oldest first: the same DTOs, locks, history and broadcasts as a REST write.
  Two things are left to the client, which did them already:
  - An item that runs out is not put on its default list
    (`ItemsService.update(..., { listWhenRunOut: false })`): the mirror added
    that entry itself and pushes it next, so the server adding one too would make
    a duplicate.
  - `isEdible` is dropped wherever a category other than the default one decides
    it — on a create, and on a patch that changes the category — since the
    client's copy is a guess. Sent alone against such a category, it is refused.
  - A row without an assumed state is a create, made under the client's id
    (`CreatePantryItemDto.id`, `ShoppingListsService.addEntry`). A replay of a
    create that already landed passes; an entry for an item already on the list
    comes back as a tombstone, dropping the client's duplicate quietly.
  - Otherwise the row applies only if the assumed `updatedAt` is still the
    server's, as the fields that differ between the two states. A stale base
    comes back in `conflicts` with the server's version, for the client's
    conflict handler to merge and push again.
  - A 4xx from the services (invalid, archived list) comes back in `conflicts`
    as the server's version — a tombstone for a refused create — and in
    `refused` with the message, so the client can say why rather than retry.
    Anything else fails the push, which the client sends again later.
  - The answer is 200 whatever became of each row.

## Backups and imports

The frontend's Data sheet (`src/data/`): any member exports the household or
imports a file into it. Files are .xlsx, read and written with **exceljs**.

**The export is a backup** (`GET .../export`): storage spaces, the active items
and their active units, in the sheets `backup-format.ts` describes — `Pantry Pal`
(format and version), `Storage spaces`, `Items`, `Units` — under English
headers, which are the format. Categories and units are codes. It is read in one
`repeatable read` snapshot, so no unit names an item the file lacks, and it is
sent `no-store`; the frontend's service worker keeps it out of its read cache
too.

**An import** (`POST .../import/:source`, the file in the multipart field `file`)
never replaces anything: what the file holds joins what the household has, in
one transaction (`ImportService`).

- **Parsers first, outside the transaction.** Each source turns the workbook into
  an `ImportPlan` (`pantry-pal-backup.ts`, `kitchen-pal.ts`); a file that cannot be
  read fails before anything is written. A row that cannot be read is left out
  and listed in the answer with a reason (`IMPORT_SKIP_REASON`); a file that
  cannot be read at all is a 400 whose `code` names why (`IMPORT_ERROR`).
- **Storage spaces** match the household's own by id, then by name, then by any
  name of the default space they were copied from, so KitchenPal's "Fridge" finds
  "Холодильник" and "Other" finds the fallback. Anything else is created, named as
  the file has it — or, for a default the household deleted, in the member's
  language — until `MAX_LOCATIONS_PER_HOUSEHOLD`, and the fallback takes the rest.
  Creating them takes the household lock, as the locations service does.
- **Items** match by id (a backup of this household), a deleted one coming back
  (`ItemsRepository.undelete`, recorded as `restored`); else an active item of the
  same name in the same space takes the file's units; else one is created. Rows of
  one file that share a name and a space land in one item, so the summary counts
  the household's items, not rows.
- **Units keep their own state** — expiry, opened date, fill — through
  `ItemsRepository.createWithUnits` and `addUnits`. A partly used unit without an
  opened date takes the day of the import, as `sub_items_fill_needs_opened`
  requires. A unit whose id the household holds already is skipped, so importing
  a backup into the household it came from a second time adds nothing; into
  another household it adds everything again. Units past `MAX_ITEM_QUANTITY` are
  left out and reported (`capped`).
- **KitchenPal** exports one sheet, a row per thing on a shelf. `Quantity_metric`
  is what is left of all the pieces together, so the size recorded is one full
  piece's: a whisky at 20% holding 150 ml is a 750 ml bottle. The open piece
  becomes a unit at that fill, the rest full ones. Its categories map to ours
  (`CATEGORIES` in `kitchen-pal.ts`), the rest land in `other`; brand, store,
  price and barcode go into the notes. Photos are not imported.
- **Announced as usual**: `location.created`, `item.created` and `item.updated`
  per write, so clients, the offline mirror's pulls included, need nothing new.
  Every item written records an event whose payload names the source.
- **Limits**: 2 MB per file (`MAX_IMPORT_FILE_BYTES`, a 413 from multer),
  `MAX_IMPORT_ROWS` rows per sheet, and a zip whose central directory claims more
  than 64 MB or 1000 parts is refused before exceljs unpacks it (`workbook.ts`). A
  directory that lies about its sizes is bounded by the upload limit alone.
- **exceljs pulls in `uuid@8`**, which `pnpm audit` flags (bounds check in v3, v5
  and v6 with a buffer). exceljs only calls `v4()`, so it is not reachable.

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

## Default storage spaces

A new household copies the rows of `default_locations`, in order, with the
fallback among them. Each copy is named in the creator's language
(`users.locale`) from `default_location_translations`: the exact tag (`fr-CA`),
then its language (`fr`), then the default's English `name`. The copies are the
household's own from then on: changing the defaults, or the creator's language,
never renames them.

`/admin/default-locations` reads the list and replaces it whole
(`DefaultLocationsService.replace`, one transaction), since the order and the one
fallback belong to the list rather than to a row. `ReplaceDefaultLocationsDto`
refuses a repeated code, a name repeated ignoring case, anything but exactly one
fallback, a translation key that is not a supported locale or its language, and
two spaces sharing a name in any supported locale, since a household's names
are unique ignoring case. Changes are not broadcast: no client shows the
defaults.

There is no `/admin/settings` any more. `default-locations` was its only key,
and migration `0005_default_locations` dropped the `app_settings` table with it.

## Socket.IO configuration

Socket.IO does its own CORS handling and **ignores `app.enableCors()`**. Origins
are applied in `PantryIoAdapter`, registered via `app.useWebSocketAdapter()`.
The `@WebSocketGateway()` decorator sets only the namespace, because decorator
options are evaluated at import time — before `ConfigModule` has loaded `.env`.

Browsers cannot set headers on a WebSocket, so the handshake carries the access
token in `auth.token` (`ACCESS_TOKEN_HANDSHAKE_KEY`); `Authorization: Bearer` is
accepted too, for non-browser clients. A refused handshake reaches the client as
`connect_error`, with the 401 body in `data`: refresh the token and connect again.

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

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each be at least 32 bytes,
must differ, and are required in production. Unset in development, the process
generates its own, which lasts until it restarts: a generated access secret only
makes clients refresh, but a generated refresh secret ends every session, so set
that one wherever restarts are frequent. `TRUST_PROXY` is passed to Express's
`trust proxy` as written: `true`, a hop count, or addresses such as `loopback`.

On boot, `DatabaseModule` seeds `units` and `categories` **only into an empty
table** — seeding every time would resurrect rows an admin deleted. Migration
`0002_categories` inserts the categories itself; the boot seed covers `db:push`.
That first query doubles as the connectivity check.

## Background jobs: planned

Nothing runs in the background yet. When something needs to, use **pg-boss**: a
job queue that lives in PostgreSQL, so it adds no Redis or other service.

- **It belongs in this package**, never in `@pantry-pal/db`, which may depend on
  `drizzle-orm` and `pg` only.
- **pg-boss 12 is ESM-only.** It reaches this CommonJS build through
  `require(esm)`, like NestJS 12, and needs Node 22.12 and PostgreSQL 13 or newer.
  Check the minimum release age in `pnpm-workspace.yaml` when adding it.
- **Enqueue inside the transaction that calls for the job.** pg-boss can create
  jobs in an existing transaction and has a Drizzle adapter; given the active
  transaction, a rolled-back write leaves no job behind. That is the promise
  `ChangeFeed` keeps with `runOnCommit`.
- **First job: purge `refresh_tokens`.** Every sign-in adds a row and nothing
  deletes expired or revoked ones. A daily cron schedule is enough.
- **Later:** expiry reminders, deferred in `packages/db/CLAUDE.md`.
