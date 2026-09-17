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
apps/frontend    React 19 + MobX 7 · React Router 8 · Tailwind 4 · Vite 8 · ESM
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
caller's membership before a service runs. Callers sign in with email and
password and authenticate with a short-lived JWT access token, renewed through a
rotating refresh token; the browser keeps both in localStorage, shared by every
tab. With `DEV_AUTH=true` a development sign-in needs no password. Global
reference data (units, categories, default locations) and password resets go
through `/admin`, authenticated by an API key.
Details in `apps/backend/CLAUDE.md`.

### The frontend applies one optimistic update, and only one

`PantryStore` holds server state only: a write waits for the server's response,
and the matching broadcast re-applies the same data. This is deliberate — it
keeps every connected client in agreement. The single exception is stepping an
item's quantity, which renders at once from a separate overlay
(`QuantityUpdates`) and saves after a short pause; see `apps/frontend/CLAUDE.md`.
Keep any new optimism out of `PantryStore` itself.

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

### Turborepo hides undeclared environment variables

Turborepo 2 runs tasks in strict env mode: a task's process sees only the
variables declared under `env` or `globalEnv` in `turbo.json`, plus `VITE_*`,
which it infers for Vite. Anything else set in the shell or CI is dropped
without a warning. Undeclared, `BASE_PATH=/x pnpm build` would build for `/`.
`.env*` files are unaffected, because the apps read them from disk. Declare any
variable a task reads from its environment in `turbo.json`; that also puts it
in the cache key.

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

## Deployment

`.github/workflows/deploy-pages.yml` publishes the frontend to GitHub Pages on
every push to `main`, or when run by hand from the Actions tab. Pages serves
static files only: the site calls the backend named by the **repository
variable** `VITE_BACKEND_URL` directly, with no proxy in between
(`apps/frontend/src/services/backendOrigin.ts`). That backend's `CORS_ORIGIN`
must list the site's origin. Without the variable, pages that need the API show
their load error. The repository's Pages source must be set to _GitHub Actions_
once, in its settings.

- A project site is served under `/<repo>/`. The workflow passes that path as
  `BASE_PATH`, which sets Vite's `base`, and the router takes its `basename`
  from `import.meta.env.BASE_URL`. Link through the router: a hard-coded
  `href="/…"` escapes the base path.
- Pages has no SPA rewrites. The workflow copies `index.html` to `404.html`, so a
  deep link boots the app (with a 404 status) and the router takes over.
- Actions are pinned to commit SHAs, with the version in a comment; update both
  together. No dependency cache is restored, so nothing another run wrote can
  reach the published site.

## Conventions

- Values shared between the apps (ports, paths, event names, roles, statuses,
  unit kinds) belong in `packages/shared/src/constants.ts`. A literal
  duplicated across both apps will drift. `packages/db` generates its CHECK
  constraints from these same lists rather than defining its own.
- Units and categories are rows, not constants: read them from `GET /units` and
  `GET /categories`.
- Dates cross the wire as ISO-8601 **strings**, never `Date` — JSON has no date
  type, so a `Date` in a wire type is a lie after `JSON.parse`.
- The frontend imports DTOs as values only where it needs runtime validation;
  `import type` elsewhere keeps the validation runtime out of the bundle.
