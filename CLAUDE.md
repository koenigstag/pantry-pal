# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root; Turborepo fans each task out across packages.

```bash
pnpm dev           # builds shared, then both apps in watch mode
pnpm build         # topological build: shared → apps
pnpm type-check    # tsc --noEmit everywhere
pnpm lint          # oxlint          (lint:fix to autofix)
pnpm format        # oxfmt           (format:check to verify)
pnpm clean         # removes dist/ and .turbo/
```

Scope a task to one package:

```bash
pnpm --filter @pantry-pal/backend run build
```

**There is no test runner wired up.** `turbo.json` defines a `test` task, but no
package implements a `test` script, so `pnpm test` is currently a no-op. Adding
one means adding the script to the package — the task graph already orders it.

## Architecture

Four packages; `packages/shared` is the hub everything else depends on.

```
apps/backend     NestJS 12 · REST + Socket.IO · CommonJS via tsc
apps/frontend    React 19 + MobX 7 · Vite 8 · ESM
packages/shared  constants · DTOs · utils · typed WebSocket contract
packages/db      Drizzle + pg · ESM · schema, repositories, transactions
```

Dependency direction is one-way and must stay that way:
`db → shared`, `backend → {shared, db}`, `frontend → shared`. Nothing depends on
an app, and `shared` depends on nothing in the workspace.

`packages/db` owns the Drizzle schema, repositories and the transaction layer.
Repositories are plain classes with no Nest decorators; `apps/backend` bridges
them into DI with a `useFactory`. Details, including why `@Transactional()` is
written in legacy decorator form, are in `packages/db/CLAUDE.md`.

### Build ordering is load-bearing

Every task in `turbo.json` declares `"dependsOn": ["^build"]`, so `shared` is
built before anything else builds, type-checks or starts. `vite.config.ts` even
imports from it at config-load time.

If you see `Cannot find module '@pantry-pal/shared'`, build shared first — do
not work around it by importing across package `src/` directories.

### Two transports, one write path

Services publish every mutation onto `ChangeFeed` (an RxJS `Subject`).
`PantryGateway` subscribes once and broadcasts to the affected household's
room. Controllers and the socket gateway both go through the services, so a
write over either transport fans out exactly once, and neither transport
depends on the other (no circular DI). Publishing waits for the transaction to
commit (`runOnCommit` in `@pantry-pal/db`), so a rolled-back write is never
announced.

**Do not emit socket events from a service or controller directly.** Publish a
change and let the gateway broadcast it.

### Households scope everything

Every domain row belongs to a household, and every household route checks the
caller's membership before a service runs. Identity is currently a development
stand-in — the `x-dev-user-email` header, honoured only with `DEV_AUTH=true` —
behind a seam real authentication will replace. Global reference data (units,
default locations) is managed through `/admin`, authenticated by an API key.
Details in `apps/backend/CLAUDE.md`.

### The frontend applies no optimistic updates

`PantryStore` only mutates its state from server broadcasts. A write sends the
request and waits for the resulting event. This is deliberate — it keeps every
connected client in agreement. Preserve it unless you intend to change it.

## Gotchas that will bite

### NestJS 12 is ESM-only

The backend still emits **CommonJS**, which works only because Node >= 22.12
supports `require()` of ESM. `apps/backend/tsconfig.json` therefore uses
`"module": "nodenext"` — that is what lets `tsc` model this. Reverting to
`"commonjs"` + `"node10"` compiles and runs, but silently loses the ability to
resolve `exports` subpaths such as `@pantry-pal/shared/dto`.

### DTOs live behind `@pantry-pal/shared/dto`, not the root barrel

`class-validator` decorators call `Reflect.getMetadata` **at module-evaluation
time**, and that function is not JavaScript — the `reflect-metadata` polyfill
installs it. Re-exporting the DTOs from the root barrel makes every consumer pay
for it and **crashes Vite's config loader**.

Keep the root barrel free of runtime dependencies. `src/dto/index.ts` imports
`reflect-metadata` itself so the entry is self-contained.

### esbuild does not implement `emitDecoratorMetadata`

`shared` is bundled by tsup/esbuild, so **every validation rule must be
explicit** — `@IsInt()`, `@IsIn([...])`, `@Type(() => Number)`. Rules relying on
inferred `design:type` metadata receive `undefined` and silently fail to
validate. (The backend's own source is compiled by `tsc` with
`emitDecoratorMetadata: true`, so Nest DI is unaffected.)

### `useGlobalPipes()` applies to WebSockets too

The global `ValidationPipe` validates socket payloads as well as HTTP bodies,
but raises `BadRequestException`, which the WebSocket layer reports to clients
as a bare "Internal server error". `WsExceptionFilter` re-wraps it. Do not add a
second validation pipe to gateway handlers — the global one already ran.

### Express 5 changed query parsing

Nest 12 runs on Express 5, whose `query parser` defaults to `simple`, silently
breaking `?tags[]=a&tags[]=b` and `?filter[name]=x`. `main.ts` restores it with
`app.set('query parser', 'extended')`. Leave that in place.

## Tooling

- **oxlint and oxfmt — not ESLint or Prettier.** Configs are `.oxlintrc.json`
  and `.oxfmtrc.json`. Both are Rust-based and run in well under a second.
  Disabled rules carry a reason in the config; keep that habit.
- **Node is pinned** to 24.21.0 (`.nvmrc`), declared in every package's
  `engines`, and **enforced** by `engineStrict: true` in `pnpm-workspace.yaml` —
  a mismatched Node version fails `pnpm install` outright.
- **pnpm 11**, declared once via `packageManager` at the root. Do not duplicate
  that field into sub-packages.
- `allowBuilds` in `pnpm-workspace.yaml` allowlists install scripts (pnpm >= 10
  blocks them by default). esbuild needs it.

## Environment files

Every package ships a `.env.example`. Real values go in `.env.local`, which is
git-ignored and takes precedence over `.env`. The backend loads them via
`ConfigModule`; the frontend via Vite's `loadEnv`, where only `VITE_`-prefixed
variables reach browser code.

## Conventions

- Values shared between the apps (ports, paths, event names, categories, roles,
  statuses, unit kinds) belong in `packages/shared/src/constants.ts`. A literal
  duplicated across both apps will drift. `packages/db` generates its CHECK
  constraints from these same lists rather than defining its own.
- Units themselves are rows, not a constant: read them from `GET /units`.
- Dates cross the wire as ISO-8601 **strings**, never `Date` — JSON has no date
  type, so a `Date` in a wire type is a lie after `JSON.parse`.
- The frontend imports DTOs as values only where it needs runtime validation;
  `import type` elsewhere keeps the validation runtime out of the bundle.
