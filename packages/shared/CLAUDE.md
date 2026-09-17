# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/shared` — the library both apps depend on. See the root
`CLAUDE.md` for workspace-wide guidance.

## Commands

```bash
pnpm build        # tsup: ESM + CJS + declarations
pnpm dev          # tsup --watch
pnpm type-check   # tsc --noEmit
```

This package must be built before either app can build, type-check or start.

## Two entry points, and why

| Subpath                  | Contents                                          | Runtime deps                                         |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------- |
| `@pantry-pal/shared`     | constants, types, utils, WebSocket contract       | **none**                                             |
| `@pantry-pal/shared/dto` | `class-validator` request classes + `validateDto` | class-validator, class-transformer, reflect-metadata |

**The root barrel must stay dependency-free.** It is imported by
`apps/frontend/vite.config.ts`, which Node evaluates at config-load time where
no bundler tree-shaking exists. Adding `export * from './dto'` to
`src/index.ts` will crash the frontend build with
`Reflect.getMetadata is not a function`.

`src/dto/index.ts` imports `reflect-metadata` as its first statement so the
polyfill is installed before the decorated classes are defined. That makes the
entry self-contained — no consumer has to remember an import order. Keep it
first.

Because of that polyfill, `package.json` lists `sideEffects` for the
`dist/dto/*` files. Do not change it back to `sideEffects: false` — installing a
global polyfill genuinely is a side effect, and the claim would let a bundler
drop it.

## Writing DTOs

esbuild does not implement `emitDecoratorMetadata`, so **state every rule
explicitly**:

```ts
@Type(() => Number)   // required — the design-time type is not emitted
@IsInt()
@Min(1)
quantity!: number;
```

A decorator that infers its constraint from the TypeScript type will receive
`undefined` and silently validate nothing. `validateDto()` mirrors the backend
`ValidationPipe`'s options (`whitelist`, `forbidNonWhitelisted`) so both sides
accept exactly the same payloads — change one and change the other.

Helpers in `src/dto/decorators.ts` cover the recurring cases:

- **`@IsOmittable()`** for optional fields of a PATCH that must not be null.
  `@IsOptional()` lets `null` through too, which is right for a nullable column
  ("clear the notes") and wrong for `name`, where it would pass validation and
  fail the NOT NULL constraint as a 500.
- **`@Trim()`** / **`@NormalizeEmail()`** transform before validation, so
  `"  "` fails a minimum length.
- **`@IsIsoDate()`** accepts `YYYY-MM-DD` only, and only real days — a full
  timestamp would be truncated by Postgres in the server's time zone.

A DTO validates shape; what it cannot know (does this unit code exist, does this
location belong to the household) is checked by the backend services.

## The WebSocket contract

`src/events.ts` declares `ServerToClientEvents` / `ClientToServerEvents` using
computed keys from the `PANTRY_EVENT` / `PANTRY_COMMAND` const objects. Both the
gateway and the socket client are typed with these, so a renamed event or a
changed payload is a compile error on both ends rather than a silent no-op.

Add new events by extending the const object _and_ the interface together. Every
payload identifies its household, and every command names one: a socket follows
all of its user's households at once.

## Translations in the database

Text the frontend's catalogs cannot hold, such as the names of the default
storage spaces, lives in database translation tables, keyed by a BCP 47 tag.
`src/utils/locale.ts` has the rule every reader applies: `pickTranslation` looks
up the exact tag (`fr-CA`), then its language (`fr`), then the base text. Stored
tags are `TRANSLATION_LOCALES`, the supported locales and their languages, so
most rows are languages and a regional row exists only where the wording differs.

## Conventions

- `src/utils/` is pure and dependency-free, and runs in both Node and the
  browser. Keep it that way — anything needing a runtime dependency belongs in
  a separate entry point.
- Wire types use ISO-8601 **strings** for instants, never `Date`, and plain
  `YYYY-MM-DD` strings for calendar dates (expiry, opened).
- Value sets (`HOUSEHOLD_ROLE`, `ITEM_STATUS`, `UNIT_KINDS`, ...) are `as const`
  arrays or objects with types derived from them, so the runtime list used by
  `@IsIn([...X])` and the compile-time union can never disagree.
  `@pantry-pal/db` generates its CHECK constraints from the same lists, so they
  live here rather than there.
- There is no unit, category or default storage space list here. All three are
  rows in the database (`GET /units`, `GET /categories`,
  `/admin/default-locations`), so their codes are validated as strings and
  checked for existence by the server. Only `COUNT_UNIT` and `DEFAULT_CATEGORY`
  are fixed, as the codes that can never be deleted.
- Expiry maths reads `effectiveExpiresAt`, never `expiresAt` — the database
  folds opened + period-after-opening into it.
